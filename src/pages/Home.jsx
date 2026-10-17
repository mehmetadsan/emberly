import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, Flame, Plus, Users } from 'lucide-react';
import { requireApi } from '../lib/apiClient.js';
import { displayName, firstName, todayString } from '../lib/userName.js';
import { useAuth } from '../App.jsx';
import { HabitCheckIn } from '../components/HabitCheckIn.jsx';

export function HomePage() {
  const { user, profile } = useAuth();
  const [items, setItems] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const db = requireApi();
    const { data: memberships, error: membershipError } = await db.from('memberships').select('group_id').eq('user_id', user.id);
    if (membershipError) throw membershipError;
    const groupIds = memberships.map((item) => item.group_id);
    if (!groupIds.length) { setItems([]); setLogs([]); return; }
    const [{ data: habits, error: habitError }, { data: progress, error: logError }, { data: groups, error: groupsError }] = await Promise.all([
      db.from('habits').select('*').in('group_id', groupIds).is('deleted_at', null).order('created_at'),
      db.from('progress_logs').select('*').eq('user_id', user.id).in('group_id', groupIds).order('date'),
      db.from('groups').select('id,name').in('id', groupIds),
    ]);
    if (habitError) throw habitError;
    if (logError) throw logError;
    if (groupsError) throw groupsError;
    const groupNames = Object.fromEntries((groups || []).map((group) => [group.id, group.name]));
    setItems((habits || []).map((habit) => ({ habit, groupName: groupNames[habit.group_id] })));
    setLogs(progress || []);
  }, [user.id]);
  useEffect(() => {
    let mounted = true;
    setLoading(true); setError('');
    load().catch((err) => { if (mounted) setError(err.message); }).finally(() => { if (mounted) setLoading(false); });
    const channel = requireApi().channel(`home-progress-${user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'progress_logs' }, () => load().catch((err) => setError(err.message))).subscribe();
    return () => { mounted = false; requireApi().removeChannel(channel); };
  }, [load, user.id]);
  const completed = useMemo(() => logs.filter((log) => log.date === todayString() && log.completed).length, [logs]);
  const name = displayName(user, profile);
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  return <section className="page-section">
    <header className="page-header home-header"><div><p className="eyebrow">YOUR DAILY SPARK</p><h1>Hey, {firstName(name)} <span className="wave">✦</span></h1><p className="subheading"><CalendarDays size={16} />{dateLabel}</p></div>
      <div className="header-actions"><span className="done-chip"><Flame size={17} fill="currentColor" /> {completed} done today</span><Link className="button secondary" to="/groups"><Users size={17} /> Join with code</Link></div>
    </header>
    {error && <div className="notice error">{error}</div>}
    {loading ? <div className="card-loading"><span className="spinner" /> Loading your habits…</div> : items.length === 0 ? <div className="empty-card"><span className="empty-illustration">🌱</span><h2>No habits to check in yet</h2><p>Find your people, choose a goal, and build a little momentum together.</p><div className="empty-actions"><Link className="button primary" to="/groups"><Users size={17} /> Browse groups</Link><Link className="button secondary" to="/groups/new"><Plus size={17} /> Create a group</Link></div></div> :
      <><div className="section-title-row"><div><p className="eyebrow">ONE DAY AT A TIME</p><h2>Your habits</h2></div><Link className="subtle-link" to="/groups">View your groups <ArrowRight size={16} /></Link></div>
      <div className="habit-grid">{items.map(({ habit, groupName }) => <HabitCheckIn key={habit.id} habit={habit} groupName={groupName} user={user} profile={profile} logs={logs} onSaved={() => load().catch((err) => setError(err.message))} />)}</div></>}
  </section>;
}
