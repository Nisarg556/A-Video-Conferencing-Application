import {
  CamIcon,
  CamOffIcon,
  ChatIcon,
  LeaveIcon,
  MicIcon,
  MicOffIcon,
  PeopleIcon,
  ScreenShareIcon,
  StopShareIcon,
} from '../icons.jsx';

/**
 * Bottom control bar. Every control is a real <button> (Tab/Enter/Space work),
 * with aria-pressed for toggles and aria-expanded for panels. Text labels hide
 * on narrow screens but stay available to screen readers via aria-label.
 */
export function ControlBar({
  media,
  screen,
  presenterName,
  panel,
  onTogglePanel,
  unread,
  participantCount,
  waitingCount = 0,
  isHost,
  ending,
  onLeave,
  onEndForAll,
}) {
  const someoneElsePresenting = Boolean(presenterName) && !screen.sharing;

  let shareTitle = screen.sharing ? 'Stop presenting' : 'Share your screen';
  if (someoneElsePresenting) shareTitle = `${presenterName} is presenting`;

  return (
    <footer className="control-bar" aria-label="Meeting controls">
      <div className="control-group">
        <ToggleButton
          on={media.micOn}
          onClick={media.toggleMic}
          label={media.micOn ? 'Mute' : 'Unmute'}
          ariaLabel="Microphone"
          icon={media.micOn ? <MicIcon /> : <MicOffIcon />}
          danger={!media.micOn}
        />
        <ToggleButton
          on={media.camOn}
          onClick={media.toggleCamera}
          label={media.camOn ? 'Stop video' : 'Start video'}
          ariaLabel="Camera"
          icon={media.camOn ? <CamIcon /> : <CamOffIcon />}
          danger={!media.camOn}
        />
        {screen.supported && (
          <button
            type="button"
            className={`control ${screen.sharing ? 'control-active' : ''}`}
            onClick={screen.sharing ? () => screen.stop() : screen.start}
            disabled={someoneElsePresenting || screen.starting}
            aria-pressed={screen.sharing}
            aria-label={shareTitle}
            title={shareTitle}
          >
            {screen.sharing ? <StopShareIcon /> : <ScreenShareIcon />}
            <span className="control-label">{screen.sharing ? 'Stop sharing' : 'Share'}</span>
          </button>
        )}
      </div>

      <div className="control-group">
        <button
          type="button"
          className={`control ${panel === 'people' ? 'control-active' : ''}`}
          onClick={() => onTogglePanel('people')}
          aria-expanded={panel === 'people'}
          aria-controls="side-panel"
          aria-label={
            waitingCount > 0 ? `People (${participantCount}), ${waitingCount} waiting` : `People (${participantCount})`
          }
          title="People"
        >
          <PeopleIcon />
          <span className="control-label">{participantCount}</span>
          {waitingCount > 0 && (
            <span className="control-badge" aria-hidden="true">
              {waitingCount}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`control ${panel === 'chat' ? 'control-active' : ''}`}
          onClick={() => onTogglePanel('chat')}
          aria-expanded={panel === 'chat'}
          aria-controls="side-panel"
          aria-label={unread > 0 ? `Chat, ${unread} unread` : 'Chat'}
          title="Chat"
        >
          <ChatIcon />
          <span className="control-label">Chat</span>
          {unread > 0 && (
            <span className="control-badge" aria-hidden="true">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </div>

      <div className="control-group">
        <button type="button" className="control control-danger" onClick={onLeave} aria-label="Leave meeting">
          <LeaveIcon />
          <span className="control-label">Leave</span>
        </button>
        {isHost && (
          <button type="button" className="btn btn-danger-outline" onClick={onEndForAll} disabled={ending}>
            {ending ? 'Ending…' : 'End for all'}
          </button>
        )}
      </div>
    </footer>
  );
}

function ToggleButton({ on, onClick, label, ariaLabel, icon, danger }) {
  return (
    <button
      type="button"
      className={`control ${danger ? 'control-off' : ''}`}
      onClick={onClick}
      // "Microphone, toggle button, pressed" reads naturally in screen readers.
      aria-pressed={on}
      aria-label={ariaLabel}
      title={label}
    >
      {icon}
      <span className="control-label">{label}</span>
    </button>
  );
}
