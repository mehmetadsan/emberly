create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  invite_code text not null unique,
  cover_color text not null default '#6366f1',
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text not null default '',
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  type text not null default 'boolean' check (type in ('boolean', 'numeric', 'duration')),
  target_value numeric not null default 1 check (target_value > 0),
  unit text not null default '',
  color text not null default '#22c55e',
  deleted_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.progress_logs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  user_name text not null default '',
  date date not null,
  value numeric not null default 0 check (value >= 0),
  completed boolean not null default false,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, habit_id, date)
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  subject text not null default '',
  grade text not null default '',
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  teacher_name text not null default '',
  cover_color text not null default '#6366f1',
  book_title text not null default '',
  book_author text not null default '',
  book_total_pages integer not null default 0 check (book_total_pages >= 0),
  book_total_chapters integer not null default 0 check (book_total_chapters >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  class_id uuid not null references public.classes(id) on delete cascade,
  unique (id, class_id),
  created_at timestamptz not null default now()
);

create table if not exists public.reading_logs (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null,
  student_name text not null default '',
  date date not null,
  pages_read integer not null default 0 check (pages_read >= 0),
  chapters_read integer not null default 0 check (chapters_read >= 0),
  completed boolean not null default false,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, date),
  foreign key (student_id, class_id) references public.students(id, class_id) on delete cascade
);

create index if not exists memberships_user_id_idx on public.memberships(user_id);
create index if not exists habits_group_id_idx on public.habits(group_id);
create index if not exists progress_logs_group_date_idx on public.progress_logs(group_id, date);
create index if not exists progress_logs_user_date_idx on public.progress_logs(user_id, date);
create index if not exists students_class_id_idx on public.students(class_id);
create index if not exists reading_logs_class_date_idx on public.reading_logs(class_id, date);

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

create or replace function public.is_group_admin(target_group uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.memberships where group_id = target_group and user_id = auth.uid() and role = 'admin') $$;

create or replace function public.owns_class(target_class uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.classes where id = target_class and (teacher_id = auth.uid() or public.is_platform_admin())) $$;

create or replace function public.sync_profile_from_auth()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists emberly_auth_user_created on auth.users;
create trigger emberly_auth_user_created after insert on auth.users
for each row execute function public.sync_profile_from_auth();

create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_platform_admin() then
    raise exception 'Only platform admins may change roles';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists emberly_profile_role_guard on public.profiles;
create trigger emberly_profile_role_guard before update on public.profiles
for each row execute function public.protect_profile_role();

create or replace function public.sync_denormalized_names()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.display_name is distinct from old.display_name then
    update public.memberships set user_name = new.display_name where user_id = new.id;
    update public.progress_logs set user_name = new.display_name where user_id = new.id;
    update public.classes set teacher_name = new.display_name where teacher_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists emberly_sync_profile_names on public.profiles;
create trigger emberly_sync_profile_names after update on public.profiles
for each row execute function public.sync_denormalized_names();

create or replace function public.join_group_by_code(code text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare target public.groups;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into target from public.groups where invite_code = upper(regexp_replace(trim(code), '\s+', '', 'g'));
  if not found then raise exception 'Group not found'; end if;
  insert into public.memberships (group_id, user_id, user_name, role)
  select target.id, auth.uid(), coalesce(p.display_name, ''), 'member'
  from public.profiles p where p.id = auth.uid()
  on conflict (group_id, user_id) do nothing;
  return target.id;
end;
$$;

create or replace function public.update_my_display_name(new_name text)
returns void language plpgsql security definer set search_path = public
as $$
declare clean_name text := trim(coalesce(new_name, ''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(clean_name) = 0 or length(clean_name) > 80 then raise exception 'Name must be between 1 and 80 characters'; end if;
  update public.profiles set display_name = clean_name where id = auth.uid();
end;
$$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.memberships enable row level security;
alter table public.habits enable row level security;
alter table public.progress_logs enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.reading_logs enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.groups, public.memberships,
  public.habits, public.progress_logs, public.classes, public.students, public.reading_logs to authenticated;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid() or public.is_platform_admin()) with check (id = auth.uid() or public.is_platform_admin());
drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles for delete to authenticated using (public.is_platform_admin());

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups for select to authenticated using (true);
drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups for insert to authenticated with check (created_by = auth.uid());
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update to authenticated using (created_by = auth.uid() or public.is_platform_admin()) with check (created_by = auth.uid() or public.is_platform_admin());
drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups for delete to authenticated using (created_by = auth.uid() or public.is_platform_admin());

drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships for select to authenticated using (true);
drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships for insert to authenticated with check (
  (user_id = auth.uid() and role = 'member' and exists (select 1 from public.groups g where g.id = group_id and g.visibility = 'public'))
  or (user_id = auth.uid() and role = 'admin' and exists (select 1 from public.groups g where g.id = group_id and g.created_by = auth.uid()))
  or public.is_platform_admin()
);
drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships for update to authenticated using (public.is_group_admin(group_id) or public.is_platform_admin()) with check (public.is_group_admin(group_id) or public.is_platform_admin());
drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships for delete to authenticated using (user_id = auth.uid() or public.is_group_admin(group_id) or public.is_platform_admin());

drop policy if exists habits_read on public.habits;
create policy habits_read on public.habits for select to authenticated using (true);
drop policy if exists habits_insert on public.habits;
create policy habits_insert on public.habits for insert to authenticated with check (created_by = auth.uid() and (public.is_group_admin(group_id) or public.is_platform_admin()));
drop policy if exists habits_update on public.habits;
create policy habits_update on public.habits for update to authenticated using (public.is_group_admin(group_id) or public.is_platform_admin()) with check (public.is_group_admin(group_id) or public.is_platform_admin());
drop policy if exists habits_delete on public.habits;
create policy habits_delete on public.habits for delete to authenticated using (public.is_group_admin(group_id) or public.is_platform_admin());

drop policy if exists progress_read on public.progress_logs;
create policy progress_read on public.progress_logs for select to authenticated using (true);
drop policy if exists progress_insert on public.progress_logs;
create policy progress_insert on public.progress_logs for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.memberships m where m.group_id = progress_logs.group_id and m.user_id = auth.uid())
  and exists (select 1 from public.habits h where h.id = progress_logs.habit_id and h.group_id = progress_logs.group_id)
);
drop policy if exists progress_update on public.progress_logs;
create policy progress_update on public.progress_logs for update to authenticated using (user_id = auth.uid() or public.is_platform_admin()) with check (
  (user_id = auth.uid() and exists (select 1 from public.memberships m where m.group_id = progress_logs.group_id and m.user_id = auth.uid())
   and exists (select 1 from public.habits h where h.id = progress_logs.habit_id and h.group_id = progress_logs.group_id))
  or public.is_platform_admin()
);
drop policy if exists progress_delete on public.progress_logs;
create policy progress_delete on public.progress_logs for delete to authenticated using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists classes_owner_all on public.classes;
create policy classes_owner_all on public.classes for all to authenticated using (teacher_id = auth.uid() or public.is_platform_admin()) with check (teacher_id = auth.uid() or public.is_platform_admin());
drop policy if exists students_owner_all on public.students;
create policy students_owner_all on public.students for all to authenticated using (public.owns_class(class_id)) with check (public.owns_class(class_id));
drop policy if exists reading_owner_all on public.reading_logs;
create policy reading_owner_all on public.reading_logs for all to authenticated using (public.owns_class(class_id)) with check (public.owns_class(class_id));

grant execute on function public.join_group_by_code(text) to authenticated;
grant execute on function public.update_my_display_name(text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.progress_logs;
  end if;
exception when duplicate_object then null;
end;
$$;
