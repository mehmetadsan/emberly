import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { isApiConfigured, requireApi } from './lib/apiClient.js';
import { AuthPage, ForgotPasswordPage, ResetPasswordPage } from './pages/Auth.jsx';
import { Layout } from './components/Layout.jsx';
import { HomePage } from './pages/Home.jsx';
import { GroupsPage, GroupPage, NewGroupPage } from './pages/Groups.jsx';
import { ClassesPage, ClassPage, NewClassPage } from './pages/Classes.jsx';
import { AdminPage, ProfilePage } from './pages/ProfileAdmin.jsx';

const AuthContext = createContext(null);
export function useAuth() { return useContext(AuthContext); }

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="page-loading"><span className="spinner" /> Loading Emberly...</div>;
  if (!user) return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  return children;
}

function AdminOnly() {
  const { profile } = useAuth();
  if (profile?.role !== 'admin') return <Navigate to="/" replace />;
  return <AdminPage />;
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(Boolean(isApiConfigured));

  useEffect(() => {
    if (!isApiConfigured) {
      setLoading(false);
      return undefined;
    }
    const client = requireApi();
    let alive = true;
    const loadProfile = async (authUser, session) => {
      if (!authUser) {
        if (alive) { setUser(null); setProfile(null); }
        return;
      }
      const { data, error } = await client.from('profiles').select('*').eq('id', authUser.id).maybeSingle();
      if (error) console.error('Could not load profile:', error.message);
      if (alive) {
        setUser(authUser);
        setProfile(data || { id: authUser.id, email: authUser.email, display_name: '' });
      }
    };
    client.auth.getSession().then(({ data, error }) => {
      if (error) console.error('Could not restore the session:', error.message);
      return loadProfile(data?.session?.user, data?.session);
    }).finally(() => { if (alive) setLoading(false); });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => { loadProfile(session?.user || null, session); }, 0);
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  return <AuthContext.Provider value={{ user, profile, loading, setProfile }}>{children}</AuthContext.Provider>;
}

function AppRoutes() {
  const { user, loading } = useAuth();
  return <>
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage register />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<HomePage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="groups/new" element={<NewGroupPage />} />
        <Route path="groups/:id" element={<GroupPage />} />
        <Route path="classes" element={<ClassesPage />} />
        <Route path="classes/new" element={<NewClassPage />} />
        <Route path="classes/:id" element={<ClassPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="admin" element={<AdminOnly />} />
        <Route path="*" element={<div className="empty-state"><span>🔎</span><h2>Page not found</h2><p>That page may have moved, but your next good habit is right here.</p><a className="button primary" href="/">Go to Today</a></div>} />
      </Route>
    </Routes>
    {loading && !user && <div className="auth-restoring">Restoring session…</div>}
  </>;
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>;
}
