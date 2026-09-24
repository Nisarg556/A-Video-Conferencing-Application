import { useCallback, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { MeetingRoom } from '../components/meeting/MeetingRoom.jsx';
import { PreJoin } from '../components/meeting/PreJoin.jsx';
import { StatusMessage } from '../components/StatusMessage.jsx';
import { useLocalMedia } from '../hooks/useLocalMedia.js';
import { useMeeting } from '../hooks/useMeeting.js';
import { isValidMeetingCode, parseMeetingInput } from '../lib/meetingCode.js';

export function MeetingPage() {
  const { code } = useParams();

  if (!isValidMeetingCode(code)) {
    // "/m/FKF-BQXX-GZM" or "/m/fkfbqxxgzm" (typed from a screen share) → canonical URL.
    const normalized = parseMeetingInput(code);
    if (normalized) return <Navigate to={`/m/${normalized}`} replace />;

    return (
      <StatusMessage title="Invalid meeting link">
        “{code}” isn’t a valid meeting code. Check the link and try again.
      </StatusMessage>
    );
  }

  // key: a different code must start from a clean slate (media, session).
  return <MeetingFlow key={code} code={code} />;
}

/**
 * lobby (PreJoin) -> room (MeetingRoom) -> /m/:code/left
 *
 * Local media lives at this level so the camera permission granted in the
 * lobby carries into the room, and everything is released when we navigate away.
 */
function MeetingFlow({ code }) {
  const navigate = useNavigate();
  const { status, meeting, error } = useMeeting(code);
  const [session, setSession] = useState(null);
  const [endedMessage, setEndedMessage] = useState(null);

  const isActive = status === 'success' && meeting.status === 'active' && !endedMessage;
  // Don't ask for the camera until we know the meeting is joinable.
  const media = useLocalMedia({ enabled: isActive });
  const { stopAll } = media;

  const exit = useCallback(
    (reason) => {
      stopAll();
      navigate(`/m/${code}/left`, { replace: true, state: { reason } });
    },
    [code, stopAll, navigate],
  );

  if (status === 'loading') {
    return (
      <section className="card status-message" aria-busy="true">
        <p className="muted">Loading meeting…</p>
      </section>
    );
  }

  if (status === 'error') {
    if (error.code === 'NOT_FOUND') {
      return (
        <StatusMessage title="Meeting not found">
          This link doesn’t match any meeting. It may have been mistyped, or it expired and was cleaned up.
        </StatusMessage>
      );
    }
    return <StatusMessage title="Something went wrong">{error.message}</StatusMessage>;
  }

  if (meeting.status === 'ended' || endedMessage) {
    const expired = meeting.endedReason === 'expired' || /expired/i.test(endedMessage ?? '');
    return (
      <StatusMessage title={expired ? 'This meeting link has expired' : 'This meeting has ended'}>
        {expired
          ? 'Links stop working after a meeting sits empty for 24 hours. Start a new meeting instead.'
          : 'The host ended this meeting. Start a new one to meet again.'}
      </StatusMessage>
    );
  }

  if (session) {
    return <MeetingRoom meeting={meeting} session={session} media={media} onExit={exit} />;
  }

  return <PreJoin meeting={meeting} media={media} onJoined={setSession} onMeetingEnded={setEndedMessage} />;
}
