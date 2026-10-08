-- Roles: what a position is, kept as a record that can be edited.
--
-- Until now the roles pages worked a role out from a position's title and the
-- ship it sat on, so "Turret Gunner on UEES Nexus" was a role and so was
-- "Gunner on Escort One". A role is now a record of its own, such as Gunner,
-- and every position has one. The role says what the work is, what it needs
-- and where it leads. A position says where one place for that work is.
--
-- A role belongs to an area of work, such as Gunnery. Areas were a list in the
-- site's code and are now records too.
--
-- A role here is a fleet role. It is not a member's role on the site
-- (instructor, staff, command, admin), which stays in member_roles.
--
-- Admins keep all of it through the website: areas, roles, units, positions,
-- qualifications, rank names and what each grade usually does. Every change
-- is logged.

-- ---------------------------------------------------------------------------
-- Areas and roles
-- ---------------------------------------------------------------------------

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  -- Its address on the site: /roles/gunnery.
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name text not null check (char_length(name) between 2 and 60),
  -- The group it is filtered by on the roles page.
  domain text not null check (domain in ('command', 'ship', 'flight', 'ground', 'support', 'staff')),
  -- The name of one of the site's pictures.
  picture text not null default 'areaOther' check (char_length(picture) <= 40),
  about text not null default '' check (char_length(about) <= 600),
  -- For an area with no positions yet: the stage it opens at, and its size.
  planned_stage smallint check (planned_stage between 1 and 9),
  planned_size text not null default '' check (char_length(planned_size) <= 60),
  -- Sections of the manual to read, each as volume/section.
  reading text[] not null default '{}' check (cardinality(reading) <= 20),
  sort_order integer not null default 0
);

create table public.fleet_roles (
  id uuid primary key default gen_random_uuid(),
  -- Its address on the site: /roles/gunnery/gunner.
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name text not null unique check (char_length(name) between 2 and 60),
  area_id uuid not null references public.areas (id) on delete restrict,
  kind public.post_kind not null default 'primary',
  -- One or two sentences on what the role is.
  summary text not null default '' check (char_length(summary) <= 300),
  -- What the role does, one duty to a line.
  duties text not null default '' check (char_length(duties) <= 4000),
  -- Sections of the manual to read for this role, on top of its area's.
  reading text[] not null default '{}' check (cardinality(reading) <= 20),
  -- The role this one leads to, so that progression can be seen.
  next_role_id uuid references public.fleet_roles (id) on delete set null,
  sort_order integer not null default 0,
  constraint fleet_roles_not_own_next check (next_role_id <> id)
);
create index fleet_roles_area_idx on public.fleet_roles (area_id);

-- What every position of a role needs. A position can need more on top.
create table public.fleet_role_qualifications (
  role_id uuid not null references public.fleet_roles (id) on delete cascade,
  qualification_id uuid not null references public.qualifications (id) on delete restrict,
  waived_when_acting boolean not null default false,
  primary key (role_id, qualification_id)
);

alter table public.positions add column role_id uuid references public.fleet_roles (id) on delete restrict;
create index positions_role_idx on public.positions (role_id);

-- ---------------------------------------------------------------------------
-- The first areas and roles
-- ---------------------------------------------------------------------------

-- The areas the site already showed. The Fleet Commander will set his own.
insert into public.areas (slug, name, domain, picture, about, planned_stage, planned_size, reading, sort_order)
values
  ('command', 'Command posts', 'command', 'areaCommand', 'The commanders and their deputies, from the Fleet Commander to the commanding officer of a ship.', null, '', array['organisation/fleet-command', 'command/succession-and-continuity', 'command/appointments', 'command/orders', 'command/reports', 'command/who-decides-what']::text[], 1),
  ('signals', 'Signals', 'command', 'areaSignals', 'The Signaller is the control station of the command net and keeps its log.', null, '', array['organisation/navy-squadron']::text[], 2),
  ('helm', 'Helm and navigation', 'ship', 'areaHelm', 'The flagship''s helm is an enlisted Helmsman. The Navigator is the backup helm and also works sensors and route planning.', null, '', array['organisation/navy-squadron']::text[], 3),
  ('gunnery', 'Gunnery', 'ship', 'areaGunnery', 'The gunners at a ship''s turrets and remote weapons stations, led on the flagship by the Gunnery Chief.', null, '', array['organisation/navy-squadron']::text[], 4),
  ('engineering', 'Engineering', 'ship', 'areaEngineering', 'A ship''s engineers, led on the flagship by the Chief Engineer.', null, '', array['organisation/navy-squadron']::text[], 5),
  ('medical', 'Medical', 'ship', 'areaMedical', 'The flagship''s Medic. The medical chain is set out in a later volume of the manual.', null, '', array['organisation/navy-squadron']::text[], 6),
  ('flight-deck', 'Flight deck', 'ship', 'areaDeck', 'The Flight Deck Chief and the deck hands of the flagship.', null, '', array['organisation/navy-squadron']::text[], 7),
  ('ship-security', 'Ship security', 'ship', 'areaSecurity', 'The flagship''s Master-at-Arms. From stage 5 the Marines post a ship security detachment aboard.', null, '', array['organisation/navy-squadron', 'organisation/marine-company']::text[], 8),
  ('fighters', 'Fighters', 'flight', 'areaFighters', 'The pilots of the air wing. A full flight is 12 aircraft in three sections of four, and the flight lead flies as one of them.', null, '', array['organisation/navy-squadron']::text[], 9),
  ('lift', 'Lift', 'flight', 'areaLift', 'The lift flight: a flight commander, three dropship skippers and eight crew.', 4, '12 posts', array['organisation/navy-squadron']::text[], 10),
  ('infantry', 'Infantry', 'ground', 'areaInfantry', 'The Army. It opens as one section of eight soldiers and grows to a platoon in the same stage.', 4, 'Army', array['organisation/army-battalion']::text[], 11),
  ('boarding', 'Boarding', 'ground', 'areaBoarding', 'The Marines'' boarding teams, each eight strong. The Marines grow from a ship security detachment to a platoon at stage 6.', 6, 'Marines', array['organisation/marine-company']::text[], 12),
  ('fleet-support', 'Fleet support', 'support', 'areaSupport', 'The support flight, with its refuel, repair, medical and cargo ships.', 5, '22 posts', array['organisation/navy-squadron']::text[], 13),
  ('reconnaissance', 'Reconnaissance', 'support', 'areaRecon', 'The reconnaissance flight of the patrol and support flotilla.', 7, '8 posts', array['organisation/patrol-and-support-flotilla']::text[], 14),
  ('staff-duties', 'Staff duties', 'staff', 'areaStaff', 'Part-time staff jobs held as well as a post, such as recruiter, instructor and planner. A duty carries no rank.', null, '', array['command/staff-sections-and-the-command-board', 'command/appointments']::text[], 15);

-- The Fleet Commander's first roles. Gunner covers the turret gunners and the
-- remote weapons operators as well as a small ship's gunners. Engineer and
-- Senior Engineer stay apart, so that an engineer has somewhere to go. A pilot
-- of A Flight is a Fighter Pilot. Each chief, each officer and each staff duty
-- is a role of its own.
--
-- A summary is written only where Volumes 1 and 2 say what the role is.
insert into public.fleet_roles (slug, name, area_id, kind, summary, sort_order)
select v.slug, v.name, a.id, v.kind::public.post_kind, v.summary, v.sort
from (values
  ('fleet-commander', 'Fleet Commander', 'command', 'primary', 'Commands the fleet, and wears the rank of the largest formation that is open.', 1),
  ('commanding-officer', 'Commanding Officer', 'command', 'primary', 'Commands a ship.', 2),
  ('executive-officer', 'Executive Officer', 'command', 'primary', 'First on the flagship''s succession list, and the Fleet Commander''s deputy from stage 2 to stage 6.', 3),
  ('tactical-officer', 'Tactical Officer', 'command', 'primary', 'Second on the flagship''s succession list. Answers to the Executive Officer.', 4),
  ('chief-of-the-boat', 'Chief of the Boat', 'command', 'primary', 'The commanding officer''s senior enlisted adviser, and third on the flagship''s succession list.', 5),
  ('signaller', 'Signaller', 'signals', 'primary', 'The control station of the command net, callsign Zero. Enforces voice procedure and keeps the log.', 6),
  ('helmsman', 'Helmsman', 'helm', 'primary', 'At the helm of a ship. On the flagship the Helmsman is enlisted, and is backed up by the Navigator.', 7),
  ('navigator', 'Navigator', 'helm', 'primary', 'The backup helm, who also works sensors and route planning.', 8),
  ('gunnery-chief', 'Gunnery Chief', 'gunnery', 'primary', 'Leads the flagship''s gunners.', 9),
  ('gunner', 'Gunner', 'gunnery', 'primary', 'Mans a ship''s weapons, from a turret or a remote weapons station.', 10),
  ('chief-engineer', 'Chief Engineer', 'engineering', 'primary', 'Leads the flagship''s engineers.', 11),
  ('senior-engineer', 'Senior Engineer', 'engineering', 'primary', '', 12),
  ('engineer', 'Engineer', 'engineering', 'primary', '', 13),
  ('medic', 'Medic', 'medical', 'primary', 'A ship''s medic. The medical chain is set out in a later volume of the manual.', 14),
  ('flight-deck-chief', 'Flight Deck Chief', 'flight-deck', 'primary', 'Leads the flagship''s flight deck.', 15),
  ('deck-hand', 'Deck Hand', 'flight-deck', 'primary', '', 16),
  ('master-at-arms', 'Master-at-Arms', 'ship-security', 'primary', 'Ship security on the flagship. From stage 5 the Marines post a security detachment aboard.', 17),
  ('flight-lead', 'Flight Lead', 'fighters', 'primary', 'Leads a flight, and flies as one of its aircraft.', 18),
  ('fighter-pilot', 'Fighter Pilot', 'fighters', 'primary', 'A line pilot of the air wing. Senior pilots lead sections of four.', 19),
  ('recruiter', 'Recruiter', 'staff-duties', 'duty', 'Interviews the people who apply to join.', 20),
  ('instructor', 'Instructor', 'staff-duties', 'duty', 'Runs training for recruits and members.', 21),
  ('head-of-personnel-and-recruiting', 'Head of Personnel and Recruiting', 'staff-duties', 'duty', 'Heads one of the fleet''s staff sections. Held as a duty until stage 8, when it becomes a full post.', 22),
  ('commandant-training-school', 'Commandant, Training School', 'staff-duties', 'duty', 'Heads one of the fleet''s staff sections. Held as a duty until stage 8, when it becomes a full post.', 23),
  ('head-of-operations-and-planning', 'Head of Operations and Planning', 'staff-duties', 'duty', 'Heads one of the fleet''s staff sections. Held as a duty until stage 8, when it becomes a full post.', 24),
  ('head-of-logistics-and-medical', 'Head of Logistics and Medical', 'staff-duties', 'duty', 'Heads one of the fleet''s staff sections. Held as a duty until stage 8, when it becomes a full post.', 25),
  ('staff-clerk', 'Staff Clerk', 'staff-duties', 'duty', 'Keeps records, attendance and the ledger.', 26),
  ('conduct-panel-member', 'Conduct Panel Member', 'staff-duties', 'duty', 'Hears conduct cases as one of three members, all from outside the person''s own unit.', 27),
  ('planner', 'Planner', 'staff-duties', 'duty', 'Writes orders and plays the opposing force for battle group operations.', 28),
  ('head-of-systems', 'Head of Systems', 'staff-duties', 'duty', 'Heads one of the fleet''s staff sections. Held as a duty until stage 8, when it becomes a full post.', 29),
  ('developer', 'Developer', 'staff-duties', 'duty', 'Works on the platform and the voice app.', 30)
) as v (slug, name, area, kind, summary, sort)
join public.areas a on a.slug = v.area;

-- Where a role leads. Only the steps inside one department are set here.
update public.fleet_roles r set next_role_id = n.id
from (values
  ('engineer', 'senior-engineer'),
  ('senior-engineer', 'chief-engineer'),
  ('gunner', 'gunnery-chief'),
  ('deck-hand', 'flight-deck-chief'),
  ('fighter-pilot', 'flight-lead')
) as v (slug, next)
join public.fleet_roles n on n.slug = v.next
where r.slug = v.slug;

-- A pilot of A Flight is a Fighter Pilot, by title as well as by role.
update public.positions set title = regexp_replace(title, '^Pilot ', 'Fighter Pilot ') where title ~ '^Pilot \d+$';

-- Every position takes its role from its title, less its number.
update public.positions p set role_id = r.id
from (values
  ('Fleet Commander', 'fleet-commander'),
  ('Commanding Officer', 'commanding-officer'),
  ('Executive Officer', 'executive-officer'),
  ('Tactical Officer', 'tactical-officer'),
  ('Chief of the Boat', 'chief-of-the-boat'),
  ('Signaller', 'signaller'),
  ('Helmsman', 'helmsman'),
  ('Navigator', 'navigator'),
  ('Gunnery Chief', 'gunnery-chief'),
  ('Chief Engineer', 'chief-engineer'),
  ('Senior Engineer', 'senior-engineer'),
  ('Engineer', 'engineer'),
  ('Medic', 'medic'),
  ('Flight Deck Chief', 'flight-deck-chief'),
  ('Deck Hand', 'deck-hand'),
  ('Master-at-Arms', 'master-at-arms'),
  ('Flight Lead', 'flight-lead'),
  ('Recruiter', 'recruiter'),
  ('Instructor', 'instructor'),
  ('Head of Personnel and Recruiting', 'head-of-personnel-and-recruiting'),
  ('Commandant, Training School', 'commandant-training-school'),
  ('Head of Operations and Planning', 'head-of-operations-and-planning'),
  ('Head of Logistics and Medical', 'head-of-logistics-and-medical'),
  ('Staff Clerk', 'staff-clerk'),
  ('Conduct Panel Member', 'conduct-panel-member'),
  ('Planner', 'planner'),
  ('Head of Systems', 'head-of-systems'),
  ('Developer', 'developer'),
  ('Gunner', 'gunner'),
  ('Turret Gunner', 'gunner'),
  ('Remote Weapons Operator', 'gunner'),
  ('Fighter Pilot', 'fighter-pilot')
) as v (title, slug)
join public.fleet_roles r on r.slug = v.slug
where regexp_replace(p.title, ' \d+$', '') = v.title;

-- This fails, and the migration with it, if any position was left without one.
alter table public.positions alter column role_id set not null;

do $$
begin
  if exists (
    select 1 from public.positions p join public.fleet_roles r on r.id = p.role_id where r.kind <> p.kind
  ) then
    raise exception 'A position was given a role of the other kind.';
  end if;
end;
$$;

-- No role needs anything of its own yet. What a position needs stays on the
-- position, where it was: the Signaller's Net controller and the Instructor's
-- Instructor qualification. An admin can move a need up to its role on the
-- site, so that it holds for every position of that role.

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- A primary position has a primary role, and a duty has a duty's role.
create function app.check_position_role() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  role public.fleet_roles%rowtype;
begin
  -- With no role given, the column's own rule refuses the position.
  if new.role_id is null then
    return new;
  end if;
  select * into role from public.fleet_roles where id = new.role_id;
  if role.kind is distinct from new.kind then
    raise exception 'The % role is for a % position, and this is a % position.', role.name, role.kind, new.kind
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger positions_role_check before insert or update of role_id, kind on public.positions
  for each row execute function app.check_position_role();

-- A role cannot change kind under its positions, and its steps cannot run in a circle.
create function app.check_fleet_role() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  step uuid := new.next_role_id;
  steps integer := 0;
begin
  if tg_op = 'UPDATE' and new.kind is distinct from old.kind
     and exists (select 1 from public.positions where role_id = new.id) then
    raise exception 'This role has positions. Move them to another role before changing its kind.'
      using errcode = '23514';
  end if;

  while step is not null and steps < 50 loop
    if step = new.id then
      raise exception 'A role cannot lead back to itself.' using errcode = '23514';
    end if;
    select next_role_id into step from public.fleet_roles where id = step;
    steps := steps + 1;
  end loop;
  return new;
end;
$$;

create trigger fleet_roles_check before insert or update on public.fleet_roles
  for each row execute function app.check_fleet_role();

-- An appointment now checks what the position's role needs as well as what
-- the position needs. Nothing else in this function has changed.
create or replace function app.check_assignment() returns trigger
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
    -- What the position's role needs, and what this position needs on top.
    select q.name into missing
    from (
      select rq.qualification_id, rq.waived_when_acting
      from public.fleet_role_qualifications rq where rq.role_id = post.role_id
      union all
      select pq.qualification_id, pq.waived_when_acting
      from public.position_qualifications pq where pq.position_id = new.position_id
    ) need
    join public.qualifications q on q.id = need.qualification_id
    where not (new.acting and need.waived_when_acting)
      and not exists (
        select 1 from public.qualification_awards a
        where a.member_id = new.member_id and a.qualification_id = need.qualification_id
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

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create trigger areas_audit after insert or update or delete on public.areas
  for each row execute function app.audit();
create trigger fleet_roles_audit after insert or update or delete on public.fleet_roles
  for each row execute function app.audit();
create trigger fleet_role_qualifications_audit after insert or update or delete on public.fleet_role_qualifications
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant all on public.areas, public.fleet_roles, public.fleet_role_qualifications to service_role;

-- The structure is public. Who holds a position is not, and is not here.
grant select on public.areas, public.fleet_roles, public.fleet_role_qualifications to anon, authenticated;

-- Only an admin's rule lets these through.
grant insert, update, delete on public.areas, public.fleet_roles, public.fleet_role_qualifications to authenticated;

-- A grade's code, band and place on the ladder are fixed. What it usually
-- does, and what each service calls it, can be changed.
grant update (typical_position) on public.grades to authenticated;
grant update (name) on public.ranks to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.areas enable row level security;
alter table public.fleet_roles enable row level security;
alter table public.fleet_role_qualifications enable row level security;

create policy "Anyone can read the areas" on public.areas
  for select to anon, authenticated using (true);
create policy "Admins add areas" on public.areas
  for insert to authenticated with check ((select app.has_role('admin')));
create policy "Admins change areas" on public.areas
  for update to authenticated
  using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
create policy "Admins remove areas" on public.areas
  for delete to authenticated using ((select app.has_role('admin')));

create policy "Anyone can read the roles" on public.fleet_roles
  for select to anon, authenticated using (true);
create policy "Admins add roles" on public.fleet_roles
  for insert to authenticated with check ((select app.has_role('admin')));
create policy "Admins change roles" on public.fleet_roles
  for update to authenticated
  using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
create policy "Admins remove roles" on public.fleet_roles
  for delete to authenticated using ((select app.has_role('admin')));

create policy "Anyone can read what roles require" on public.fleet_role_qualifications
  for select to anon, authenticated using (true);
create policy "Admins set what roles require" on public.fleet_role_qualifications
  for insert to authenticated with check ((select app.has_role('admin')));
create policy "Admins change what roles require" on public.fleet_role_qualifications
  for update to authenticated
  using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
create policy "Admins remove what roles require" on public.fleet_role_qualifications
  for delete to authenticated using ((select app.has_role('admin')));

create policy "Admins change what a grade usually does" on public.grades
  for update to authenticated
  using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
create policy "Admins change rank names" on public.ranks
  for update to authenticated
  using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
