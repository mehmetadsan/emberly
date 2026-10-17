import { useEffect, useState } from 'react';
import { Check, Minus, Plus, Save } from 'lucide-react';
import { requireApi } from '../lib/apiClient.js';
import { displayName, todayString } from '../lib/userName.js';
import { habitStreak } from '../lib/streaks.js';
import { StreakBadge } from './StreakBadge.jsx';

export function HabitCheckIn({ habit, groupName, user, profile, logs, onSaved }) {
  const today = todayString();
  const log = logs.find((item) => item.habit_id === habit.id && item.user_id === user.id && item.date === today);
  const [value, setValue] = useState(log?.value || 0);
  const [note, setNote] = useState(log?.note || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setValue(log?.value || 0); setNote(log?.note || ''); }, [log?.id, log?.value, log?.note]);
  const isBoolean = habit.type === 'boolean';
  const step = habit.type === 'duration' ? 5 : 1;
  const completed = Boolean(log?.completed);
  const noteChanged = (log?.note || '') !== note;
  const streak = habitStreak(logs, habit.id, user.id);
  const save = async (nextValue) => {
    setSaving(true); setError('');
    const numericValue = Number(nextValue);
    const { error: saveError } = await requireApi().from('progress_logs').upsert({
      group_id: habit.group_id, habit_id: habit.id, user_id: user.id,
      user_name: displayName(user, profile),
      date: today, value: numericValue, completed: isBoolean ? Boolean(nextValue) : numericValue >= Number(habit.target_value), note,
    }, { onConflict: 'user_id,habit_id,date' });
    if (saveError) setError(saveError.message);
    else { if (isBoolean) setValue(nextValue ? 1 : 0); onSaved?.(); }
    setSaving(false);
  };
  const percent = Math.min(100, Math.round((Number(value) / Number(habit.target_value || 1)) * 100));
  return <article className={`habit-card${completed ? ' is-complete' : ''}`} style={{ '--habit-color': habit.color }}>
    <div className="habit-card-top"><span className="habit-dot" /><span className="habit-group">{groupName}</span>{streak > 0 && <StreakBadge streak={streak} />}</div>
    <h3>{habit.name}</h3>{habit.description && <p className="habit-description">{habit.description}</p>}
    {isBoolean ? <button className={`check-toggle${completed ? ' checked' : ''}`} onClick={() => save(!completed)} disabled={saving} aria-label={completed ? 'Undo check-in' : 'Check in'}>{completed ? <Check size={24} strokeWidth={3} /> : <span />}{completed ? 'Done for today' : 'Check in today'}</button> : <div className="goal-entry">
      <div className="stepper"><button className="icon-button" onClick={() => setValue(Math.max(0, Number(value) - step))} aria-label="Decrease"><Minus size={16} /></button><input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} /><span>{habit.unit}</span><button className="icon-button" onClick={() => setValue(Number(value) + step)} aria-label="Increase"><Plus size={16} /></button></div>
      <div className="progress-meta"><span>Daily goal</span><b>{value} / {habit.target_value} {habit.unit}</b></div><div className="progress-track"><span style={{ width: `${percent}%` }} /></div>
      <button className="button save-button" onClick={() => save(value)} disabled={saving}><Save size={15} />{saving ? 'Saving…' : 'Save progress'}</button>
    </div>}
    <textarea className="habit-note" rows="2" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note (optional)" aria-label="Check-in note" />
    {isBoolean && noteChanged && <button className="button save-button note-save-button" onClick={() => save(completed)} disabled={saving}><Save size={15} />{saving ? 'Saving…' : 'Save note'}</button>}
    {error && <p className="inline-error">{error}</p>}
    {completed && <p className="complete-label">Lovely work. Keep the spark going ✨</p>}
  </article>;
}
