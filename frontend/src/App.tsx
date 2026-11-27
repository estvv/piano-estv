import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { AuthProvider, useAuth } from './app/auth';
import { Layout } from './app/Layout';
import { PianoMenu } from './app/PianoMenu';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { PianoPage } from './piano/Practice';

// Everything is behind the login: without a session, the login page.
function Private({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function Piano() {
  return (
    <div className="fixed inset-0 bg-page">
      <PianoMenu />
      <PianoPage />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="connexion" element={<LoginPage />} />
          <Route index element={<Private><Piano /></Private>} />
          <Route element={<Private><Layout /></Private>}>
            <Route path="reglages" element={<SettingsPage />} />
            <Route path="compte" element={<AccountPage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
