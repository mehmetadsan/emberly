import express from 'express';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, columns as tableColumns, conflictKeys as uniqueKeys } from './db.js';

const app = express();
const port = Number(process.env.PORT || 3001);
const root = join(fileURLToPath(new URL('..', import.meta.url)));
if (process.env.NODE_ENV === 'production' && !process.env.EMBERLY_SESSION_SECRET) {
  throw new Error('EMBERLY_SESSION_SECRET must be set in production.');
}
const secret = process.env.EMBERLY_SESSION_SECRET || 'local-development-secret-change-before-deployment';
if (!process.env.EMBERLY_SESSION_SECRET) console.warn('Using the development session key. Set EMBERLY_SESSION_SECRET before deployment.');

app.use(express.json({ limit: '64kb' }));

function apiError(res, status, message) {
  return res.status(status).json({ error: message });
}

function publicUser(row) {
  return row && {
    id: row.id,
    email: row.email,
    role: row.role,
    created_at: row.created_at,
    user_metadata: { display_name: row.display_name },
  };
}

function makeToken(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14 })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function authenticate(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return apiError(res, 401, 'Sign in to continue.');
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return apiError(res, 401, 'Your session is invalid. Please sign in again.');
  const expected = createHmac('sha256', secret).update(payload).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); }
  catch { return apiError(res, 401, 'Your session is invalid. Please sign in again.'); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return apiError(res, 401, 'Your session is invalid. Please sign in again.');
  let claims;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
  catch { return apiError(res, 401, 'Your session is invalid. Please sign in again.'); }
  if (!claims.sub || claims.exp < Date.now() / 1000) return apiError(res, 401, 'Your session has expired. Please sign in again.');
  const row = db.prepare('select * from profiles where id = ?').get(claims.sub);
  if (!row) return apiError(res, 401, 'Account not found.');
  req.user = publicUser(row);
  next();
}

function issueSession(row) {
  const token = makeToken(row.id);
  return { access_token: token, refresh_token: token, token_type: 'bearer', user: publicUser(row) };
}

function isAdmin(user) { return user.role === 'admin'; }
function groupRole(groupId, userId) {
  return db.prepare('select role from memberships where group_id = ? and user_id = ?').get(groupId, userId)?.role;
}
function canOwnClass(classId, user) {
  const row = db.prepare('select teacher_id from classes where id = ?').get(classId);
  return row && (row.teacher_id === user.id || isAdmin(user));
}
function asSqlValue(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}
function visible(table, row, user, action) {
  if (action === 'select') {
    if (table === 'profiles') return isAdmin(user) || row.id === user.id;
    if (table === 'groups') return isAdmin(user) || row.visibility === 'public' || row.created_by === user.id ||
      Boolean(db.prepare('select 1 from memberships where group_id = ? and user_id = ?').get(row.id, user.id));
    if (table === 'memberships') return isAdmin(user) || row.user_id === user.id ||
      Boolean(groupRole(row.group_id, user.id));
    if (table === 'habits' || table === 'progress_logs') return isAdmin(user) ||
      Boolean(db.prepare('select 1 from memberships where group_id = ? and user_id = ?').get(row.group_id, user.id));
    if (table === 'classes') return isAdmin(user) || row.teacher_id === user.id;
    if (table === 'students' || table === 'reading_logs') return canOwnClass(row.class_id, user);
    return false;
  }
  if (table === 'profiles') return isAdmin(user) || (row.id === user.id && action === 'update');
  if (table === 'groups') return isAdmin(user) || row.created_by === user.id;
  if (table === 'memberships') return isAdmin(user) || groupRole(row.group_id, user.id) === 'admin' ||
    (action === 'delete' && row.user_id === user.id);
  if (table === 'habits') return isAdmin(user) || groupRole(row.group_id, user.id) === 'admin';
  if (table === 'progress_logs') return isAdmin(user) || row.user_id === user.id;
  if (table === 'classes') return isAdmin(user) || row.teacher_id === user.id;
  if (table === 'students' || table === 'reading_logs') return canOwnClass(row.class_id, user);
  return false;
}
function validatePayload(table, action, payload, user) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Expected a record.');
  const allowed = tableColumns[table];
  const values = { ...payload };
  delete values.password_hash;
  delete values.created_at;
  delete values.updated_at;
  if (action === 'insert' || action === 'upsert') {
    values.id ||= randomUUID();
    if (table === 'groups' && values.created_by !== user.id) throw new Error('Groups can only be created by their owner.');
    if (table === 'memberships') {
      const role = groupRole(values.group_id, user.id);
      const group = db.prepare('select created_by, visibility from groups where id = ?').get(values.group_id);
      const creatingOwner = values.user_id === user.id && values.role === 'admin' && group?.created_by === user.id;
      const joiningPublic = values.user_id === user.id && values.role === 'member' && group?.visibility === 'public';
      if (!creatingOwner && !joiningPublic && !isAdmin(user) && role !== 'admin') throw new Error('You cannot add this group member.');
    }
    if (table === 'habits' && (values.created_by !== user.id || (!isAdmin(user) && groupRole(values.group_id, user.id) !== 'admin'))) throw new Error('Only group admins may manage habits.');
    if (table === 'progress_logs') {
      if (values.user_id !== user.id && !isAdmin(user)) throw new Error('You can only log your own progress.');
      const habit = db.prepare('select group_id,deleted_at from habits where id = ?').get(values.habit_id);
      if (!habit || habit.group_id !== values.group_id || habit.deleted_at || !db.prepare('select 1 from memberships where group_id = ? and user_id = ?').get(values.group_id, user.id)) {
        throw new Error('Join the group and choose an active habit before checking in.');
      }
      values.completed = Boolean(values.completed);
    }
    if (action === 'update' && table === 'progress_logs' &&
        ['group_id', 'habit_id', 'user_id', 'date'].some((key) => key in values)) {
      throw new Error('Check-in ownership and date cannot be changed.');
    }
    if (table === 'classes' && values.teacher_id !== user.id && !isAdmin(user)) throw new Error('Classes belong to their creating teacher.');
    if (table === 'reading_logs') {
      if (!canOwnClass(values.class_id, user)) throw new Error('You do not own this class.');
      const student = db.prepare('select name,class_id from students where id = ?').get(values.student_id);
      if (!student || student.class_id !== values.class_id) throw new Error('Student does not belong to this class.');
      values.student_name = student.name;
      values.completed = Boolean(values.completed);
    }
    if (action === 'update' && table === 'reading_logs' &&
        ['class_id', 'student_id', 'date'].some((key) => key in values)) {
      throw new Error('Reading log ownership and date cannot be changed.');
    }
  }
  for (const key of Object.keys(values)) if (!allowed.includes(key)) throw new Error(`Field "${key}" is not writable.`);
  if (table === 'profiles' && action === 'update') {
    if (Object.keys(values).some((key) => !['id', 'display_name', 'role'].includes(key))) throw new Error('Profile field is not editable.');
    if (values.role !== undefined && !isAdmin(user)) throw new Error('Only platform admins can change account roles.');
  }
  if (table === 'groups' && action !== 'insert' && action !== 'upsert' && ('created_by' in values && values.created_by !== user.id && !isAdmin(user))) throw new Error('Group owner cannot be changed.');
  if (table === 'memberships' && action !== 'insert' && action !== 'upsert' && !isAdmin(user) && Object.keys(values).some((key) => !['user_name'].includes(key))) throw new Error('Membership role and owner cannot be changed.');
  if (table === 'classes' && action !== 'insert' && action !== 'upsert' && ('teacher_id' in values && values.teacher_id !== user.id && !isAdmin(user))) throw new Error('Class owner cannot be changed.');
  if (table === 'habits' && action === 'update' && 'group_id' in values) throw new Error('Habit group cannot be changed.');
  if (table === 'students' && action === 'update' && 'class_id' in values) throw new Error('Student class cannot be changed.');
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, asSqlValue(value)]));
}

function whereClause(filters, allowed, params) {
  const parts = [];
  for (const filter of filters) {
    if (!allowed.includes(filter.column)) throw new Error(`Unknown field "${filter.column}".`);
    if (filter.operator === 'eq') {
      if (filter.value === null) parts.push(`"${filter.column}" is null`);
      else { parts.push(`"${filter.column}" = ?`); params.push(asSqlValue(filter.value)); }
    } else if (filter.operator === 'is') {
      parts.push(filter.value === null ? `"${filter.column}" is null` : `"${filter.column}" is ?`);
      if (filter.value !== null) params.push(asSqlValue(filter.value));
    } else if (filter.operator === 'in') {
      if (!Array.isArray(filter.value)) throw new Error('Invalid filter.');
      if (!filter.value.length) parts.push('0');
      else {
        parts.push(`"${filter.column}" in (${filter.value.map(() => '?').join(',')})`);
        params.push(...filter.value.map(asSqlValue));
      }
    } else throw new Error('Unsupported filter.');
  }
  return parts.length ? `where ${parts.join(' and ')}` : '';
}

function parseRequest(req, table) {
  const { action = 'select', payload, filters = [], order = [], columns = '*', onConflict = '' } = req.body;
  if (!['select', 'insert', 'update', 'delete', 'upsert'].includes(action)) throw new Error('Unsupported database action.');
  if (!Array.isArray(filters) || !Array.isArray(order)) throw new Error('Invalid query.');
  const available = tableColumns[table];
  const params = [];
  const where = whereClause(filters, available, params);
  if (action === 'select') {
    const selected = columns === '*' ? available : columns.split(',').map((column) => column.trim());
    if (!selected.length || selected.some((column) => !available.includes(column))) throw new Error('Unknown selected field.');
    const sort = order.map((item) => {
      if (!available.includes(item.column)) throw new Error('Unknown sort field.');
      return `"${item.column}" ${item.ascending ? 'asc' : 'desc'}`;
    });
    return { action, sql: `select ${selected.map((column) => `"${column}"`).join(',')} from "${table}" ${where} ${sort.length ? `order by ${sort.join(',')}` : ''}`, params };
  }
  return { action, payload, filters, where, params, onConflict };
}

function selectRows(query) {
  const statement = db.prepare(query.sql);
  return statement.all(...query.params);
}

function executeMutation(table, query, user) {
  if (query.action === 'insert' || query.action === 'upsert') {
    const inputs = Array.isArray(query.payload) ? query.payload : [query.payload];
    if (!inputs.length) return [];
    const rows = inputs.map((input) => {
      const values = validatePayload(table, query.action, input, user);
      const keys = Object.keys(values);
      const params = keys.map((key) => values[key]);
      let conflict = '';
      if (query.action === 'upsert') {
        const columns = query.onConflict.split(',').map((column) => column.trim()).filter(Boolean);
        const expected = uniqueKeys[table];
        if (!expected || columns.length !== expected.length || !columns.every((column) => expected.includes(column))) throw new Error('Unsupported upsert key.');
        conflict = `on conflict(${columns.map((column) => `"${column}"`).join(',')}) do update set ${
          keys.filter((key) => !columns.includes(key) && key !== 'id').map((key) => `"${key}" = excluded."${key}"`).concat('"updated_at" = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')').join(',')
        }`;
      }
      const sql = `insert into "${table}" (${keys.map((key) => `"${key}"`).join(',')}) values (${keys.map(() => '?').join(',')}) ${conflict}`;
      db.prepare(sql).run(...params);
      const identity = table === 'memberships' ? { group_id: values.group_id, user_id: values.user_id } :
        table === 'progress_logs' ? { user_id: values.user_id, habit_id: values.habit_id, date: values.date } :
          table === 'reading_logs' ? { student_id: values.student_id, date: values.date } : { id: values.id };
      const where = Object.keys(identity).map((key) => `"${key}" = ?`).join(' and ');
      return db.prepare(`select * from "${table}" where ${where}`).get(...Object.values(identity));
    });
    return rows;
  }

  if (query.action === 'select') return selectRows(query);
  const matches = db.prepare(`select * from "${table}" ${query.where}`).all(...query.params);
  if (matches.some((row) => !visible(table, row, user, query.action))) throw new Error('You are not allowed to change this record.');
  if (query.action === 'delete') {
    db.prepare(`delete from "${table}" ${query.where}`).run(...query.params);
    return [];
  }
  const values = validatePayload(table, 'update', query.payload, user);
  if (!Object.keys(values).length) return matches;
  const set = Object.keys(values).map((key) => `"${key}" = ?`);
  if (tableColumns[table].includes('updated_at')) set.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  db.prepare(`update "${table}" set ${set.join(',')} ${query.where}`).run(...Object.values(values), ...query.params);
  return db.prepare(`select * from "${table}" ${query.where}`).all(...query.params);
}

function serialize(table, rows) {
  return rows.map((row) => {
    const result = { ...row };
    delete result.password_hash;
    if (table === 'progress_logs' || table === 'reading_logs') result.completed = Boolean(result.completed);
    return result;
  });
}

app.post('/api/auth/register', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const displayName = String(req.body.display_name || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return apiError(res, 400, 'Enter a valid email address.');
  if (password.length < 8 || password.length > 200) return apiError(res, 400, 'Password must contain at least 8 characters.');
  if (displayName.length > 80) return apiError(res, 400, 'Name is too long.');
  if (db.prepare('select 1 from profiles where email = ?').get(email)) return apiError(res, 409, 'An account with this email already exists.');
  const id = randomUUID();
  const salt = randomBytes(16).toString('hex');
  const hash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  const isFirst = db.prepare('select count(*) as count from profiles').get().count === 0;
  const role = isFirst || (process.env.EMBERLY_ADMIN_EMAIL || '').toLowerCase() === email ? 'admin' : 'user';
  db.prepare('insert into profiles(id,email,password_hash,display_name,role) values(?,?,?,?,?)').run(id, email, hash, displayName, role);
  const profile = db.prepare('select * from profiles where id = ?').get(id);
  res.status(201).json({ data: { session: issueSession(profile) } });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const row = db.prepare('select * from profiles where email = ?').get(email);
  if (!row || !passwordValid(password, row.password_hash)) return apiError(res, 401, 'Email or password is incorrect.');
  res.json({ data: { session: issueSession(row) } });
});

function passwordValid(password, stored) {
  if (!stored || !password) return false;
  const [salt, digest] = stored.split(':');
  if (!salt || !digest) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

app.post('/api/auth/password-reset', (_req, res) => {
  res.json({ data: { message: 'If an account matches this address, reset instructions will be sent when local email delivery is configured.' } });
});

app.get('/api/auth/me', authenticate, (req, res) => res.json({ data: req.user }));
app.patch('/api/auth/password', authenticate, (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 8 || password.length > 200) return apiError(res, 400, 'Password must contain at least 8 characters.');
  const salt = randomBytes(16).toString('hex');
  const hash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  db.prepare('update profiles set password_hash = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') where id = ?').run(hash, req.user.id);
  res.json({ data: { updated: true } });
});

app.patch('/api/admin/profiles/:id/password', authenticate, (req, res) => {
  if (!isAdmin(req.user)) return apiError(res, 403, 'Only platform admins can reset account passwords.');
  const password = String(req.body.password || '');
  if (password.length < 8 || password.length > 200) return apiError(res, 400, 'Password must contain at least 8 characters.');
  const profile = db.prepare('select id from profiles where id = ?').get(req.params.id);
  if (!profile) return apiError(res, 404, 'Account not found.');
  const salt = randomBytes(16).toString('hex');
  const hash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  db.prepare('update profiles set password_hash = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') where id = ?').run(hash, profile.id);
  res.json({ data: { updated: true } });
});

app.post('/api/rpc/:name', authenticate, (req, res) => {
  try {
    if (req.params.name === 'join_group_by_code') {
      const code = String(req.body.code || '').trim().toUpperCase().replace(/\s/g, '');
      const group = db.prepare('select * from groups where invite_code = ?').get(code);
      if (!group) return apiError(res, 404, 'Group not found.');
      db.prepare('insert or ignore into memberships(id,group_id,user_id,user_name,role) values(?,?,?,?,?)').run(
        randomUUID(), group.id, req.user.id, req.user.user_metadata.display_name || req.user.email.split('@')[0], 'member',
      );
      return res.json({ data: group.id });
    }
    if (req.params.name === 'update_my_display_name') {
      const name = String(req.body.new_name || '').trim();
      if (!name || name.length > 80) return apiError(res, 400, 'Name must be between 1 and 80 characters.');
      const update = db.transaction(() => {
        db.prepare('update profiles set display_name = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') where id = ?').run(name, req.user.id);
        db.prepare('update memberships set user_name = ? where user_id = ?').run(name, req.user.id);
        db.prepare('update progress_logs set user_name = ? where user_id = ?').run(name, req.user.id);
        db.prepare('update classes set teacher_name = ? where teacher_id = ?').run(name, req.user.id);
      });
      update();
      return res.json({ data: null });
    }
    return apiError(res, 404, 'Unknown database operation.');
  } catch (error) {
    return apiError(res, 400, error.message);
  }
});

app.post('/api/data/:table', authenticate, (req, res) => {
  const table = req.params.table;
  if (!Object.hasOwn(tableColumns, table)) return apiError(res, 404, 'Unknown database table.');
  try {
    const query = parseRequest(req, table);
    const run = db.transaction(() => executeMutation(table, query, req.user));
    let rows = serialize(table, run());
    if (req.body.action === 'select' && table === 'groups') rows = rows.filter((row) => visible(table, row, req.user, 'select'));
    else if (req.body.action === 'select' && rows.some((row) => !visible(table, row, req.user, 'select'))) {
      return apiError(res, 403, 'You are not allowed to read this record.');
    }
    res.json({ data: rows });
  } catch (error) {
    const duplicate = /unique constraint failed/i.test(error.message);
    console.error(`Database request failed (${table}):`, error.message);
    apiError(res, duplicate ? 409 : 400, duplicate ? 'That record already exists.' : error.message);
  }
});

if (existsSync(join(root, 'dist'))) {
  app.use(express.static(join(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(join(root, 'dist', 'index.html')));
}

app.listen(port, () => console.log(`Emberly API listening on http://localhost:${port}`));
