import { CamOffIcon, MicOffIcon, ScreenShareIcon } from '../icons.jsx';
import { initials } from '../VideoTile.jsx';

/**
 * Everyone in the meeting, plus host controls when the viewer is the host.
 * Hiding these controls from non-hosts is only UX: the server rejects the
 * same actions from anyone without the permission.
 */
export function PeopleList({
  people,
  presenterId,
  speakerId,
  isHost,
  lobby = [],
  settings,
  onAdmit,
  onDeny,
  onRemove,
  onUpdateSettings,
}) {
  return (
    <div className="people">
      {isHost && settings && <HostSettings settings={settings} onUpdate={onUpdateSettings} />}

      {isHost && lobby.length > 0 && (
        <section aria-labelledby="waiting-heading" className="people-section">
          <h3 id="waiting-heading" className="people-heading">
            Waiting to join ({lobby.length})
          </h3>
          <ul className="people-list">
            {lobby.map((person) => (
              <li key={person.participantId} className="person">
                <span className="person-avatar" aria-hidden="true">
                  {initials(person.displayName)}
                </span>
                <span className="person-name">
                  {person.displayName}
                  {person.role === 'guest' && <span className="muted"> (guest)</span>}
                </span>
                <span className="person-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    onClick={() => onAdmit(person.participantId)}
                    aria-label={`Admit ${person.displayName}`}
                  >
                    Admit
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => onDeny(person.participantId)}
                    aria-label={`Deny ${person.displayName}`}
                  >
                    Deny
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="in-meeting-heading" className="people-section">
        <h3 id="in-meeting-heading" className="people-heading">
          In the meeting ({people.length})
        </h3>
        <ul className="people-list">
          {people.map((person) => {
            const presenting = person.participantId === presenterId;
            const speaking = person.participantId === speakerId;
            const removable = isHost && !person.isSelf && person.role !== 'host';
            return (
              <li key={person.participantId} className="person">
                <span className={`person-avatar ${speaking ? 'speaking' : ''}`} aria-hidden="true">
                  {initials(person.displayName)}
                </span>
                <span className="person-name">
                  {person.displayName}
                  {person.isSelf && <span className="muted"> (you)</span>}
                  {person.role === 'host' && <span className="badge badge-small">Host</span>}
                  {person.role === 'guest' && <span className="muted"> · guest</span>}
                </span>
                <span className="person-status">
                  {presenting && <ScreenShareIcon width="16" height="16" aria-label="Presenting" role="img" />}
                  {!person.media?.audio && <MicOffIcon width="16" height="16" aria-label="Muted" role="img" />}
                  {!person.media?.video && !presenting && (
                    <CamOffIcon width="16" height="16" aria-label="Camera off" role="img" />
                  )}
                  {speaking && <span className="sr-only">Speaking</span>}
                </span>
                {removable && (
                  <button
                    type="button"
                    className="btn btn-danger-outline btn-small"
                    onClick={() => {
                      if (window.confirm(`Remove ${person.displayName} from the meeting?`)) onRemove(person.participantId);
                    }}
                    aria-label={`Remove ${person.displayName}`}
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function HostSettings({ settings, onUpdate }) {
  return (
    <section aria-labelledby="host-controls-heading" className="people-section host-settings">
      <h3 id="host-controls-heading" className="people-heading">
        Host controls
      </h3>
      <Toggle
        id="setting-locked"
        label="Lock meeting"
        hint="No one new can join"
        checked={settings.locked}
        onChange={(locked) => onUpdate({ locked })}
      />
      <Toggle
        id="setting-waiting"
        label="Waiting room"
        hint={settings.waitingRoom ? 'You admit each person' : 'Turning it off admits everyone waiting'}
        checked={settings.waitingRoom}
        onChange={(waitingRoom) => onUpdate({ waitingRoom })}
      />
      <Toggle
        id="setting-guests"
        label="Allow guests"
        hint="People without an account can join"
        checked={settings.allowGuests}
        onChange={(allowGuests) => onUpdate({ allowGuests })}
      />
    </section>
  );
}

/** A native checkbox styled as a switch: keyboard (Space) and screen readers work for free. */
function Toggle({ id, label, hint, checked, onChange }) {
  return (
    <label className="toggle" htmlFor={id}>
      <span className="toggle-text">
        <span>{label}</span>
        <span className="muted small" id={`${id}-hint`}>
          {hint}
        </span>
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="toggle-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={`${id}-hint`}
      />
    </label>
  );
}
