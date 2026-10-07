-- UEE 9th Fleet: core schema.
--
-- Members, the order of battle, qualifications, recruiting and the audit log,
-- with the access rules that the build spec sets out. The rules live here, in
-- the database, so neither the website nor the voice app can get round them.
--
-- Words: a "position" is a member's standing place in a unit. Doctrine calls it
-- a post and members call it a slot. Nobody picks one per event.
--
-- Who does what:
--   staff look after people: applications, statuses and services;
--   command makes appointments and promotions, and discharges;
--   the admin owns the structure: units, positions, stages, services and roles.
-- Nobody below admin decides anything about themselves.

create schema if not exists app;
comment on schema app is 'Internal helpers. Not exposed through the API.';

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.service as enum ('navy', 'army', 'marines');
create type public.member_status as enum ('applicant', 'recruit', 'auxiliary', 'member', 'reserve', 'discharged');
create type public.app_role as enum ('instructor', 'staff', 'command', 'admin');
create type public.grade_band as enum ('enlisted', 'nco', 'cadet', 'officer');
create type public.post_kind as enum ('primary', 'duty');
create type public.application_route as enum ('recruit', 'cadet');
create type public.application_stage as enum ('submitted', 'interview', 'accepted', 'declined', 'withdrawn');

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

-- One row. The public site reads it to know whether recruitment is open and
-- which services are taking people. A service opens only when its stage is
-- confirmed, so the fleet is not split too early.
create table public.fleet_settings (
  id boolean primary key default true check (id),
  recruitment_open boolean not null default false,
  open_services public.service[] not null default '{navy}' check (cardinality(open_services) >= 1),
  current_stage smallint not null default 1 check (current_stage between 1 and 9),
  updated_at timestamptz not null default now()
);
insert into public.fleet_settings default values;

-- One row, never exposed. Names the Discord account that becomes the first
-- admin. Set it by hand in the SQL editor, before or after that first sign-in.
create table app.bootstrap (
  id boolean primary key default true check (id),
  founder_discord_id text
);
insert into app.bootstrap default values;

-- ---------------------------------------------------------------------------
-- Grades and ranks
-- ---------------------------------------------------------------------------

create table public.grades (
  code text primary key,
  sort_order smallint not null unique,
  band public.grade_band not null,
  typical_position text not null
);

-- The rank name for a grade depends on the service.
create table public.ranks (
  service public.service not null,
  grade_code text not null references public.grades (code),
  name text not null,
  primary key (service, grade_code)
);

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

-- Rank is deliberately not stored here. It is read from the member's current
-- position and service, which is how "rank belongs to the position" is kept true.
create table public.members (
  id uuid primary key references auth.users (id) on delete cascade,
  character_name text check (char_length(character_name) between 2 and 40),
  rsi_handle text check (char_length(rsi_handle) between 2 and 60),
  service public.service,
  status public.member_status not null default 'applicant',
  joined_on date not null default current_date,
  updated_at timestamptz not null default now(),
  -- No leading, trailing or doubled spaces, so two names cannot differ only by those.
  constraint members_character_name_tidy check (character_name !~ '(^\s|\s$|\s\s)'),
  constraint members_rsi_handle_tidy check (rsi_handle !~ '\s')
);
-- Names are unique inside the fleet. Applicants are left out, so someone from
-- outside can neither find out which names are in use nor sit on one. A clash
-- is caught when their application is accepted.
create unique index members_character_name_key on public.members (lower(character_name))
  where status in ('recruit', 'auxiliary', 'member', 'reserve');
create unique index members_rsi_handle_key on public.members (lower(rsi_handle))
  where status in ('recruit', 'auxiliary', 'member', 'reserve');

-- Personal details that other members do not need to see.
create table public.member_accounts (
  member_id uuid primary key references public.members (id) on delete cascade,
  discord_id text unique,
  discord_name text
);

create table public.member_roles (
  member_id uuid not null references public.members (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.members (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (member_id, role)
);

-- ---------------------------------------------------------------------------
-- Order of battle
-- ---------------------------------------------------------------------------

create table public.units (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.units (id) on delete restrict,
  name text not null,
  kind text not null,
  service public.service,
  opens_at_stage smallint not null default 1 check (opens_at_stage between 1 and 9),
  sort_order integer not null default 0,
  unique nulls not distinct (parent_id, name),
  constraint units_not_own_parent check (parent_id <> id)
);

-- A primary position sets grade and rank and has one holder.
-- A duty is a part-time staff job held as well, by a pool of people, with no rank.
-- On a duty, min_grade is the lowest grade a member needs to take it on.
create table public.positions (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units (id) on delete restrict,
  title text not null,
  kind public.post_kind not null default 'primary',
  nominal_grade text references public.grades (code),
  min_grade text references public.grades (code),
  max_grade text references public.grades (code),
  is_entry boolean not null default false,
  opens_at_stage smallint not null default 1 check (opens_at_stage between 1 and 9),
  sort_order integer not null default 0,
  unique (unit_id, title),
  constraint positions_primary_has_grades check (
    kind = 'duty' or (nominal_grade is not null and min_grade is not null and max_grade is not null)
  )
);
create index positions_unit_idx on public.positions (unit_id);

create table public.qualifications (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default ''
);

-- An acting appointment lets someone prove themselves before they hold the
-- qualification, where the position allows it. That is how officer positions
-- are filled until the first cadet course graduates.
create table public.position_qualifications (
  position_id uuid not null references public.positions (id) on delete cascade,
  qualification_id uuid not null references public.qualifications (id) on delete restrict,
  waived_when_acting boolean not null default false,
  primary key (position_id, qualification_id)
);

create table public.qualification_awards (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  qualification_id uuid not null references public.qualifications (id) on delete restrict,
  awarded_by uuid references public.members (id) on delete set null,
  awarded_on date not null default current_date,
  note text not null default '' check (char_length(note) <= 1000),
  unique (member_id, qualification_id)
);

-- The list of a member's assignments over time is their service record.
-- The dates are set by the database: an assignment starts the day it is made
-- and ends the day it is ended.
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  position_id uuid not null references public.positions (id) on delete restrict,
  kind public.post_kind not null,
  grade_code text references public.grades (code),
  acting boolean not null default false,
  started_on date not null default current_date,
  ended_on date,
  appointed_by uuid references public.members (id) on delete set null,
  note text not null default '' check (char_length(note) <= 1000),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint assignments_dates check (ended_on is null or ended_on >= started_on),
  constraint assignments_grade_matches_kind check ((kind = 'primary') = (grade_code is not null))
);
-- Everyone has at most one primary position, and each primary position one holder.
create unique index assignments_one_primary_per_member on public.assignments (member_id)
  where kind = 'primary' and ended_on is null;
create unique index assignments_one_holder_per_position on public.assignments (position_id)
  where kind = 'primary' and ended_on is null;
-- One secondary duty at most.
create unique index assignments_one_duty_per_member on public.assignments (member_id)
  where kind = 'duty' and ended_on is null;
create index assignments_member_idx on public.assignments (member_id);
create index assignments_position_idx on public.assignments (position_id);

-- ---------------------------------------------------------------------------
-- Recruiting
-- ---------------------------------------------------------------------------

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  route public.application_route not null default 'recruit',
  stage public.application_stage not null default 'submitted',
  preferred_service public.service not null default 'navy',
  answers jsonb not null default '{}'::jsonb check (pg_column_size(answers) < 8000),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.members (id) on delete set null
);
create unique index applications_one_open_per_member on public.applications (member_id)
  where stage in ('submitted', 'interview');
create index applications_member_idx on public.applications (member_id);

-- Interview notes. Staff only, and never the staff member the notes are about.
create table public.application_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  author_id uuid references public.members (id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index application_notes_application_idx on public.application_notes (application_id);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  subject uuid,
  table_name text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_row jsonb,
  new_row jsonb
);
create index audit_log_subject_idx on public.audit_log (subject);

-- ---------------------------------------------------------------------------
-- Helpers used by the access rules
-- ---------------------------------------------------------------------------

create function app.my_status() returns public.member_status
language sql stable security definer set search_path = ''
as $$
  select status from public.members where id = (select auth.uid());
$$;

-- Serving means inside the fleet: able to see the order of battle.
create function app.is_serving() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(app.my_status() in ('recruit', 'auxiliary', 'member', 'reserve'), false);
$$;

-- An admin holds every role. A role only counts while its holder is serving.
create function app.has_role(wanted public.app_role) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_serving() and exists (
    select 1 from public.member_roles
    where member_id = (select auth.uid()) and role in (wanted, 'admin')
  );
$$;

-- Whether some other member holds a role, exactly.
create function app.holds_role(target uuid, wanted public.app_role) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.member_roles where member_id = target and role = wanted
  );
$$;

create function app.is_staff() returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_serving() and exists (
    select 1 from public.member_roles
    where member_id = (select auth.uid()) and role in ('staff', 'command', 'admin')
  );
$$;

-- True when the change comes from the sign-in service, the server's own key or
-- the SQL editor. Those carry no signed-in user and do not come through the
-- public API roles. They are trusted and already bypass the access rules.
create function app.is_trusted_context() returns boolean
language sql stable set search_path = ''
as $$
  select (select auth.uid()) is null
    and coalesce(current_setting('role', true), '') not in ('anon', 'authenticated');
$$;

-- Someone from outside applies while recruitment is open, for a service that
-- is open, once they have given a character name and an RSI handle. A full
-- member may apply for the cadet course at any time. Three applications in 30
-- days is the most anyone can send.
create function app.may_apply(wanted public.application_route, wanted_service public.service) returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    (
      select count(*) from public.applications a
      where a.member_id = m.id and a.submitted_at > now() - interval '30 days'
    ) < 3
    and case m.status
      when 'applicant' then
        m.character_name is not null
        and m.rsi_handle is not null
        and (select s.recruitment_open and wanted_service = any (s.open_services) from public.fleet_settings s)
      when 'member' then
        wanted = 'cadet'
      else false
    end
  from public.members m
  where m.id = (select auth.uid());
$$;

-- A member's grade, worked out from their assignments. Never stored.
--   In a primary position: the grade of that assignment.
--   Out of a position for under 30 days: the grade they last held in their own
--   right. An acting grade is not kept: it ends with the acting appointment.
--   After 30 days: the lowest grade of their band (E2, E4 or O1).
--   Never held one: E2 for a full member, E1 for a recruit or auxiliary.
--   Applicant, reserve or discharged: none.
create function app.member_grade(target uuid) returns text
language sql stable security definer set search_path = ''
as $$
  with me as (
    select status from public.members where id = target
  ),
  held as (
    select grade_code from public.assignments
    where member_id = target and kind = 'primary' and ended_on is null
  ),
  last_own as (
    select a.grade_code, g.band
    from public.assignments a
    join public.grades g on g.code = a.grade_code
    where a.member_id = target and a.kind = 'primary' and a.ended_on is not null and not a.acting
    order by a.ended_on desc, a.recorded_at desc
    limit 1
  ),
  -- The 30 days run from the day they last left any position, acting or not,
  -- so time spent acting up does not cost them their own grade.
  left_on as (
    select max(ended_on) as day from public.assignments
    where member_id = target and kind = 'primary' and ended_on is not null
  )
  select case
    when (select status from me) is null then null
    when (select status from me) in ('applicant', 'reserve', 'discharged') then null
    when exists (select 1 from held) then (select grade_code from held)
    when exists (select 1 from last_own) then
      case
        when (select day from left_on) > current_date - 30 then (select grade_code from last_own)
        when (select band from last_own) = 'officer' then 'O1'
        when (select band from last_own) = 'nco' then 'E4'
        else 'E2'
      end
    when (select status from me) = 'member' then 'E2'
    else 'E1'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Signing in
-- ---------------------------------------------------------------------------

-- The founder's account is a full member with every role, so there is always
-- a first admin. The launch order of battle adds the Fleet Commander position.
create function app.promote_founder(target uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.members
  set status = 'member', service = coalesce(service, 'navy')
  where id = target;
  insert into public.member_roles (member_id, role)
  select target, r from unnest(enum_range(null::public.app_role)) as r
  on conflict do nothing;
end;
$$;

-- Signing in with Discord creates the member, as an applicant.
--
-- This reads auth.identities, which only the sign-in service writes after
-- Discord has confirmed who the person is. It does not read the user's own
-- metadata, because a user can write anything there. An account made any other
-- way gets no member row and can do nothing.
--
-- If this function raised an error nobody could sign in, so it does as little
-- as it can.
create function app.handle_discord_identity() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  shown text := left(coalesce(
    new.identity_data -> 'custom_claims' ->> 'global_name',
    new.identity_data ->> 'full_name',
    new.identity_data ->> 'name'
  ), 100);
begin
  if new.provider is distinct from 'discord' or new.provider_id is null then
    return new;
  end if;

  insert into public.members (id) values (new.user_id) on conflict (id) do nothing;

  -- An older account that was removed without its records being deleted may
  -- still hold this Discord ID. Free it, or the person could never sign in again.
  update public.member_accounts set discord_id = null
  where discord_id = new.provider_id and member_id <> new.user_id;

  insert into public.member_accounts (member_id, discord_id, discord_name)
  values (new.user_id, new.provider_id, shown)
  on conflict (member_id) do update
    set discord_id = excluded.discord_id, discord_name = excluded.discord_name;

  -- The founder is promoted once: on their first sign-in, and only while the
  -- fleet has no admin. After that the Discord ID carries no power.
  if tg_op = 'INSERT'
     and new.provider_id = (select founder_discord_id from app.bootstrap)
     and not exists (select 1 from public.member_roles where role = 'admin') then
    perform app.promote_founder(new.user_id);
  end if;
  return new;
end;
$$;

create trigger on_discord_identity
  after insert or update on auth.identities
  for each row execute function app.handle_discord_identity();

-- Naming the founder after they have already signed in promotes them then.
create function app.on_founder_named() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.founder_discord_id is not null
     and not exists (select 1 from public.member_roles where role = 'admin') then
    perform app.promote_founder(member_id)
    from public.member_accounts
    where discord_id = new.founder_discord_id;
  end if;
  return new;
end;
$$;

create trigger bootstrap_founder_named
  after update of founder_discord_id on app.bootstrap
  for each row execute function app.on_founder_named();

-- ---------------------------------------------------------------------------
-- Member records and roles
-- ---------------------------------------------------------------------------

create function app.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger members_touch before update on public.members
  for each row execute function app.touch_updated_at();
create trigger fleet_settings_touch before update on public.fleet_settings
  for each row execute function app.touch_updated_at();

-- What can change on a member's record, and who can change it.
--   You: your RSI handle, and your character name until you have joined.
--   Staff, for other people only: status, service, joining date and names.
--   Command: discharging someone, sending them back out, or undoing a discharge.
--   Admin: anything, including an admin's record.
create function app.guard_member_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'A member''s id cannot change.' using errcode = '42501';
  end if;
  if app.is_trusted_context() or app.has_role('admin') then
    return new;
  end if;

  if app.is_staff() and old.id <> (select auth.uid()) then
    if app.holds_role(old.id, 'admin') then
      raise exception 'Only an admin can change an admin''s record.' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and (new.status in ('discharged', 'applicant') or old.status = 'discharged')
       and not app.has_role('command') then
      raise exception 'Discharging a member, or undoing a discharge, is a command decision.'
        using errcode = '42501';
    end if;
    if new.service is distinct from old.service
       and new.service is not null
       and not (select new.service = any (open_services) from public.fleet_settings) then
      raise exception 'The % is not open yet.', initcap(new.service::text) using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     or new.service is distinct from old.service
     or new.joined_on is distinct from old.joined_on then
    raise exception 'You cannot change your own status, service or joining date.'
      using errcode = '42501';
  end if;
  if old.status <> 'applicant'
     and old.character_name is not null
     and new.character_name is distinct from old.character_name then
    raise exception 'A character name is fixed once you have joined. Ask staff to change it.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger members_guard before update on public.members
  for each row execute function app.guard_member_update();

-- Only a full member holds a position, so any other status ends every
-- assignment. Leaving the fleet, either way, also removes every role.
create function app.after_member_status_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    -- Roles go first: if this is the last admin, the change stops here.
    if new.status in ('applicant', 'discharged') then
      delete from public.member_roles where member_id = new.id;
    end if;
    if new.status <> 'member' then
      update public.assignments set ended_on = greatest(current_date, started_on)
      where member_id = new.id and ended_on is null;
    end if;
  end if;
  return new;
end;
$$;

create trigger members_after_status after update of status on public.members
  for each row execute function app.after_member_status_change();

-- The fleet must never be left without an admin. The last admin cannot lose
-- the role or leave. Only deleting their account outright gets past this, and
-- that can only be done from the Supabase dashboard.
create function app.keep_one_admin() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'admin' then
    -- One at a time, so two admins cannot remove each other in the same moment.
    perform pg_advisory_xact_lock(hashtext('app.keep_one_admin'));
    if not exists (select 1 from public.member_roles where role = 'admin' and member_id <> old.member_id)
       and exists (select 1 from public.members where id = old.member_id) then
      raise exception 'This is the last admin. Make someone else an admin first.'
        using errcode = '42501';
    end if;
  end if;
  return old;
end;
$$;

create trigger member_roles_keep_one_admin before delete on public.member_roles
  for each row execute function app.keep_one_admin();

-- A role goes to a serving member and is stamped with who granted it.
create function app.stamp_role_grant() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.is_trusted_context() then
    new.granted_by := (select auth.uid());
    new.granted_at := now();
  end if;
  if not exists (
    select 1 from public.members
    where id = new.member_id and status in ('recruit', 'auxiliary', 'member', 'reserve')
  ) then
    raise exception 'Only a serving member can hold a role.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger member_roles_stamp before insert on public.member_roles
  for each row execute function app.stamp_role_grant();

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------

-- An assignment must fit its position:
--   the position, its unit and every unit above it are open at the fleet's
--   current stage;
--   the member is a full member, and in the unit's service if it has one;
--   they hold every qualification it asks for, unless the appointment is acting
--   and the position waives that one for an acting holder;
--   for a primary position, the grade is inside the band. With no grade given,
--   the member keeps their grade if it is inside the band and otherwise takes
--   the bottom of the band, as Volume 1 says;
--   for a duty, the member is at or above its lowest grade.
-- Afterwards the grade, the acting flag and the note can change, and the
-- assignment can be ended. A different position is a new assignment.
--
-- Command cannot appoint or promote themselves, or touch an admin's
-- appointments.
create function app.check_assignment() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  trusted boolean := app.is_trusted_context();
  post public.positions%rowtype;
  target_status public.member_status;
  target_service public.service;
  unit_service public.service;
  opens smallint;
  held_order smallint;
  floor_order smallint;
  ceiling_order smallint;
  missing text;
begin
  -- Refused first, so that nothing below can tell an outsider anything.
  if tg_op = 'INSERT' and not trusted and not app.has_role('command') then
    raise exception 'Appointments are a command decision.' using errcode = '42501';
  end if;

  if not trusted and not app.has_role('admin') then
    if app.holds_role(new.member_id, 'admin') then
      raise exception 'Only an admin can change an admin''s appointments.' using errcode = '42501';
    end if;
    if new.member_id = (select auth.uid())
       and (tg_op = 'INSERT'
            or new.grade_code is distinct from old.grade_code
            or new.acting is distinct from old.acting) then
      raise exception 'You cannot appoint or promote yourself.' using errcode = '42501';
    end if;
  end if;

  select * into post from public.positions where id = new.position_id;

  if tg_op = 'UPDATE' then
    if new.member_id is distinct from old.member_id
       or new.position_id is distinct from old.position_id
       or new.kind is distinct from old.kind then
      raise exception 'An assignment cannot be moved. End it and make a new one.' using errcode = '23514';
    end if;
    if not trusted then
      if old.ended_on is not null then
        raise exception 'This assignment has ended and is part of the service record.' using errcode = '23514';
      end if;
      if new.ended_on is not null and new.ended_on <> greatest(current_date, old.started_on) then
        raise exception 'An assignment ends on the day it is ended.' using errcode = '23514';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.kind is distinct from post.kind then
      raise exception 'This position is a % position.', post.kind using errcode = '23514';
    end if;
    if not trusted then
      new.appointed_by := (select auth.uid());
    end if;

    with recursive above as (
      select u.id, u.parent_id, u.opens_at_stage from public.units u where u.id = post.unit_id
      union
      select u.id, u.parent_id, u.opens_at_stage from public.units u join above on u.id = above.parent_id
    )
    select greatest(post.opens_at_stage, max(above.opens_at_stage)) into opens from above;
    if opens > (select current_stage from public.fleet_settings) then
      raise exception 'This position does not open until stage %.', opens using errcode = '23514';
    end if;

    -- Held until this appointment is saved, so a discharge cannot slip in between.
    select status, service into target_status, target_service
    from public.members where id = new.member_id for share;
    if target_status is distinct from 'member' then
      raise exception 'Only a full member can hold a position.' using errcode = '23514';
    end if;
    select service into unit_service from public.units where id = post.unit_id;
    if unit_service is not null and target_service is distinct from unit_service then
      raise exception 'This position belongs to the %.', initcap(unit_service::text) using errcode = '23514';
    end if;
  end if;

  -- Checked on appointment, and again when an acting holder is confirmed.
  if tg_op = 'INSERT' or (old.acting and not new.acting) then
    select q.name into missing
    from public.position_qualifications pq
    join public.qualifications q on q.id = pq.qualification_id
    where pq.position_id = new.position_id
      and not (new.acting and pq.waived_when_acting)
      and not exists (
        select 1 from public.qualification_awards a
        where a.member_id = new.member_id and a.qualification_id = pq.qualification_id
      )
    order by q.name
    limit 1;
    if missing is not null then
      raise exception 'This position needs the % qualification.', missing using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' and new.kind = 'duty' and post.min_grade is not null then
    select sort_order into held_order from public.grades where code = app.member_grade(new.member_id);
    select sort_order into floor_order from public.grades where code = post.min_grade;
    if held_order is null or held_order < floor_order then
      raise exception 'This duty is open to % and above.', post.min_grade using errcode = '23514';
    end if;
  end if;

  if new.kind = 'primary' and (tg_op = 'INSERT' or new.grade_code is distinct from old.grade_code) then
    select sort_order into floor_order from public.grades where code = post.min_grade;
    select sort_order into ceiling_order from public.grades where code = post.max_grade;
    if new.grade_code is null and tg_op = 'UPDATE' then
      raise exception 'A primary position always carries a grade.' using errcode = '23514';
    end if;
    if new.grade_code is null then
      select sort_order into held_order from public.grades where code = app.member_grade(new.member_id);
      new.grade_code := case
        when held_order between floor_order and ceiling_order then app.member_grade(new.member_id)
        else post.min_grade
      end;
    end if;
    select sort_order into held_order from public.grades where code = new.grade_code;
    if held_order is null or held_order < floor_order or held_order > ceiling_order then
      raise exception 'Grade % is outside this position''s band, % to %.',
        new.grade_code, post.min_grade, post.max_grade using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger assignments_check before insert or update on public.assignments
  for each row execute function app.check_assignment();

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------

-- An applicant may withdraw their own application and nothing else. Staff move
-- other people's applications through the stages, never their own. A decision
-- is stamped with who made it and when, and a closed application stays closed.
create function app.guard_application_update() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.member_id is distinct from old.member_id
     or new.route is distinct from old.route
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'An application cannot be moved or re-dated.' using errcode = '42501';
  end if;

  if app.is_trusted_context() then
    return new;
  end if;

  if new.answers is distinct from old.answers
     or new.preferred_service is distinct from old.preferred_service then
    raise exception 'An application cannot be changed after it is sent.' using errcode = '42501';
  end if;
  if old.stage not in ('submitted', 'interview') then
    raise exception 'This application is closed.' using errcode = '42501';
  end if;

  if app.is_staff() and old.member_id <> (select auth.uid()) then
    if new.stage = 'withdrawn' then
      raise exception 'Only the applicant can withdraw an application.' using errcode = '42501';
    end if;
    if new.stage in ('accepted', 'declined') then
      new.decided_at := now();
      new.decided_by := (select auth.uid());
    end if;
    return new;
  end if;

  if new.stage = 'withdrawn' then
    return new;
  end if;
  raise exception 'You can withdraw your application, but not change it.' using errcode = '42501';
end;
$$;

create trigger applications_guard before update on public.applications
  for each row execute function app.guard_application_update();

-- Accepting an application makes an applicant a recruit in the service they
-- asked for. A cadet who applied from outside still starts as a recruit. A
-- serving member accepted for the cadet course keeps their status.
create function app.after_application_decision() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  applicant public.members%rowtype;
begin
  if new.stage = 'accepted' and old.stage is distinct from 'accepted' then
    select * into applicant from public.members where id = new.member_id;
    if applicant.status = 'applicant' then
      if exists (
        select 1 from public.members other
        where other.id <> applicant.id
          and other.status in ('recruit', 'auxiliary', 'member', 'reserve')
          and (lower(other.character_name) = lower(applicant.character_name)
               or lower(other.rsi_handle) = lower(applicant.rsi_handle))
      ) then
        raise exception 'A serving member already has this character name or RSI handle. Ask the applicant to change it, then accept.'
          using errcode = '23505';
      end if;
      update public.members
      set status = 'recruit', service = coalesce(service, new.preferred_service)
      where id = new.member_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger applications_after_decision after update of stage on public.applications
  for each row execute function app.after_application_decision();

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

-- Who changed what, and when. Written by the database, never by a client.
create function app.audit() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  before_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  after_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  any_row jsonb := coalesce(after_row, before_row);
  who uuid;
begin
  if tg_table_name = 'members' then
    who := (any_row ->> 'id')::uuid;
  elsif tg_table_name = 'application_notes' then
    -- The log records that a note was written or removed, not what it said.
    before_row := before_row - 'body';
    after_row := after_row - 'body';
    select member_id into who from public.applications where id = (any_row ->> 'application_id')::uuid;
    if tg_op = 'DELETE' and who is null then
      return old;
    end if;
  else
    who := (any_row ->> 'member_id')::uuid;
  end if;

  -- When a member is deleted, their rows go with them and are not kept here.
  if tg_op = 'DELETE' and who is not null
     and not exists (select 1 from public.members where id = who) then
    return old;
  end if;

  insert into public.audit_log (actor, subject, table_name, action, old_row, new_row)
  values ((select auth.uid()), who, tg_table_name, lower(tg_op), before_row, after_row);
  return coalesce(new, old);
end;
$$;

create trigger members_audit after insert or update or delete on public.members
  for each row execute function app.audit();
create trigger member_roles_audit after insert or update or delete on public.member_roles
  for each row execute function app.audit();
create trigger units_audit after insert or update or delete on public.units
  for each row execute function app.audit();
create trigger positions_audit after insert or update or delete on public.positions
  for each row execute function app.audit();
create trigger qualifications_audit after insert or update or delete on public.qualifications
  for each row execute function app.audit();
create trigger position_qualifications_audit after insert or update or delete on public.position_qualifications
  for each row execute function app.audit();
create trigger assignments_audit after insert or update or delete on public.assignments
  for each row execute function app.audit();
create trigger qualification_awards_audit after insert or update or delete on public.qualification_awards
  for each row execute function app.audit();
create trigger applications_audit after insert or update or delete on public.applications
  for each row execute function app.audit();
create trigger application_notes_audit after insert or update or delete on public.application_notes
  for each row execute function app.audit();
create trigger fleet_settings_audit after update on public.fleet_settings
  for each row execute function app.audit();

-- Deleting a member on request also blanks what the audit log held about them.
create function app.forget_member() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.audit_log set old_row = null, new_row = null where subject = old.id;
  return old;
end;
$$;

create trigger members_forget after delete on public.members
  for each row execute function app.forget_member();

-- ---------------------------------------------------------------------------
-- The roster: each member with the rank their position gives them
-- ---------------------------------------------------------------------------

create view public.roster with (security_invoker = true) as
select
  m.id as member_id,
  m.character_name,
  m.rsi_handle,
  m.service,
  m.status,
  g.code as grade_code,
  r.name as rank_name,
  a.acting,
  p.id as position_id,
  p.title as position_title,
  u.id as unit_id,
  u.name as unit_name
from public.members m
left join public.assignments a
  on a.member_id = m.id and a.kind = 'primary' and a.ended_on is null
left join public.positions p on p.id = a.position_id
left join public.units u on u.id = p.unit_id
left join public.grades g on g.code = app.member_grade(m.id)
left join public.ranks r on r.grade_code = g.code and r.service = m.service;

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

-- Supabase gives the API roles every privilege on anything new in public, and
-- PostgreSQL lets everyone run any new function. Turn both off from here on,
-- so a later migration cannot expose something by forgetting to lock it.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all tables in schema app from public, anon, authenticated, service_role;
revoke all on all functions in schema app from public, anon, authenticated, service_role;

-- The access rules call these helpers, so signed-in users need to reach them.
-- Nothing else in the app schema is granted, and the schema is not served by
-- the API, so none of it can be called from outside.
grant usage on schema app to authenticated, service_role;
grant execute on function
  app.my_status(), app.has_role(public.app_role), app.holds_role(uuid, public.app_role),
  app.is_staff(), app.is_serving(), app.is_trusted_context(),
  app.may_apply(public.application_route, public.service), app.member_grade(uuid)
to authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant select on public.fleet_settings, public.grades, public.ranks to anon;

grant select on
  public.fleet_settings, public.grades, public.ranks, public.members, public.member_accounts,
  public.member_roles, public.units, public.positions, public.qualifications,
  public.position_qualifications, public.qualification_awards, public.assignments,
  public.applications, public.application_notes, public.audit_log, public.roster
to authenticated;

-- Writes are granted column by column wherever the database fills in a column
-- for itself: ids, dates and who did it cannot be sent from outside at all.
grant update (recruitment_open, open_services, current_stage) on public.fleet_settings to authenticated;
grant update (character_name, rsi_handle, service, status, joined_on) on public.members to authenticated;

grant insert (member_id, role) on public.member_roles to authenticated;
grant delete on public.member_roles to authenticated;

grant insert, update, delete on
  public.units, public.positions, public.qualifications, public.position_qualifications
to authenticated;

grant insert (member_id, position_id, kind, grade_code, acting, note) on public.assignments to authenticated;
grant update (grade_code, acting, ended_on, note) on public.assignments to authenticated;
grant delete on public.assignments to authenticated;

grant insert (member_id, qualification_id, awarded_by, note) on public.qualification_awards to authenticated;
grant delete on public.qualification_awards to authenticated;

grant insert (member_id, route, preferred_service, answers) on public.applications to authenticated;
grant update (stage) on public.applications to authenticated;
grant delete on public.applications to authenticated;

grant insert (application_id, author_id, body) on public.application_notes to authenticated;
grant delete on public.application_notes to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.fleet_settings enable row level security;
alter table public.grades enable row level security;
alter table public.ranks enable row level security;
alter table public.members enable row level security;
alter table public.member_accounts enable row level security;
alter table public.member_roles enable row level security;
alter table public.units enable row level security;
alter table public.positions enable row level security;
alter table public.qualifications enable row level security;
alter table public.position_qualifications enable row level security;
alter table public.qualification_awards enable row level security;
alter table public.assignments enable row level security;
alter table public.applications enable row level security;
alter table public.application_notes enable row level security;
alter table public.audit_log enable row level security;
alter table app.bootstrap enable row level security;

-- Anyone, signed in or not.
create policy "Anyone can read the settings" on public.fleet_settings
  for select to anon, authenticated using (true);
create policy "Anyone can read the grades" on public.grades
  for select to anon, authenticated using (true);
create policy "Anyone can read the ranks" on public.ranks
  for select to anon, authenticated using (true);

create policy "Admins change the settings" on public.fleet_settings
  for update to authenticated
  using ((select app.has_role('admin')))
  with check ((select app.has_role('admin')));

-- Members: yourself always; the serving fleet if you are in it; everyone if staff.
create policy "See yourself, the fleet you serve in, or everyone as staff" on public.members
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select app.is_staff())
    or ((select app.is_serving()) and status in ('recruit', 'auxiliary', 'member', 'reserve'))
  );
create policy "Change your own row, or any row as staff" on public.members
  for update to authenticated
  using (id = (select auth.uid()) or (select app.is_staff()))
  with check (id = (select auth.uid()) or (select app.is_staff()));

create policy "See your own account details, or any as staff" on public.member_accounts
  for select to authenticated
  using (member_id = (select auth.uid()) or (select app.is_staff()));

create policy "Roles are visible inside the fleet" on public.member_roles
  for select to authenticated
  using (member_id = (select auth.uid()) or (select app.is_serving()) or (select app.is_staff()));
create policy "Admins grant roles" on public.member_roles
  for insert to authenticated with check ((select app.has_role('admin')));
create policy "Admins remove roles" on public.member_roles
  for delete to authenticated using ((select app.has_role('admin')));

-- The order of battle is read by the serving fleet and kept by the admin. What
-- opens, and when, is the one thing that must not drift.
create policy "The fleet reads units" on public.units
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Admins add units" on public.units
  for insert to authenticated with check ((select app.has_role('admin')));
create policy "Admins change units" on public.units
  for update to authenticated
  using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
create policy "Admins remove units" on public.units
  for delete to authenticated using ((select app.has_role('admin')));

create policy "The fleet reads positions" on public.positions
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Admins add positions" on public.positions
  for insert to authenticated with check ((select app.has_role('admin')));
create policy "Admins change positions" on public.positions
  for update to authenticated
  using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
create policy "Admins remove positions" on public.positions
  for delete to authenticated using ((select app.has_role('admin')));

create policy "The fleet reads qualifications" on public.qualifications
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Admins add qualifications" on public.qualifications
  for insert to authenticated with check ((select app.has_role('admin')));
create policy "Admins change qualifications" on public.qualifications
  for update to authenticated
  using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
create policy "Admins remove qualifications" on public.qualifications
  for delete to authenticated using ((select app.has_role('admin')));

create policy "The fleet reads what positions require" on public.position_qualifications
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Admins set what positions require" on public.position_qualifications
  for insert to authenticated with check ((select app.has_role('admin')));
create policy "Admins change what positions require" on public.position_qualifications
  for update to authenticated
  using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
create policy "Admins remove what positions require" on public.position_qualifications
  for delete to authenticated using ((select app.has_role('admin')));

-- Qualifications are awarded by instructors, in their own name. A serving
-- member sees the awards of the people they can see, so not those of someone
-- who has been discharged.
create policy "See your own awards, or the fleet's if you serve" on public.qualification_awards
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or (select app.is_staff())
    or (
      (select app.is_serving())
      and exists (select 1 from public.members m where m.id = qualification_awards.member_id)
    )
  );
create policy "Instructors award qualifications in their own name" on public.qualification_awards
  for insert to authenticated
  with check (
    (select app.has_role('instructor'))
    and awarded_by = (select auth.uid())
    -- Nobody signs off their own qualification, except the admin who has to
    -- start the chain.
    and (member_id <> (select auth.uid()) or (select app.has_role('admin')))
    and exists (
      select 1 from public.members m
      where m.id = qualification_awards.member_id
        and m.status in ('recruit', 'auxiliary', 'member', 'reserve')
    )
  );
create policy "Staff remove awards, but not their own or an admin's" on public.qualification_awards
  for delete to authenticated
  using (
    (select app.has_role('admin'))
    or (
      (select app.is_staff())
      and member_id <> (select auth.uid())
      and not app.holds_role(member_id, 'admin')
    )
  );

-- Appointments are a command decision.
create policy "See your own assignments, or the fleet's if you serve" on public.assignments
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or (select app.is_staff())
    or (
      (select app.is_serving())
      and exists (select 1 from public.members m where m.id = assignments.member_id)
    )
  );
create policy "Command makes appointments" on public.assignments
  for insert to authenticated with check ((select app.has_role('command')));
create policy "Command changes appointments" on public.assignments
  for update to authenticated
  using ((select app.has_role('command'))) with check ((select app.has_role('command')));
-- An ended assignment is part of the service record. Only an admin deletes one,
-- to put right a mistake.
create policy "Admins delete appointments made by mistake" on public.assignments
  for delete to authenticated using ((select app.has_role('admin')));

-- Applications: your own, or all of them as staff.
create policy "See your own application, or any as staff" on public.applications
  for select to authenticated
  using (member_id = (select auth.uid()) or (select app.is_staff()));
create policy "Apply for yourself while recruitment is open" on public.applications
  for insert to authenticated
  with check (
    member_id = (select auth.uid())
    and stage = 'submitted'
    and decided_at is null
    and decided_by is null
    and (select app.may_apply(route, preferred_service))
  );
create policy "Withdraw your own, or progress any as staff" on public.applications
  for update to authenticated
  using (member_id = (select auth.uid()) or (select app.is_staff()))
  with check (member_id = (select auth.uid()) or (select app.is_staff()));
create policy "Admins delete applications" on public.applications
  for delete to authenticated using ((select app.has_role('admin')));

-- Interview notes are for staff, except the notes on a staff member's own
-- application.
create policy "Staff read interview notes, but not about themselves" on public.application_notes
  for select to authenticated
  using (
    (select app.is_staff())
    and not exists (
      select 1 from public.applications a
      where a.id = application_notes.application_id and a.member_id = (select auth.uid())
    )
  );
create policy "Staff write interview notes in their own name" on public.application_notes
  for insert to authenticated
  with check (
    (select app.is_staff())
    and author_id = (select auth.uid())
    and not exists (
      select 1 from public.applications a
      where a.id = application_notes.application_id and a.member_id = (select auth.uid())
    )
  );
create policy "Authors and admins delete interview notes" on public.application_notes
  for delete to authenticated
  using (((select app.is_staff()) and author_id = (select auth.uid())) or (select app.has_role('admin')));

create policy "Admins read the audit log" on public.audit_log
  for select to authenticated using ((select app.has_role('admin')));
