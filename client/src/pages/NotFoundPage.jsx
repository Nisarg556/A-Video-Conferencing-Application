import { StatusMessage } from '../components/StatusMessage.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export function NotFoundPage() {
  useDocumentTitle('Page not found');
  return <StatusMessage title="Page not found">The page you’re looking for doesn’t exist.</StatusMessage>;
}
