import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout.jsx';
import { RouteErrorPage } from './pages/RouteErrorPage.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { MeetingPage } from './pages/MeetingPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';

export const router = createBrowserRouter([
  {
    element: <Layout />,
    // Catches render errors anywhere below so one bug doesn't blank the app.
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/m/:code', element: <MeetingPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
