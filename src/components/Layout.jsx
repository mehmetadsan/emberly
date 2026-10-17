import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BookOpen, Flame, Home, LogOut, Menu, Plus, Shield, Users, X, UserRound, Download } from 'lucide-react';
import { requireApi } from '../lib/apiClient.js';
import { displayName } from '../lib/userName.js';
import { useAuth } from '../App.jsx';

function InstallButton() {
  const [prompt, setPrompt] = useState(null);
  const [standalone, setStandalone] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  useEffect(() => {
    const check = () => setStandalone(window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);
    const onPrompt = (event) => { event.preventDefault(); setPrompt(event); };
    check();
    window.addEventListener('appinstalled', check);
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => {
      window.removeEventListener('appinstalled', check);
      window.removeEventListener('beforeinstallprompt', onPrompt);
    };
  }, []);
  if (standalone) return null;
  const install = async () => {
    if (!prompt) { setShowHelp(true); return; }
    await prompt.prompt();
    setPrompt(null);
  };
  return <>
    <button className="install-button" onClick={install}><Download size={17} /> Install app</button>
    {showHelp && <div className="modal-backdrop" onClick={() => setShowHelp(false)}><section className="modal-card" onClick={(e) => e.stopPropagation()}>
      <button className="icon-button modal-close" onClick={() => setShowHelp(false)} aria-label="Close"><X size={18} /></button>
      <p className="eyebrow">TAKE EMBERLY WITH YOU</p><h2>Add to your home screen</h2>
      <p>On iPhone or iPad, tap <b>Share</b> → <b>Add to Home Screen</b> → <b>Add</b>.</p>
      <p>On Android or desktop, open your browser menu and choose <b>Install app</b>.</p>
    </section></div>}
  </>;
}

export function Layout() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const name = displayName(user, profile);
  const links = [
    { to: '/', label: 'Today', icon: Home, end: true },
    { to: '/groups', label: 'My groups', icon: Users },
    { to: '/classes', label: 'Classes', icon: BookOpen },
    { to: '/groups/new', label: 'Create group', icon: Plus },
    { to: '/profile', label: 'Profile', icon: UserRound },
    ...(profile?.role === 'admin' ? [{ to: '/admin', label: 'Admin', icon: Shield }] : []),
  ];
  const signOut = async () => {
    const { error } = await requireApi().auth.signOut();
    if (error) window.alert(error.message);
    navigate('/login');
  };
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/"><span className="brand-mark"><Flame size={23} fill="currentColor" /></span><span><b>emberly</b><i>Keep your spark alive.</i></span></a>
      <nav className="side-nav">{links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}><Icon size={19} /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><InstallButton />
        <button className="account-card" onClick={() => navigate('/profile')}><span className="avatar">{name.slice(0, 1).toUpperCase()}</span><span className="account-name"><b>{name}</b><small>{user?.email}</small></span><span className="account-switch">Edit</span></button>
        <button className="signout-button" onClick={signOut}><LogOut size={17} /> Sign out</button>
      </div>
    </aside>
    <div className="mobile-header"><a className="brand" href="/"><span className="brand-mark"><Flame size={21} fill="currentColor" /></span><b>emberly</b></a><button className="icon-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">{menuOpen ? <X /> : <Menu />}</button></div>
    {menuOpen && <nav className="mobile-menu">{links.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setMenuOpen(false)}><Icon size={18} />{label}</NavLink>)}<InstallButton /><button className="signout-button" onClick={signOut}><LogOut size={17} /> Sign out</button></nav>}
    <main className="main-content"><div className="content-wrap"><Outlet /></div></main>
  </div>;
}
