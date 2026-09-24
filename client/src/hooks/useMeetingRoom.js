import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { CallManager } from '../lib/call/CallManager.js';
import { createMeetingSocket } from '../lib/socket.js';
import { useScreenShare } from './useScreenShare.js';

const byJoinTime = (a, b) => a.joinedAt.localeCompare(b.joinedAt);

function upsertPeer(peers, peer) {
  return [...peers.filter((p) => p.participantId !== peer.participantId), peer].sort(byJoinTime);
}

const INITIAL_STATE = { status: 'connecting', self: null, peers: [], presenterId: null, error: null };

/**
 * Joins the meeting over Socket.IO and runs the WebRTC mesh.
 *
 *   socket events ──▶ presence state (who is here, mic/camera, who presents)
 *                 └─▶ CallManager (one RTCPeerConnection per person)
 *
 * Outgoing video is the screen while sharing, otherwise the camera — swapped
 * with replaceTrack, so starting/stopping a share never renegotiates.
 *
 * status: 'connecting' | 'joined' | 'reconnecting' | 'error' | 'ended' | 'replaced'
 * peers[i]: { participantId, displayName, role, media, stream, connectionState }
 */
export function useMeetingRoom({ token, rtcConfig, audioTrack, cameraTrack, micOn }) {
  const [state, setState] = useState(INITIAL_STATE);
  const [socket, setSocket] = useState(null);
  // Increments after every successful room:join (first join and reconnects).
  const [joinCount, setJoinCount] = useState(0);
  // PeerLinks change outside React (ICE states, remote tracks); bump to re-render.
  const [, rerender] = useReducer((n) => n + 1, 0);
  const socketRef = useRef(null);
  const callRef = useRef(null);

  const screen = useScreenShare({ socketRef, joinCount });
  const stopScreenShare = screen.stop;
  const outgoingVideo = screen.track ?? cameraTrack;
  const mediaState = { audio: Boolean(micOn && audioTrack), video: Boolean(outgoingVideo) };

  const latest = useRef({});
  latest.current = { audioTrack, outgoingVideo, mediaState };

  useEffect(() => {
    const socket = createMeetingSocket(token);
    const call = new CallManager({
      rtcConfig,
      sendSignal: (message) => socket.emit('signal', message),
      onChange: rerender,
    });
    call.setLocalTrack('audio', latest.current.audioTrack);
    call.setLocalTrack('video', latest.current.outgoingVideo);
    socketRef.current = socket;
    callRef.current = call;
    setSocket(socket);
    const update = (patch) => setState((prev) => ({ ...prev, ...patch }));

    // Runs on the first connect AND after every automatic reconnect: the
    // server rebuilds our presence, and we re-offer to everyone.
    socket.on('connect', async () => {
      try {
        const ack = await socket.timeout(5000).emitWithAck('room:join', { media: latest.current.mediaState });
        if (!ack.ok) {
          update({ status: 'error', error: ack.error });
          socket.disconnect();
          return;
        }
        setState({
          status: 'joined',
          self: ack.self,
          peers: ack.peers.sort(byJoinTime),
          presenterId: ack.presenterId,
          error: null,
        });
        setJoinCount((n) => n + 1);
        call.connectToAll(ack.peers.map((p) => p.participantId));
      } catch {
        update({ status: 'error', error: { code: 'TIMEOUT', message: 'The server didn’t respond. Try rejoining.' } });
        socket.disconnect();
      }
    });

    socket.on('connect_error', (err) => {
      if (err.data?.code) {
        // Rejected by our auth middleware (bad/expired token): retrying won't help.
        update({ status: 'error', error: err.data });
        socket.disconnect();
      } else {
        update({ status: 'reconnecting' }); // network trouble; Socket.IO keeps retrying
      }
    });

    socket.on('disconnect', (reason) => {
      // Server- or client-initiated disconnects are final; anything else is a
      // dropped connection that Socket.IO retries. Existing peer connections
      // keep carrying media meanwhile; they're rebuilt once we rejoin.
      if (reason !== 'io server disconnect' && reason !== 'io client disconnect') {
        update({ status: 'reconnecting' });
      }
    });

    socket.on('peer:joined', (peer) => {
      call.expectOfferFrom(peer.participantId); // they will call us
      setState((prev) => ({ ...prev, peers: upsertPeer(prev.peers, peer) }));
    });

    socket.on('peer:left', ({ participantId }) => {
      call.removePeer(participantId);
      setState((prev) => ({ ...prev, peers: prev.peers.filter((p) => p.participantId !== participantId) }));
    });

    socket.on('peer:media', ({ participantId, audio, video }) =>
      setState((prev) => ({
        ...prev,
        peers: prev.peers.map((p) => (p.participantId === participantId ? { ...p, media: { audio, video } } : p)),
      })),
    );

    socket.on('presenter:changed', ({ participantId }) => update({ presenterId: participantId }));
    socket.on('signal', (message) => call.handleSignal(message));
    socket.on('meeting:ended', ({ reason }) => update({ status: 'ended', endedReason: reason }));
    socket.on('session:replaced', () => update({ status: 'replaced' }));

    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      call.closeAll();
      setSocket(null);
    };
  }, [token, rtcConfig]);

  // Track changes go out on every connection via replaceTrack.
  useEffect(() => callRef.current?.setLocalTrack('audio', audioTrack), [audioTrack]);
  useEffect(() => callRef.current?.setLocalTrack('video', outgoingVideo), [outgoingVideo]);

  // Tell others about mute/camera changes so they can show icons/avatars.
  useEffect(() => {
    const socket = socketRef.current;
    if (state.status === 'joined' && socket?.connected) {
      socket.emit('media:state', { audio: mediaState.audio, video: mediaState.video });
    }
  }, [mediaState.audio, mediaState.video, state.status]);

  const leave = useCallback(async () => {
    const socket = socketRef.current;
    stopScreenShare({ notifyServer: false }); // leaving clears the presenter server-side
    callRef.current?.closeAll();
    if (!socket) return;
    try {
      if (socket.connected) await socket.timeout(1000).emitWithAck('room:leave');
    } catch {
      /* the disconnect below still tells the server we left */
    }
    socket.disconnect();
  }, [stopScreenShare]);

  const getAudioLevels = useCallback(() => callRef.current?.getAudioLevels() ?? new Map(), []);

  const peers = state.peers.map((peer) => {
    const link = callRef.current?.getPeer(peer.participantId);
    return { ...peer, stream: link?.stream ?? null, connectionState: link?.connectionState ?? 'new' };
  });

  return { ...state, peers, socket, joinCount, mediaState, screen, getAudioLevels, leave };
}
