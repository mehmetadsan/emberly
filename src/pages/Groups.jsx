import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, ArrowRight, BarChart3, Check, Clipboard, Globe2, LockKeyhole, Plus, RotateCcw, Trash2, Users, X } from 'lucide-react';
import { requireApi } from '../lib/apiClient.js';
import { displayName, todayString } from '../lib/userName.js';
import { useAuth } from '../App.jsx';
import { HabitCheckIn } from '../components/HabitCheckIn.jsx';

const colors = ['#2d58e1', '#e63e8c', '#00a985', '#ff7a26', '#6c55dc', '#f0a82e'];

function GroupCard({ group, count, joined, onJoin }) {
  return <article className="group-card">
    <div className="group-cover" style={{ '--cover': group.cover_color }}><span>{group.name.slice(0, 1).toUpperCase()}</span>{group.visibility === 'private' ? <LockKeyhole size={17} /> : <Globe2 size={17} />}</div>
    <div className="group-card-body"><div className="group-card-title"><h3>{group.name}</h3><span className="member-count"><Users size={14} />{count ?? '—'}</span></div>
      <p>{group.description || 'A little group with room to grow.'}</p><div className="group-card-footer">{joined ? <Link className="text-button" to={`/groups/${group.id}`}>Open group <ArrowRight size={15} /></Link> : <button className="button small primary" onClick={() => onJoin(group)}>Join group <ArrowRight size={15} /></button>}</div>
    </div>
  </article>;
}

export function GroupsPage() {
  const { user, profile } = useAuth();
  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [joinedId, setJoinedId] = useState(null);
  const load = useCallback(async () => {
    const db = requireApi();
    const { data: all, error: allError } = await db.from('groups').select('*').order('created_at', { ascending: false });
    if (allError) throw allError;
    const { data: memberships, error: memberError } = await db.from('memberships').select('group_id,role').eq('user_id', user.id);
    if (memberError) throw memberError;
    const { data: counts, error: countError } = await db.from('memberships').select('group_id');
    if (countError) throw countError;
    setGroups(all || []);
    setMembers({ roles: Object.fromEntries(memberships.map((item) => [item.group_id, item.role])), counts: (counts || []).reduce((acc, item) => ({ ...acc, [item.group_id]: (acc[item.group_id] || 0) + 1 }), {}) });
  }, [user.id]);
  useEffect(() => {
    load().catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [load]);
  const joinByCode = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    const { data, error: joinError } = await requireApi().rpc('join_group_by_code', { code: code.trim().toUpperCase().replace(/\s/g, '') });
    if (joinError) setError(joinError.message);
    else { setJoinedId(data); setCode(''); await load(); }
    setBusy(false);
  };
  const joinPublic = async (group) => {
    const { error: joinError } = await requireApi().from('memberships').insert({ group_id: group.id, user_id: user.id, user_name: displayName(user, profile), role: 'member' });
    if (joinError) setError(joinError.message);
    else { await load(); setJoinedId(group.id); }
  };
  const mine = groups.filter((group) => members.roles?.[group.id]);
  const discover = groups.filter((group) => group.visibility === 'public' && !members.roles?.[group.id]);
  if (loading) return <div className="card-loading"><span className="spinner" /> Loading your groups…</div>;
  return <section className="page-section">
    <header className="page-header"><div><p className="eyebrow">BETTER TOGETHER</p><h1>My groups</h1><p className="subheading">Build good habits with people who cheer you on.</p></div><Link className="button primary" to="/groups/new"><Plus size={18} /> Create group</Link></header>
    <form className="join-code-form" onSubmit={joinByCode}><div><b>Have an invite code?</b><small>Enter the code your group shared with you.</small></div><input aria-label="Invite code" placeholder="GRP-ABC" value={code} onChange={(e) => setCode(e.target.value)} /><button className="button secondary" disabled={busy || !code.trim()}>{busy ? 'Joining…' : 'Join with code'}</button></form>
    {error && <p className="notice error">{error}</p>}
    {joinedId && <div className="notice success">You’re in! <Link to={`/groups/${joinedId}`}>Open your group</Link></div>}
    <div className="section-title-row"><div><p className="eyebrow">YOUR PEOPLE</p><h2>My groups <span className="count-pill">{mine.length}</span></h2></div></div>
    {mine.length ? <div className="group-grid">{mine.map((group) => <GroupCard key={group.id} group={group} count={members.counts[group.id]} joined onJoin={joinPublic} />)}</div> : <div className="compact-empty">You haven’t joined a group yet. Create one or use an invite code above.</div>}
    <div className="section-title-row discover-heading"><div><p className="eyebrow">FIND YOUR CREW</p><h2>Discover groups <span className="count-pill">{discover.length}</span></h2></div></div>
    {discover.length ? <div className="group-grid">{discover.map((group) => <GroupCard key={group.id} group={group} count={members.counts[group.id]} onJoin={joinPublic} />)}</div> : <div className="compact-empty">No public groups to discover right now. Start one and invite your people.</div>}
  </section>;
}

export function NewGroupPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', description: '', visibility: 'public', cover_color: colors[0] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    const db = requireApi();
    try {
      const invite = `GRP-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      const { data: group, error: groupError } = await db.from('groups').insert({ ...form, invite_code: invite, created_by: user.id }).select().single();
      if (groupError) throw groupError;
      const { error: membershipError } = await db.from('memberships').insert({ group_id: group.id, user_id: user.id, user_name: displayName(user, profile), role: 'admin' });
      if (membershipError) {
        const { error: cleanupError } = await db.from('groups').delete().eq('id', group.id);
        if (cleanupError) throw new Error(`${membershipError.message}. Group cleanup also failed: ${cleanupError.message}`);
        throw membershipError;
      }
      navigate(`/groups/${group.id}`);
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return <section className="narrow-page">
    <Link className="back-link" to="/groups"><ArrowLeft size={16} /> Groups</Link>
    <header className="page-header"><div><p className="eyebrow">MAKE IT A TEAM THING</p><h1>Create a group</h1><p className="subheading">Choose a name, invite your people, and get started.</p></div></header>
    <form className="surface form-card" onSubmit={submit}>
      <label className="form-field"><span>Group name</span><input required maxLength="60" value={form.name} onChange={change('name')} placeholder="The Morning Movers" /></label>
      <label className="form-field"><span>Description <small>(optional)</small></span><textarea rows="3" maxLength="240" value={form.description} onChange={change('description')} placeholder="What are you working on together?" /></label>
      <label className="form-field"><span>Who can find this group?</span><select value={form.visibility} onChange={change('visibility')}><option value="public">Public — anyone can discover</option><option value="private">Private — invite code only</option></select></label>
      <div className="form-field"><span>Cover color</span><div className="color-picker">{colors.map((color) => <button type="button" key={color} className={form.cover_color === color ? 'selected' : ''} style={{ '--swatch': color }} onClick={() => setForm({ ...form, cover_color: color })} aria-label={`Select ${color}`} />)}</div></div>
      {error && <p className="notice error">{error}</p>}<button className="button primary full" disabled={busy}>{busy ? 'Creating…' : 'Create group'}</button>
    </form>
  </section>;
}

function HabitForm({ groupId, user, editing, onClose, onSaved }) {
  const [form, setForm] = useState(editing || { name: '', description: '', type: 'boolean', target_value: 1, unit: '', color: '#22c55e' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    const payload = { ...form, target_value: Number(form.target_value), group_id: groupId, created_by: user.id };
    const query = editing
      ? requireApi().from('habits').update(payload).eq('id', editing.id)
      : requireApi().from('habits').insert(payload);
    const { error: saveError } = await query;
    if (saveError) { setError(saveError.message); setBusy(false); }
    else { onSaved(); onClose(); }
  };
  return <div className="modal-backdrop" onClick={onClose}><form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
    <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button><p className="eyebrow">SHARED GOALS</p><h2>{editing ? 'Edit habit' : 'Add a habit'}</h2>
    <label className="form-field"><span>Name</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Read for 20 minutes" /></label>
    <label className="form-field"><span>Description</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional details" /></label>
    <label className="form-field"><span>Goal type</span><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="boolean">Daily check-in</option><option value="numeric">Numeric goal</option><option value="duration">Duration</option></select></label>
    {form.type !== 'boolean' && <div className="form-row"><label className="form-field"><span>Daily target</span><input required type="number" min="1" value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} /></label><label className="form-field"><span>Unit</span><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="pages, min" /></label></div>}
    <div className="form-field"><span>Color</span><div className="color-picker">{['#22c55e', '#6366f1', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6'].map((color) => <button type="button" key={color} className={form.color === color ? 'selected' : ''} style={{ '--swatch': color }} onClick={() => setForm({ ...form, color })} aria-label={`Select ${color}`} />)}</div></div>
    {error && <p className="notice error">{error}</p>}<button className="button primary full" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add habit'}</button>
  </form></div>;
}

export function GroupPage() {
  const { id } = useParams();
  const { user, profile } = useAuth();
  const [group, setGroup] = useState(null);
  const [membership, setMembership] = useState(null);
  const [members, setMembers] = useState([]);
  const [habits, setHabits] = useState([]);
  const [logs, setLogs] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [copied, setCopied] = useState(false);
  const [month, setMonth] = useState(todayString().slice(0, 7));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const db = requireApi();
  const load = useCallback(async () => {
    const [{ data: groupData, error: groupError }, { data: membershipData, error: ownMembershipError }, { data: memberData, error: membersError }, { data: habitData, error: habitsError }, { data: logData, error: logsError }] = await Promise.all([
      db.from('groups').select('*').eq('id', id).maybeSingle(),
      db.from('memberships').select('*').eq('group_id', id).eq('user_id', user.id).maybeSingle(),
      db.from('memberships').select('*').eq('group_id', id),
      db.from('habits').select('*').eq('group_id', id).order('created_at'),
      db.from('progress_logs').select('*').eq('group_id', id).order('date'),
    ]);
    const err = groupError || ownMembershipError || membersError || habitsError || logsError;
    if (err) throw err;
    setGroup(groupData); setMembership(membershipData); setMembers(memberData || []); setHabits(habitData || []); setLogs(logData || []);
    if (groupData && (membershipData?.role === 'admin' || profile?.role === 'admin')) {
      const old = (habitData || []).filter((habit) => habit.deleted_at && Date.now() - new Date(habit.deleted_at).getTime() > 30 * 86400000);
      if (old.length) {
        const { error: purgeError } = await db.from('habits').delete().in('id', old.map((habit) => habit.id));
        if (purgeError) throw purgeError;
        setHabits((habitData || []).filter((habit) => !old.includes(habit)));
        setLogs((logData || []).filter((log) => !old.some((habit) => habit.id === log.habit_id)));
      }
    }
  }, [db, id, profile?.role, user.id]);
  useEffect(() => {
    load().catch((err) => setError(err.message)).finally(() => setLoading(false));
    const channel = db.channel(`group-progress-${id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'progress_logs', filter: `group_id=eq.${id}` }, () => load().catch((err) => setError(err.message))).subscribe();
    return () => { db.removeChannel(channel); };
  }, [db, id, load]);
  const isAdmin = membership?.role === 'admin';
  const activeHabits = habits.filter((habit) => !habit.deleted_at);
  const archivedHabits = habits.filter((habit) => habit.deleted_at);
  const archive = async (habit) => {
    if (!window.confirm(`Archive "${habit.name}"? Progress will be kept for 30 days.`)) return;
    const { error: saveError } = await db.from('habits').update({ deleted_at: new Date().toISOString() }).eq('id', habit.id);
    if (saveError) setError(saveError.message); else load().catch((err) => setError(err.message));
  };
  const restore = async (habit) => {
    const { error: saveError } = await db.from('habits').update({ deleted_at: null }).eq('id', habit.id);
    if (saveError) setError(saveError.message); else load().catch((err) => setError(err.message));
  };
  const deleteNow = async (habit) => {
    if (!window.confirm(`Delete "${habit.name}" and its progress history permanently?`)) return;
    const { error: deleteError } = await db.from('habits').delete().eq('id', habit.id);
    if (deleteError) setError(deleteError.message); else load().catch((err) => setError(err.message));
  };
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(group.invite_code); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }
    catch { setError('Clipboard access is unavailable. Copy the invite code manually.'); }
  };
  if (loading) return <div className="card-loading"><span className="spinner" /> Loading group…</div>;
  if (error && !group) return <div className="notice error">{error}<Link to="/groups"> Back to groups</Link></div>;
  if (!group) return <div className="empty-state"><h2>Group not found</h2><Link to="/groups">Back to groups</Link></div>;
  if (!membership) return <section className="narrow-page"><Link className="back-link" to="/groups"><ArrowLeft size={16} /> Groups</Link><div className="surface access-card"><h1>{group.name}</h1><p>You’ll need an invite code to join this group.</p><form onSubmit={async (event) => { event.preventDefault(); const { error: joinError } = await db.rpc('join_group_by_code', { code: event.currentTarget.elements.invite.value }); if (joinError) setError(joinError.message); else load().catch((err) => setError(err.message)); }}><input name="invite" placeholder="GRP-ABC" required /><button className="button primary">Join group</button></form>{error && <p className="notice error">{error}</p>}</div></section>;
  const monthLogs = logs.filter((log) => log.date.startsWith(month));
  const analytics = members.map((member) => ({ name: member.user_name || 'Member', checkIns: monthLogs.filter((log) => log.user_id === member.user_id && log.completed).length }));
  const monthDays = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const trend = Array.from({ length: monthDays }, (_, index) => {
    const day = `${month}-${String(index + 1).padStart(2, '0')}`;
    return activeHabits.reduce((row, habit) => ({
      ...row, day: String(index + 1),
      [habit.id]: monthLogs.filter((log) => log.date === day && log.habit_id === habit.id && log.completed).length,
    }), { day: String(index + 1) });
  });
  return <section className="page-section">
    <Link className="back-link" to="/groups"><ArrowLeft size={16} /> All groups</Link>
    <div className="group-detail-cover" style={{ '--cover': group.cover_color }}><span className="group-hero-initial">{group.name.slice(0, 1).toUpperCase()}</span><div className="group-hero-text"><span>{group.visibility === 'private' ? <LockKeyhole size={14} /> : <Globe2 size={14} />}{group.visibility}</span><h1>{group.name}</h1><p>{group.description || 'Making progress together, one day at a time.'}</p></div><button className="invite-copy" onClick={copyCode}><Clipboard size={15} /> Code: {group.invite_code} {copied ? <Check size={15} /> : null}</button></div>
    {error && <p className="notice error">{error}</p>}
    <div className="detail-metadata"><span><Users size={16} />{members.length} members</span><span>Since {new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(group.created_at))}</span></div>
    <div className="section-title-row"><div><p className="eyebrow">YOUR DAILY MOMENTUM</p><h2>My check-ins today</h2></div>{isAdmin && <button className="button secondary" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={16} /> Add habit</button>}</div>
    {activeHabits.length ? <div className="habit-grid">{activeHabits.map((habit) => <HabitCheckIn key={habit.id} habit={habit} user={user} profile={profile} logs={logs} onSaved={() => load().catch((err) => setError(err.message))} />)}</div> : <div className="compact-empty">{isAdmin ? 'Add the first shared habit to get everyone started.' : 'The group has not added any habits yet.'}</div>}
    <div className="section-title-row board-heading"><div><p className="eyebrow">A LITTLE ACCOUNTABILITY</p><h2>Group board · today</h2></div></div>
    <div className="surface table-wrap"><table className="progress-table"><thead><tr><th>Member</th>{activeHabits.map((habit) => <th key={habit.id}>{habit.name}</th>)}</tr></thead><tbody>{members.map((member) => <tr key={member.id}><td><span className="avatar mini">{(member.user_name || 'M').slice(0, 1).toUpperCase()}</span>{member.user_name || 'Member'} {member.role === 'admin' && <span className="owner-label">admin</span>}</td>{activeHabits.map((habit) => { const done = logs.some((log) => log.user_id === member.user_id && log.habit_id === habit.id && log.date === todayString() && log.completed); return <td key={habit.id}><span className={`matrix-cell${done ? ' checked' : ''}`} style={{ '--habit-color': habit.color }}>{done ? <Check size={14} /> : '·'}</span></td>; })}</tr>)}</tbody></table></div>
    {isAdmin && <><div className="section-title-row board-heading"><div><p className="eyebrow">CELEBRATE THE WINS</p><h2><BarChart3 size={21} /> Monthly analytics</h2></div><input className="month-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
      <div className="surface analytics-card"><div className="chart-title"><h3>Completions per member</h3><span>{month}</span></div>{analytics.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height={250}><AreaChart data={analytics}><defs><linearGradient id="analyticsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2d58e1" stopOpacity={0.3} /><stop offset="95%" stopColor="#2d58e1" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Area type="monotone" dataKey="checkIns" stroke="#2d58e1" fill="url(#analyticsFill)" strokeWidth={3} /></AreaChart></ResponsiveContainer></div> : <p className="compact-empty">No members yet.</p>}</div>
      <div className="surface analytics-card trend-card"><div className="chart-title"><h3>Daily trend by habit</h3><span>Completed check-ins · {month}</span></div>{activeHabits.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height={250}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" /><YAxis allowDecimals={false} /><Tooltip />{activeHabits.map((habit) => <Line key={habit.id} type="monotone" dataKey={habit.id} name={habit.name} stroke={habit.color} strokeWidth={2} dot={false} />)}</LineChart></ResponsiveContainer></div> : <p className="compact-empty">Add an active habit to see trends.</p>}</div>
      <div className="section-title-row board-heading"><div><p className="eyebrow">RESTORE ANYTIME</p><h2>Archived habits</h2></div></div>
      {archivedHabits.length ? <div className="archive-list">{archivedHabits.map((habit) => { const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(habit.deleted_at).getTime()) / 86400000)); return <article className="archive-item" key={habit.id}><span className="habit-dot" style={{ '--habit-color': habit.color }} /><div><b>{habit.name}</b><small>Archived {new Date(habit.deleted_at).toLocaleDateString()} · {daysLeft} days left</small></div><div className="archive-actions"><button className="text-button" onClick={() => restore(habit)}><RotateCcw size={15} /> Restore</button><button className="danger-icon" onClick={() => deleteNow(habit)} aria-label="Delete now"><Trash2 size={16} /></button></div></article>; })}</div> : <div className="compact-empty">No archived habits.</div>}
      <div className="section-title-row board-heading"><div><p className="eyebrow">KEEP THE GOALS FRESH</p><h2>Manage habits</h2></div></div>
      <div className="manage-list">{activeHabits.map((habit) => <article className="manage-habit" key={habit.id}><span className="habit-dot" style={{ '--habit-color': habit.color }} /><div className="manage-habit-name"><b>{habit.name}</b><small>{habit.type === 'boolean' ? 'Daily check-in' : `${habit.target_value} ${habit.unit} / day`}</small></div><button className="icon-button" onClick={() => { setEditing(habit); setShowForm(true); }} aria-label="Edit habit">✎</button><button className="danger-icon" onClick={() => archive(habit)} aria-label="Archive habit"><Trash2 size={16} /></button></article>)}</div></>}
    {showForm && <HabitForm groupId={id} user={user} editing={editing} onClose={() => setShowForm(false)} onSaved={() => load().catch((err) => setError(err.message))} />}
  </section>;
}
