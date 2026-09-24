import { useLocation, useParams } from 'react-router';
import { StatusMessage } from '../components/StatusMessage.jsx';

const MESSAGES = {
  left: { title: 'You left the meeting', body: null, canRejoin: true },
  host_ended: { title: 'The host ended the meeting', body: 'Thanks for joining.', canRejoin: false },
  you_ended: { title: 'You ended the meeting', body: 'Everyone has been disconnected.', canRejoin: false },
  expired: { title: 'This meeting has expired', body: null, canRejoin: false },
  removed: {
    title: 'You were removed from the meeting',
    body: 'The host removed you. You can’t rejoin this meeting.',
    canRejoin: false,
  },
  denied: {
    title: 'The host didn’t let you in',
    body: 'Your request to join was declined.',
    canRejoin: false,
  },
  replaced: {
    title: 'You joined from another tab',
    body: 'This tab was disconnected because the same session opened somewhere else.',
    canRejoin: true,
  },
};

export function LeftPage() {
  const { code } = useParams();
  const { state } = useLocation();
  const message = MESSAGES[state?.reason] ?? MESSAGES.left;

  return (
    <StatusMessage
      title={message.title}
      action={message.canRejoin ? { to: `/m/${code}`, label: 'Rejoin' } : { to: '/', label: 'Back to home' }}
      secondary={message.canRejoin ? { to: '/', label: 'Back to home' } : undefined}
    >
      {message.body}
    </StatusMessage>
  );
}
