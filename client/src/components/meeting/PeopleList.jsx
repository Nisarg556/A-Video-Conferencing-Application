import { CamOffIcon, MicOffIcon, ScreenShareIcon } from '../icons.jsx';
import { initials } from '../VideoTile.jsx';

/** Everyone in the meeting, with host / presenting / muted / speaking state. */
export function PeopleList({ people, presenterId, speakerId }) {
  return (
    <ul className="people-list">
      {people.map((person) => {
        const presenting = person.participantId === presenterId;
        const speaking = person.participantId === speakerId;
        return (
          <li key={person.participantId} className="person">
            <span className={`person-avatar ${speaking ? 'speaking' : ''}`} aria-hidden="true">
              {initials(person.displayName)}
            </span>
            <span className="person-name">
              {person.displayName}
              {person.isSelf && <span className="muted"> (you)</span>}
              {person.role === 'host' && <span className="badge badge-small">Host</span>}
            </span>
            <span className="person-status">
              {presenting && <ScreenShareIcon width="16" height="16" aria-label="Presenting" role="img" />}
              {!person.media?.audio && <MicOffIcon width="16" height="16" aria-label="Muted" role="img" />}
              {!person.media?.video && !presenting && (
                <CamOffIcon width="16" height="16" aria-label="Camera off" role="img" />
              )}
              {speaking && <span className="sr-only">Speaking</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
