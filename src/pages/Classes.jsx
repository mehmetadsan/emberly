import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Check, Plus, Trash2, X } from 'lucide-react';
import { requireApi } from '../lib/apiClient.js';
import { displayName, todayString } from '../lib/userName.js';
import { readingStreak } from '../lib/streaks.js';
import { useAuth } from '../App.jsx';
import { StreakBadge } from '../components/StreakBadge.jsx';

const classColors = ['#2d58e1', '#00a985', '#e63e8c', '#ff7a26', '#7258d8'];

export function ClassesPage() {
  const { user } = useAuth();
  const [classes, setClasses] = useState([]);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const db = requireApi();
    const load = async () => {
      const { data, error: queryError } = await db.from('classes').select('*').eq('teacher_id', user.id).order('created_at', { ascending: false });
      if (queryError) throw queryError;
      setClasses(data || []);
      if (!data?.length) return;
      const { data: students, error: studentError } = await db.from('students').select('class_id').in('class_id', data.map((item) => item.id));
      if (studentError) throw studentError;
      setCounts((students || []).reduce((acc, student) => ({ ...acc, [student.class_id]: (acc[student.class_id] || 0) + 1 }), {}));
    };
    load().catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [user.id]);
  if (loading) return <div className="card-loading"><span className="spinner" /> Loading classes…</div>;
  return <section className="page-section">
    <header className="page-header"><div><p className="eyebrow">A CLASSROOM FULL OF STORIES</p><h1>My classes</h1><p className="subheading">Make every page count, one reader at a time.</p></div><Link className="button primary" to="/classes/new"><Plus size={17} /> Create class</Link></header>
    {error && <p className="notice error">{error}</p>}
    {classes.length ? <div className="class-grid">{classes.map((item) => <Link className="class-card" key={item.id} to={`/classes/${item.id}`}><div className="class-cover" style={{ '--cover': item.cover_color }}><BookOpen size={25} /><span>{item.name.slice(0, 1)}</span></div><div className="class-card-content"><h3>{item.name}</h3><p>{[item.subject, item.grade].filter(Boolean).join(' · ') || 'Reading class'}</p><span className="student-count">{counts[item.id] || 0} students <span>→</span></span></div></Link>)}</div> : <div className="empty-card"><span className="empty-illustration">📚</span><h2>Start your first class</h2><p>Add a class, assign a book, and celebrate each student’s reading streak.</p><Link className="button primary" to="/classes/new"><Plus size={17} /> Create class</Link></div>}
  </section>;
}

export function NewClassPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', subject: '', grade: '', cover_color: classColors[0] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true);
    const { data, error: insertError } = await requireApi().from('classes').insert({ ...form, teacher_id: user.id, teacher_name: displayName(user, profile) }).select().single();
    if (insertError) { setError(insertError.message); setBusy(false); }
    else navigate(`/classes/${data.id}`);
  };
  return <section className="narrow-page"><Link className="back-link" to="/classes"><ArrowLeft size={16} /> Classes</Link><header className="page-header"><div><p className="eyebrow">MAKE SPACE FOR STORIES</p><h1>Create a class</h1><p className="subheading">Set up a place to follow your readers’ progress.</p></div></header>
    <form className="surface form-card" onSubmit={submit}><label className="form-field"><span>Class name</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Room 12 Readers" /></label><div className="form-row"><label className="form-field"><span>Subject</span><input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Reading" /></label><label className="form-field"><span>Grade</span><input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} placeholder="Grade 4" /></label></div>
      <div className="form-field"><span>Cover color</span><div className="color-picker">{classColors.map((color) => <button type="button" key={color} className={form.cover_color === color ? 'selected' : ''} style={{ '--swatch': color }} onClick={() => setForm({ ...form, cover_color: color })} aria-label={`Select ${color}`} />)}</div></div>
      {error && <p className="notice error">{error}</p>}<button className="button primary full" disabled={busy}>{busy ? 'Creating…' : 'Create class'}</button></form></section>;
}

function ProgressRing({ pct }) {
  const normalized = Math.max(0, Math.min(100, pct));
  return <div className="progress-ring" style={{ '--ring-pct': `${normalized * 3.6}deg` }}><div><b>{normalized}%</b></div></div>;
}

function ReadingLogDialog({ student, current, onClose, onSaved }) {
  const [form, setForm] = useState({ pages_read: current?.pages_read || 0, chapters_read: current?.chapters_read || 0, completed: current?.completed || false, note: current?.note || '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    const payload = {
      student_id: student.id, class_id: student.class_id, student_name: student.name,
      date: todayString(), pages_read: Number(form.pages_read), chapters_read: Number(form.chapters_read),
      completed: form.completed, note: form.note,
    };
    const { error: saveError } = await requireApi().from('reading_logs').upsert(payload, { onConflict: 'student_id,date' });
    if (saveError) { setError(saveError.message); setBusy(false); }
    else { onSaved(); onClose(); }
  };
  return <div className="modal-backdrop" onClick={onClose}><form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}><button type="button" className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button><p className="eyebrow">TODAY’S READING</p><h2>Log for {student.name}</h2>
    <div className="form-row"><label className="form-field"><span>Pages read</span><input type="number" min="0" value={form.pages_read} onChange={(e) => setForm({ ...form, pages_read: e.target.value })} /></label><label className="form-field"><span>Chapters read</span><input type="number" min="0" value={form.chapters_read} onChange={(e) => setForm({ ...form, chapters_read: e.target.value })} /></label></div>
    <label className="form-field"><span>Note <small>(optional)</small></span><textarea rows="2" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="A favorite part…" /></label>
    <label className="checkbox-line"><input type="checkbox" checked={form.completed} onChange={(e) => setForm({ ...form, completed: e.target.checked })} /> Finished the assigned reading</label>
    {error && <p className="notice error">{error}</p>}<button className="button primary full" disabled={busy}>{busy ? 'Saving…' : 'Save reading log'}</button>
  </form></div>;
}

export function ClassPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [classData, setClassData] = useState(null);
  const [students, setStudents] = useState([]);
  const [logs, setLogs] = useState([]);
  const [studentName, setStudentName] = useState('');
  const [editingBook, setEditingBook] = useState(false);
  const [book, setBook] = useState(null);
  const [activeStudent, setActiveStudent] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const db = requireApi();
  const load = useCallback(async () => {
    const [{ data: classResult, error: classError }, { data: studentResult, error: studentError }, { data: logResult, error: logError }] = await Promise.all([
      db.from('classes').select('*').eq('id', id).maybeSingle(),
      db.from('students').select('*').eq('class_id', id).order('name'),
      db.from('reading_logs').select('*').eq('class_id', id).order('date'),
    ]);
    const queryError = classError || studentError || logError;
    if (queryError) throw queryError;
    setClassData(classResult); setStudents(studentResult || []); setLogs(logResult || []);
    setBook(classResult ? { book_title: classResult.book_title, book_author: classResult.book_author, book_total_pages: classResult.book_total_pages, book_total_chapters: classResult.book_total_chapters } : null);
  }, [db, id]);
  useEffect(() => { load().catch((err) => setError(err.message)).finally(() => setLoading(false)); }, [load]);
  const addStudent = async (event) => {
    event.preventDefault();
    const { error: insertError } = await db.from('students').insert({ name: studentName.trim(), class_id: id });
    if (insertError) setError(insertError.message); else { setStudentName(''); load().catch((err) => setError(err.message)); }
  };
  const removeStudent = async (student) => {
    if (!window.confirm(`Remove ${student.name} and all their reading logs?`)) return;
    const { error: deleteError } = await db.from('students').delete().eq('id', student.id);
    if (deleteError) setError(deleteError.message); else load().catch((err) => setError(err.message));
  };
  const saveBook = async (event) => {
    event.preventDefault();
    const payload = { ...book, book_total_pages: Number(book.book_total_pages), book_total_chapters: Number(book.book_total_chapters) };
    const { error: updateError } = await db.from('classes').update(payload).eq('id', id);
    if (updateError) setError(updateError.message); else { setEditingBook(false); load().catch((err) => setError(err.message)); }
  };
  if (loading) return <div className="card-loading"><span className="spinner" /> Loading your class…</div>;
  if (!classData) return <div className="empty-state"><h2>Class not found</h2><Link to="/classes">Back to classes</Link></div>;
  const todayLog = (studentId) => logs.find((log) => log.student_id === studentId && log.date === todayString());
  return <section className="page-section">
    <Link className="back-link" to="/classes"><ArrowLeft size={16} /> All classes</Link>
    <div className="class-detail-cover" style={{ '--cover': classData.cover_color }}><div className="book-cover-icon"><BookOpen size={32} /></div><div><p>{[classData.subject, classData.grade].filter(Boolean).join(' · ')}</p><h1>{classData.name}</h1><span>Teacher · {classData.teacher_name}</span></div></div>
    {error && <p className="notice error">{error}</p>}
    <div className="section-title-row"><div><p className="eyebrow">THE NEXT CHAPTER</p><h2>Class book</h2></div><button className="text-button" onClick={() => setEditingBook(!editingBook)}>{editingBook ? 'Cancel' : classData.book_title ? 'Edit book' : 'Assign book'}</button></div>
    {editingBook ? <form className="surface book-form" onSubmit={saveBook}><div className="form-row"><label className="form-field"><span>Title</span><input required value={book.book_title} onChange={(e) => setBook({ ...book, book_title: e.target.value })} /></label><label className="form-field"><span>Author</span><input value={book.book_author} onChange={(e) => setBook({ ...book, book_author: e.target.value })} /></label></div><div className="form-row"><label className="form-field"><span>Total pages</span><input type="number" min="0" value={book.book_total_pages} onChange={(e) => setBook({ ...book, book_total_pages: e.target.value })} /></label><label className="form-field"><span>Total chapters</span><input type="number" min="0" value={book.book_total_chapters} onChange={(e) => setBook({ ...book, book_total_chapters: e.target.value })} /></label></div><button className="button primary">Save book</button></form> :
      <div className="surface book-summary"><span className="book-summary-icon">📖</span><div><b>{classData.book_title || 'No book assigned yet'}</b><p>{[classData.book_author, classData.book_total_pages ? `${classData.book_total_pages} pages` : ''].filter(Boolean).join(' · ') || 'Choose a book to get started.'}</p></div></div>}
    <div className="section-title-row students-heading"><div><p className="eyebrow">EVERY PAGE COUNTS</p><h2>Readers <span className="count-pill">{students.length}</span></h2></div></div>
    <form className="add-student-form" onSubmit={addStudent}><input required value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="Student name" aria-label="Student name" /><button className="button secondary"><Plus size={16} /> Add student</button></form>
    {students.length ? <div className="student-grid">{students.map((student) => {
      const studentLogs = logs.filter((log) => log.student_id === student.id);
      const pages = studentLogs.reduce((total, log) => total + log.pages_read, 0);
      const today = todayLog(student.id);
      const pct = classData.book_total_pages ? Math.min(100, Math.round((pages / classData.book_total_pages) * 100)) : 0;
      return <article className="student-card" key={student.id} onClick={() => setActiveStudent(student)}>
        <div className="student-card-top"><ProgressRing pct={pct} /><div className="student-info"><h3>{student.name}</h3><p>{classData.book_total_pages ? `${pages} / ${classData.book_total_pages} pages` : `${pages} pages logged`}</p><small>{today ? `${today.pages_read} pages today` : 'No reading logged today'}</small></div><button className="danger-icon student-remove" onClick={(e) => { e.stopPropagation(); removeStudent(student); }} aria-label={`Remove ${student.name}`}><Trash2 size={16} /></button></div>
        <div className="student-card-footer"><StreakBadge streak={readingStreak(studentLogs, student.id)} /><span>{studentLogs.length ? `Last read ${new Date(`${studentLogs.at(-1).date}T12:00:00`).toLocaleDateString()}` : 'Ready to begin'}</span><button className="button small primary" onClick={(e) => { e.stopPropagation(); setActiveStudent(student); }}><Check size={14} /> Log</button></div>
      </article>;
    })}</div> : <div className="compact-empty">Add your first reader to start tracking progress.</div>}
    {activeStudent && <ReadingLogDialog student={activeStudent} current={todayLog(activeStudent.id)} onClose={() => setActiveStudent(null)} onSaved={() => load().catch((err) => setError(err.message))} />}
  </section>;
}
