import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, LogOut, Shield, Trash2, UserRound, Users, X } from 'lucide-react';
import { requireApi } from '../lib/apiClient.js';
import { displayName } from '../lib/userName.js';
import { useAuth } from '../App.jsx';

function getAccounts() {
  try {
    const accounts = JSON.parse(localStorage.getItem('emberly_profiles') || '[]');
    return Array.isArray(accounts) ? accounts : [];
  }
  catch { return []; }
}

function AccountSwitcher({ user, navigate }) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState(getAccounts);
  const [error, setError] = useState('');
  const db = requireApi();
  const refresh = () => setAccounts(getAccounts());
  const switchTo = async (account) => {
    if (account.id === user.id) { setOpen(false); return; }
    if (!account.access_token || !account.refresh_token) {
      localStorage.setItem('emberly_pending_email', account.email || '');
      await db.auth.signOut();
      navigate('/login');
      return;
    }
    const { error: switchError } = await db.auth.setSession({ access_token: account.access_token, refresh_token: account.refresh_token });
    if (switchError) {
      localStorage.setItem('emberly_pending_email', account.email || '');
      await db.auth.signOut();
      navigate('/login');
      return;
    }
    localStorage.setItem('emberly_active_id', account.id);
    window.location.reload();
  };
  const remove = async (account) => {
    const remaining = accounts.filter((item) => item.id !== account.id);
    localStorage.setItem('emberly_profiles', JSON.stringify(remaining));
    refresh();
    if (account.id === user.id) {
      if (remaining.length) await switchTo(remaining[0]);
      else { await db.auth.signOut(); navigate('/login'); }
    }
  };
  return <><button className="button secondary" onClick={() => { refresh(); setOpen(true); }}><Users size={17} /> Switch / add account</button>
    {open && <div className="modal-backdrop" onClick={() => setOpen(false)}><section className="modal-card account-modal" onClick={(e) => e.stopPropagation()}><button className="icon-button modal-close" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button><p className="eyebrow">YOUR DEVICE</p><h2>Accounts</h2>
      {accounts.map((account) => <div className="saved-account" key={account.id}><span className="avatar">{(account.display_name || account.full_name || account.email || '?').slice(0, 1).toUpperCase()}</span><div><b>{account.display_name || account.full_name || account.email}</b><small>{account.email}</small></div>{account.id === user.id ? <span className="active-pill">Active</span> : <button className="text-button" onClick={() => switchTo(account)}>Switch</button>}<button className="danger-icon" onClick={() => remove(account)} aria-label="Remove from this device"><Trash2 size={15} /></button></div>)}
      {!accounts.length && <p className="muted">No other saved accounts.</p>}{error && <p className="notice error">{error}</p>}
      <button className="button primary full add-account-button" onClick={async () => { await db.auth.signOut(); setOpen(false); navigate('/login'); }}>Sign in with another account</button>
      <p className="muted tiny-note">Removing an account only removes its saved sign-in from this device.</p>
    </section></div>}
  </>;
}

export function ProfilePage() {
  const { user, profile, setProfile } = useAuth();
  const [name, setName] = useState(displayName(user, profile));
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  useEffect(() => setName(displayName(user, profile)), [user, profile]);
  const save = async (event) => {
    event.preventDefault(); setError(''); setNotice('');
    if (!name.trim()) { setError('Name cannot be empty.'); return; }
    setSaving(true);
    const { error: saveError } = await requireApi().rpc('update_my_display_name', { new_name: name.trim() });
    if (saveError) setError(saveError.message);
    else {
      const updated = { ...profile, display_name: name.trim() };
      setProfile(updated);
      try {
        const records = JSON.parse(localStorage.getItem('emberly_profiles') || '[]').map((account) => account.id === user.id ? { ...account, display_name: name.trim() } : account);
        localStorage.setItem('emberly_profiles', JSON.stringify(records));
      } catch { setError('Your name was saved, but this device could not update the saved account label.'); }
      setNotice('Your profile has been updated.');
    }
    setSaving(false);
  };
  return <section className="narrow-page">
    <header className="page-header"><div><p className="eyebrow">A LITTLE ABOUT YOU</p><h1>Your profile</h1><p className="subheading">Your name is what your group sees on the board.</p></div></header>
    <div className="surface profile-card"><div className="profile-identity"><span className="profile-avatar">{displayName(user, profile).slice(0, 1).toUpperCase()}</span><div><h2>{displayName(user, profile)}</h2><p>{user.email}</p><span className="role-pill">{profile?.role === 'admin' ? <Shield size={13} /> : <UserRound size={13} />}{profile?.role === 'admin' ? 'Platform admin' : 'Emberly member'}</span></div></div>
      <form className="profile-form" onSubmit={save}><label className="form-field"><span>Display name</span><input maxLength="80" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></label>
        {error && <p className="notice error">{error}</p>}{notice && <p className="notice success"><Check size={15} />{notice}</p>}<button className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </form>
    </div>
    <div className="surface account-settings"><div><h3>More than one account?</h3><p>Switch between saved Emberly accounts on this device.</p></div><AccountSwitcher user={user} navigate={navigate} /></div>
  </section>;
}

export function AdminPage() {
  const [profiles, setProfiles] = useState([]);
  const [stats, setStats] = useState({});
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [expanded, setExpanded] = useState('');
  const [groupMembers, setGroupMembers] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const db = requireApi();
  useEffect(() => {
    const load = async () => {
      const [userResult, groupResult, memberships, habits, logs] = await Promise.all([
        db.from('profiles').select('*').order('created_at', { ascending: false }),
        db.from('groups').select('*').order('created_at', { ascending: false }),
        db.from('memberships').select('id'), db.from('habits').select('id'), db.from('progress_logs').select('id'),
      ]);
      const failure = [userResult, groupResult, memberships, habits, logs].find((result) => result.error);
      if (failure) throw failure.error;
      setProfiles(userResult.data || []); setGroups(groupResult.data || []);
      setStats({ users: userResult.data?.length || 0, groups: groupResult.data?.length || 0, memberships: memberships.data?.length || 0, habits: habits.data?.length || 0, logs: logs.data?.length || 0 });
    };
    load().catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [db]);
  const filtered = useMemo(() => profiles.filter((profile) => {
    const matches = `${profile.email} ${profile.display_name}`.toLowerCase().includes(search.toLowerCase());
    return matches && (roleFilter === 'all' || profile.role === roleFilter);
  }), [profiles, roleFilter, search]);
  const setRole = async (profile, role) => {
    const { error: updateError } = await db.from('profiles').update({ role }).eq('id', profile.id);
    if (updateError) setError(updateError.message);
    else setProfiles((items) => items.map((item) => item.id === profile.id ? { ...item, role } : item));
  };
  const resetPassword = async (person) => {
    const password = window.prompt(`Set a new password for ${person.email} (at least 8 characters):`);
    if (password === null) return;
    setError(''); setNotice('');
    const { error: resetError } = await db.admin.setPassword(person.id, password);
    if (resetError) setError(resetError.message);
    else setNotice(`Password set for ${person.email}.`);
  };
  const toggleGroup = async (group) => {
    if (expanded === group.id) { setExpanded(''); return; }
    setExpanded(group.id);
    if (groupMembers[group.id]) return;
    const [{ data: members, error: memberError }, { data: activity, error: activityError }] = await Promise.all([
      db.from('memberships').select('*').eq('group_id', group.id),
      db.from('progress_logs').select('user_id,completed').eq('group_id', group.id),
    ]);
    if (memberError || activityError) setError((memberError || activityError).message);
    else {
      const counts = (activity || []).reduce((acc, log) => ({ ...acc, [log.user_id]: (acc[log.user_id] || 0) + (log.completed ? 1 : 0) }), {});
      setGroupMembers({ ...groupMembers, [group.id]: (members || []).map((member) => ({ ...member, activity: counts[member.user_id] || 0 })) });
    }
  };
  if (loading) return <div className="card-loading"><span className="spinner" /> Loading admin panel…</div>;
  return <section className="page-section"><header className="page-header"><div><p className="eyebrow">EMBERLY CONTROL ROOM</p><h1>Admin panel</h1><p className="subheading">A simple overview of your community.</p></div></header>
    {error && <p className="notice error">{error}</p>}{notice && <p className="notice success">{notice}</p>}
    <div className="stats-grid">{Object.entries(stats).map(([key, value]) => <article className="stat-card" key={key}><span>{key}</span><b>{value.toLocaleString()}</b></article>)}</div>
    <div className="section-title-row admin-section-heading"><div><p className="eyebrow">PEOPLE FIRST</p><h2>Users</h2></div><div className="admin-filters"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email or name" aria-label="Search users" /><select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role"><option value="all">All roles</option><option value="admin">Admins</option><option value="user">Members</option></select></div></div>
    <div className="surface table-wrap"><table className="admin-table"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Joined</th><th>Account</th></tr></thead><tbody>{filtered.map((person) => <tr key={person.id}><td>{person.email}</td><td>{person.display_name || '—'}</td><td><select value={person.role} onChange={(e) => setRole(person, e.target.value)} aria-label={`Role for ${person.email}`}><option value="user">Member</option><option value="admin">Admin</option></select></td><td>{new Date(person.created_at).toLocaleDateString()}</td><td><button className="text-button" onClick={() => resetPassword(person)}>Set password</button></td></tr>)}{!filtered.length && <tr><td colSpan="5" className="table-empty">No matching users.</td></tr>}</tbody></table></div>
    <div className="section-title-row admin-section-heading"><div><p className="eyebrow">HOW WE SHOW UP</p><h2>Groups</h2></div></div>
    <div className="admin-group-list">{groups.map((group) => <article className="admin-group surface" key={group.id}><button className="admin-group-toggle" onClick={() => toggleGroup(group)}><span className="habit-dot" style={{ '--habit-color': group.cover_color }} /><b>{group.name}</b><span>{group.visibility}</span><ArrowRight className={expanded === group.id ? 'turned' : ''} size={17} /></button>
      {expanded === group.id && <div className="admin-members">{(groupMembers[group.id] || []).map((member) => <div key={member.id}><span className="avatar mini">{(member.user_name || 'M').slice(0, 1).toUpperCase()}</span><span>{member.user_name || 'Member'} {member.role === 'admin' && <small>owner</small>}</span><b>{member.activity} check-ins</b></div>)}{groupMembers[group.id]?.length === 0 && <p className="muted">No members in this group yet.</p>}</div>}
    </article>)}</div>
  </section>;
}
