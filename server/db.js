import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databaseFile = process.env.EMBERLY_DATABASE_PATH || resolve(projectRoot, 'data', 'emberly.sqlite');
mkdirSync(dirname(databaseFile), { recursive: true });

export const db = new Database(databaseFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  create table if not exists profiles (
    id text primary key, email text not null unique collate nocase, password_hash text not null,
    display_name text not null default '', role text not null default 'user' check(role in ('admin','user')),
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  create table if not exists groups (
    id text primary key, name text not null, description text not null default '',
    visibility text not null default 'public' check(visibility in ('public','private')),
    invite_code text not null unique, cover_color text not null default '#6366f1',
    created_by text not null references profiles(id) on delete cascade,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  create table if not exists memberships (
    id text primary key, group_id text not null references groups(id) on delete cascade,
    user_id text not null references profiles(id) on delete cascade, user_name text not null default '',
    role text not null default 'member' check(role in ('admin','member')),
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')), unique(group_id,user_id)
  );
  create table if not exists habits (
    id text primary key, group_id text not null references groups(id) on delete cascade,
    name text not null, description text not null default '',
    type text not null default 'boolean' check(type in ('boolean','numeric','duration')),
    target_value real not null default 1 check(target_value > 0), unit text not null default '',
    color text not null default '#22c55e', deleted_at text,
    created_by text not null references profiles(id),
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  create table if not exists progress_logs (
    id text primary key, group_id text not null references groups(id) on delete cascade,
    habit_id text not null references habits(id) on delete cascade,
    user_id text not null references profiles(id) on delete cascade, user_name text not null default '',
    date text not null, value real not null default 0 check(value >= 0),
    completed integer not null default 0 check(completed in (0,1)), note text not null default '',
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    unique(user_id,habit_id,date)
  );
  create table if not exists classes (
    id text primary key, name text not null, subject text not null default '', grade text not null default '',
    teacher_id text not null references profiles(id) on delete cascade, teacher_name text not null default '',
    cover_color text not null default '#6366f1', book_title text not null default '', book_author text not null default '',
    book_total_pages integer not null default 0 check(book_total_pages >= 0),
    book_total_chapters integer not null default 0 check(book_total_chapters >= 0),
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  create table if not exists students (
    id text primary key, name text not null, class_id text not null references classes(id) on delete cascade,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')), unique(id,class_id)
  );
  create table if not exists reading_logs (
    id text primary key, class_id text not null, student_id text not null, student_name text not null default '',
    date text not null, pages_read integer not null default 0 check(pages_read >= 0),
    chapters_read integer not null default 0 check(chapters_read >= 0),
    completed integer not null default 0 check(completed in (0,1)), note text not null default '',
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    unique(student_id,date),
    foreign key(student_id,class_id) references students(id,class_id) on delete cascade
  );
  create index if not exists memberships_user_idx on memberships(user_id);
  create index if not exists habits_group_idx on habits(group_id);
  create index if not exists progress_group_date_idx on progress_logs(group_id,date);
  create index if not exists classes_teacher_idx on classes(teacher_id);
  create index if not exists students_class_idx on students(class_id);
  create index if not exists reading_class_date_idx on reading_logs(class_id,date);
`);

export const columns = {
  profiles: ['id', 'email', 'display_name', 'role', 'created_at', 'updated_at'],
  groups: ['id', 'name', 'description', 'visibility', 'invite_code', 'cover_color', 'created_by', 'created_at', 'updated_at'],
  memberships: ['id', 'group_id', 'user_id', 'user_name', 'role', 'created_at'],
  habits: ['id', 'group_id', 'name', 'description', 'type', 'target_value', 'unit', 'color', 'deleted_at', 'created_by', 'created_at', 'updated_at'],
  progress_logs: ['id', 'group_id', 'habit_id', 'user_id', 'user_name', 'date', 'value', 'completed', 'note', 'created_at', 'updated_at'],
  classes: ['id', 'name', 'subject', 'grade', 'teacher_id', 'teacher_name', 'cover_color', 'book_title', 'book_author', 'book_total_pages', 'book_total_chapters', 'created_at', 'updated_at'],
  students: ['id', 'name', 'class_id', 'created_at'],
  reading_logs: ['id', 'class_id', 'student_id', 'student_name', 'date', 'pages_read', 'chapters_read', 'completed', 'note', 'created_at', 'updated_at'],
};
export const conflictKeys = {
  memberships: ['group_id', 'user_id'],
  progress_logs: ['user_id', 'habit_id', 'date'],
  reading_logs: ['student_id', 'date'],
};
