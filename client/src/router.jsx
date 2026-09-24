import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout.jsx';
import { RouteErrorPage } from './pages/RouteErrorPage.jsx';
import { AuthPage } from './pages/AuthPage.jsx';
import { HistoryPage } from './pages/HistoryPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { LeftPage } from './pages/LeftPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';

export const router = createBrowserRouter([
  {
    element: <Layout />,
    // Catches render errors anywhere below so one bug doesn't blank the app.
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <p className="container main muted">Loading…</p>,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/login', element: <AuthPage mode="login" /> },
      { path: '/signup', element: <AuthPage mode="signup" /> },
      { path: '/meetings', element: <HistoryPage /> },
      // Lazy: the call code (WebRTC, Socket.IO client) only loads when you open a meeting.
      { path: '/m/:code', lazy: async () => ({ Component: (await import('./pages/MeetingPage.jsx')).MeetingPage }) },
      { path: '/m/:code/left', element: <LeftPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
