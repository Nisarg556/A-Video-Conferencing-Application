import { useCallback, useEffect, useRef, useState } from 'react';
import { createMeetingSocket } from '../lib/socket.js';

const byJoinTime = (a, b) => a.joinedAt.localeCompare(b.joinedAt);

function upsertPeer(peers, peer) {
  return [...peers.filter((p) => p.participantId !== peer.participantId), peer].sort(byJoinTime);
}

/**
 * Connects to the meeting's Socket.IO room with the participant token and
 * tracks who is present.
 *
 * status: 'connecting' | 'joined' | 'reconnecting' | 'error' | 'ended' | 'replaced'
 */
export function useMeetingRoom(token) {
  const [state, setState] = useState({ status: 'connecting', self: null, peers: [], error: null });
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = createMeetingSocket(token);
    socketRef.current = socket;
    const update = (patch) => setState((prev) => ({ ...prev, ...patch }));

    // Runs on the first connect AND after every automatic reconnect, so the
    // server's room state is rebuilt and our peer list is re-synced.
    socket.on('connect', async () => {
      try {
        const ack = await socket.timeout(5000).emitWithAck('room:join', {});
        if (!ack.ok) {
          update({ status: 'error', error: ack.error });
          socket.disconnect();
          return;
        }
        setState({ status: 'joined', self: ack.self, peers: ack.peers.sort(byJoinTime), error: null });
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
      // dropped connection that Socket.IO will retry automatically.
      if (reason !== 'io server disconnect' && reason !== 'io client disconnect') {
        update({ status: 'reconnecting' });
      }
    });

    socket.on('peer:joined', (peer) => setState((prev) => ({ ...prev, peers: upsertPeer(prev.peers, peer) })));
    socket.on('peer:left', ({ participantId }) =>
      setState((prev) => ({ ...prev, peers: prev.peers.filter((p) => p.participantId !== participantId) })),
    );
    socket.on('meeting:ended', ({ reason }) => update({ status: 'ended', endedReason: reason }));
    socket.on('session:replaced', () => update({ status: 'replaced' }));

    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [token]);

  const leave = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket) return;
    try {
      if (socket.connected) await socket.timeout(1000).emitWithAck('room:leave');
    } catch {
      /* the disconnect below still tells the server we left */
    }
    socket.disconnect();
  }, []);

  return { ...state, leave };
}
