import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import EmailListPage from './pages/EmailListPage';
import ComposePage from './pages/ComposePage';
import SearchPage from './pages/SearchPage';
import SlackPage from './pages/SlackPage';
import QueuePage from './pages/QueuePage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/scheduled" element={<EmailListPage kind="scheduled" />} />
        <Route path="/sent" element={<EmailListPage kind="sent" />} />
        <Route path="/compose" element={<ComposePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/slack" element={<SlackPage />} />
        <Route path="/queue" element={<QueuePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
