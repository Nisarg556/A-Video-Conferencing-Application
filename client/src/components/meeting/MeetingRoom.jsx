import { useCallback, useEffect, useRef, useState } from 'react';
import { endMeeting } from '../../api/meetings.js';
import { useActiveSpeaker } from '../../hooks/useActiveSpeaker.js';
import { useChat } from '../../hooks/useChat.js';
import { useMeetingRoom } from '../../hooks/useMeetingRoom.js';
import { CopyLink } from '../CopyLink.jsx';
import { LockIcon, ScreenShareIcon } from '../icons.jsx';
import { RemoteAudio } from '../RemoteAudio.jsx';
import { StatusMessage } from '../StatusMessage.jsx';
import { VideoTile } from '../VideoTile.jsx';
import { ChatPanel } from './ChatPanel.jsx';
import { ControlBar } from './ControlBar.jsx';
import { PeopleList } from './PeopleList.jsx';
import { SidePanel } from './SidePanel.jsx';
import { WaitingRoom } from './WaitingRoom.jsx';

/**
 * In-meeting view.
 *  - Gallery: everyone in a responsive grid.
 *  - Presentation: the shared screen large, everyone else in a filmstrip.
 *    The presenter sees a "You're presenting" card instead of their own screen
 *    (showing it would create an infinite mirror if they share this tab).
 */
export function MeetingRoom({ meeting, session, media, onExit }) {
  const room = useMeetingRoom({
    token: session.token,
    rtcConfig: session.rtcConfig,
    audioTrack: media.audioTrack,
    cameraTrack: media.videoTrack,
    micOn: media.micOn,
  });
  const { screen } = room;

  const [panel, setPanel] = useState(null); // null | 'people' | 'chat'
  const [chatAutoFocus, setChatAutoFocus] = useState(false);
  const panelToggleRef = useRef(null);
  const [ending, setEnding] = useState(false);
  const [actionError, setActionError] = useState(null);

  const self = room.self ?? {
    participantId: session.participant.id,
    displayName: session.participant.displayName,
    role: session.participant.role,
  };
  const isHost = self.role === 'host';
  const [hostError, setHostError] = useState(null);

  // Host actions: the server enforces the permission; we only surface failures.
  const runHostAction = useCallback(async (action) => {
    setHostError(null);
    const result = await action();
    if (!result.ok) setHostError(result.error.message);
    return result;
  }, []);

  const chat = useChat({
    socket: room.socket,
    joinCount: room.joinCount,
    code: meeting.code,
    token: session.token,
    self: room.self,
    visible: panel === 'chat',
  });

  const speakerId = useActiveSpeaker({
    enabled: room.status === 'joined' && room.peers.length > 0,
    getRemoteLevels: room.getAudioLevels,
    selfId: self.participantId,
    localTrack: media.audioTrack,
    localMicOn: media.micOn,
  });

  // Server-driven exits: host ended the meeting, or we joined from another tab.
  useEffect(() => {
    if (room.status === 'ended') {
      if (room.endedReason === 'expired') onExit('expired');
      else onExit(isHost ? 'you_ended' : 'host_ended');
    }
    if (room.status === 'replaced') onExit('replaced');
    if (room.status === 'denied' || room.error?.code === 'ADMISSION_DENIED') onExit('denied');
    if (room.status === 'removed' || room.error?.code === 'REMOVED_FROM_MEETING') onExit('removed');
  }, [room.status, room.endedReason, room.error, isHost, onExit]);

  const togglePanel = useCallback((next) => {
    panelToggleRef.current = document.activeElement;
    setChatAutoFocus(next === 'chat');
    setPanel((current) => (current === next ? null : next));
  }, []);

  const switchTab = useCallback((next) => {
    setChatAutoFocus(false);
    setPanel(next);
  }, []);

  const closePanel = useCallback(() => {
    setPanel(null);
    // Return focus to the button that opened the panel (keyboard users).
    requestAnimationFrame(() => panelToggleRef.current?.focus?.());
  }, []);

  async function handleLeave() {
    await room.leave();
    onExit('left');
  }

  async function handleEndForAll() {
    if (!window.confirm('End the meeting for everyone?')) return;
    setEnding(true);
    setActionError(null);
    try {
      await endMeeting(meeting.code, session.token);
      // The server now broadcasts meeting:ended, which triggers onExit above.
    } catch (err) {
      setActionError(err.message);
      setEnding(false);
    }
  }

  // Waiting to be admitted (or still connecting after being told we'll wait).
  if (room.status === 'waiting' || (room.status === 'connecting' && session.admission === 'waiting')) {
    return <WaitingRoom meeting={meeting} self={self} media={media} onLeave={handleLeave} />;
  }

  if (room.status === 'error') {
    const titles = { ROOM_FULL: 'This meeting is full', MEETING_LOCKED: 'This meeting is locked' };
    return (
      <StatusMessage
        title={titles[room.error?.code] ?? 'Couldn’t join the meeting'}
        action={{ to: `/m/${meeting.code}`, label: 'Back to lobby', reloadDocument: true }}
      >
        {room.error?.message}
      </StatusMessage>
    );
  }

  const presenterId = screen.sharing ? self.participantId : room.presenterId;
  const presenter = room.peers.find((p) => p.participantId === presenterId);
  const presenterName = screen.sharing ? 'You' : presenter?.displayName;
  const everyone = [{ ...self, isSelf: true, media: room.mediaState }, ...room.peers];

  const selfTile = (
    <VideoTile
      key="self"
      stream={media.stream}
      hasVideo={Boolean(media.videoTrack)}
      name={self.displayName}
      label={`${self.displayName} (you)`}
      micMuted={!room.mediaState.audio}
      badge={isHost ? 'Host' : undefined}
      speaking={speakerId === self.participantId}
      isLocal
    />
  );
  const peerTile = (peer, variant = 'camera') => (
    <VideoTile
      key={peer.participantId}
      stream={peer.stream}
      hasVideo={Boolean(peer.stream && peer.media?.video)}
      name={peer.displayName}
      label={variant === 'screen' ? `${peer.displayName}’s screen` : peer.displayName}
      micMuted={!peer.media?.audio}
      badge={peer.role === 'host' && variant === 'camera' ? 'Host' : undefined}
      connectionState={peer.connectionState}
      speaking={speakerId === peer.participantId}
      variant={variant}
    />
  );

  const deviceProblem = media.errors.video?.message ?? media.errors.audio?.message;
  const alone = room.peers.length === 0 && room.status === 'joined';

  return (
    <div className="room">
      <header className="room-header">
        <div className="room-title">
          <h1>{meeting.title || 'Untitled meeting'}</h1>
          <p className="muted">
            <code>{meeting.code}</code> · {everyone.length} {everyone.length === 1 ? 'person' : 'people'}
          </p>
        </div>
        <div className="room-header-status">
          {room.settings?.locked && (
            <p className="chip chip-muted" role="status">
              <LockIcon width="16" height="16" aria-hidden="true" />
              Locked
            </p>
          )}
          {presenterName && (
            <p className="chip" role="status">
              <ScreenShareIcon width="16" height="16" aria-hidden="true" />
              {screen.sharing ? 'You are presenting' : `${presenterName} is presenting`}
            </p>
          )}
          {room.status !== 'joined' && (
            <p className="banner" role="status">
              {room.status === 'connecting' ? 'Connecting…' : 'Connection lost. Reconnecting…'}
            </p>
          )}
        </div>
      </header>

      <div className="room-body">
        <section className="stage" aria-label="Participants">
          {presenterId ? (
            <div className="presentation">
              <div className="presentation-main">
                {screen.sharing ? (
                  <div className="presenting-card">
                    <ScreenShareIcon width="40" height="40" aria-hidden="true" />
                    <p>You’re presenting to everyone</p>
                    <button type="button" className="btn btn-primary" onClick={() => screen.stop()}>
                      Stop presenting
                    </button>
                  </div>
                ) : presenter ? (
                  peerTile(presenter, 'screen')
                ) : null}
              </div>
              <div className="filmstrip" aria-label="Other participants">
                {selfTile}
                {room.peers.filter((p) => p.participantId !== presenterId).map((p) => peerTile(p))}
              </div>
            </div>
          ) : (
            <div className="tile-grid" data-count={everyone.length}>
              {selfTile}
              {room.peers.map((p) => peerTile(p))}
            </div>
          )}

          {alone && (
            <div className="card invite-card">
              <p>
                <strong>You’re the only one here.</strong>
              </p>
              <p className="muted">Share this link to invite others (up to {meeting.maxParticipants} people).</p>
              <CopyLink url={`${window.location.origin}/m/${meeting.code}`} />
            </div>
          )}
        </section>

        {panel && (
          <SidePanel
            tab={panel}
            onTabChange={switchTab}
            onClose={closePanel}
            unread={chat.unread}
            participantCount={everyone.length}
          >
            {panel === 'chat' ? (
              <ChatPanel
                chat={chat}
                selfId={self.participantId}
                disabled={room.status !== 'joined'}
                autoFocus={chatAutoFocus}
              />
            ) : (
              <PeopleList
                people={everyone}
                presenterId={presenterId}
                speakerId={speakerId}
                isHost={isHost}
                lobby={room.lobby}
                settings={room.settings}
                onAdmit={(id) => runHostAction(() => room.host.admit(id))}
                onDeny={(id) => runHostAction(() => room.host.deny(id))}
                onRemove={(id) => runHostAction(() => room.host.remove(id))}
                onUpdateSettings={(changes) => runHostAction(() => room.host.updateSettings(changes))}
              />
            )}
          </SidePanel>
        )}
      </div>

      <div className="room-alerts">
        {isHost && room.lobby.length > 0 && (
          <div className="lobby-banner" role="status" aria-live="polite">
            <span>
              <strong>{room.lobby[0].displayName}</strong>
              {room.lobby.length > 1 ? ` and ${room.lobby.length - 1} more are` : ' is'} waiting to join
            </span>
            <span className="row">
              <button type="button" className="btn btn-primary btn-small" onClick={() => runHostAction(() => room.host.admit(room.lobby[0].participantId))}>
                Admit
              </button>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => runHostAction(() => room.host.deny(room.lobby[0].participantId))}>
                Deny
              </button>
              {room.lobby.length > 1 && (
                <button type="button" className="link-button" onClick={() => togglePanel('people')}>
                  See all
                </button>
              )}
            </span>
          </div>
        )}
        {hostError && (
          <p className="alert" role="alert">
            {hostError}{' '}
            <button type="button" className="link-button" onClick={() => setHostError(null)}>
              Dismiss
            </button>
          </p>
        )}
        {screen.error && (
          <p className="alert" role="alert">
            {screen.error}{' '}
            <button type="button" className="link-button" onClick={screen.clearError}>
              Dismiss
            </button>
          </p>
        )}
        {deviceProblem && (
          <p className="alert" role="status">
            {deviceProblem}{' '}
            <button type="button" className="link-button" onClick={media.retry}>
              Try again
            </button>
          </p>
        )}
        {actionError && (
          <p className="alert" role="alert">
            {actionError}
          </p>
        )}
      </div>

      <ControlBar
        media={media}
        screen={screen}
        presenterName={screen.sharing ? null : presenter?.displayName}
        panel={panel}
        onTogglePanel={togglePanel}
        unread={chat.unread}
        participantCount={everyone.length}
        waitingCount={isHost ? room.lobby.length : 0}
        isHost={isHost}
        ending={ending}
        onLeave={handleLeave}
        onEndForAll={handleEndForAll}
      />

      {room.peers.map((peer) => peer.stream && <RemoteAudio key={peer.participantId} stream={peer.stream} />)}
    </div>
  );
}
