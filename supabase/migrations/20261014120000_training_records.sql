-- Training records
--
-- Each qualification is a course of lessons, in order. An instructor signs off
-- a lesson for a member, at a training evolution or one to one; once every
-- lesson is signed off, an instructor awards the qualification, as a separate
-- step. The member sees what they have passed and what is left; instructors,
-- staff and command see everyone's.
--
--   The syllabus (the lessons of each course, and what a course requires
--   first) is command's to edit. A lesson that someone has passed stays.
--   A sign-off is an instructor's, in their own name, never their own, and
--   never for someone who already holds the qualification. The course's
--   prerequisite must be held first. A sign-off at an event is checked
--   against the event as an award is: it teaches that course, it has
--   started, and the member was there.
--   The instructor who signed a lesson off may withdraw it, until the
--   qualification is awarded. After that, only the award can be taken back,
--   by staff, as before.
--   Awarding a qualification needs what the course requires held, and every
--   lesson passed. A commission is recorded by command, for the board.
--   Taking a qualification away takes the course's passes with it.

-- ---------------------------------------------------------------------------
-- What a course requires first
-- ---------------------------------------------------------------------------

alter table public.qualifications
  add column requires_qualification_id uuid references public.qualifications (id) on delete set null,
  add constraint qualifications_requires_another check (requires_qualification_id is distinct from id);
create index qualifications_requires_idx on public.qualifications (requires_qualification_id) where requires_qualification_id is not null;

-- Command sets what a course requires, and nothing else about it. An admin
-- changes anything, as before. What a course requires never comes back round
-- to itself, or nobody could train.
create function app.guard_qualification() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  wanted uuid := new.requires_qualification_id;
begin
  if tg_op = 'UPDATE' and not app.is_trusted_context() and not app.has_role('admin') then
    if (to_jsonb(new) - 'requires_qualification_id') <> (to_jsonb(old) - 'requires_qualification_id') then
      raise exception 'Command sets what a course requires, and nothing else about it.' using errcode = '42501';
    end if;
  end if;
  if wanted is not null and exists (
    with recursive chain as (
      select q.id, q.requires_qualification_id, 1 as depth from public.qualifications q where q.id = wanted
      union all
      select q.id, q.requires_qualification_id, chain.depth + 1 from public.qualifications q join chain on q.id = chain.requires_qualification_id where chain.depth < 50
    )
    select 1 from chain where chain.id = new.id or chain.requires_qualification_id = new.id
  ) then
    raise exception 'A course cannot require one that requires it.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger qualifications_guard before insert or update on public.qualifications
  for each row execute function app.guard_qualification();

-- ---------------------------------------------------------------------------
-- The lessons of each course
-- ---------------------------------------------------------------------------

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  qualification_id uuid not null references public.qualifications (id) on delete cascade,
  sort_order smallint not null default 0 check (sort_order >= 0),
  name text not null check (char_length(name) between 1 and 80 and name !~ '(^\s|\s$)'),
  description text not null default '' check (char_length(description) <= 600),
  unique (qualification_id, name)
);
create index lessons_course_idx on public.lessons (qualification_id, sort_order);

create trigger lessons_audit after insert or update or delete on public.lessons
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- Who has passed which lesson
-- ---------------------------------------------------------------------------

create table public.lesson_passes (
  id bigint generated always as identity primary key,
  -- A lesson someone has passed stays on the syllabus.
  lesson_id uuid not null references public.lessons (id) on delete restrict,
  member_id uuid not null references public.members (id) on delete cascade,
  signed_by uuid references public.members (id) on delete set null,
  signed_at timestamptz not null default now(),
  -- The training evolution it was signed off at, if it was signed off at one.
  event_id uuid references public.events (id) on delete set null,
  unique (lesson_id, member_id)
);
create index lesson_passes_member_idx on public.lesson_passes (member_id);
create index lesson_passes_signer_idx on public.lesson_passes (signed_by) where signed_by is not null;
create index lesson_passes_event_idx on public.lesson_passes (event_id) where event_id is not null;

-- Whether a member holds a qualification now.
create function app.holds_qualification(target uuid, wanted uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.qualification_awards a where a.member_id = target and a.qualification_id = wanted
  );
$$;

-- A sign-off that names an event is checked against it: the event teaches
-- that course, it has started, and the member was there. The attendance
-- return has the last word on who was there; until it is made, the roll does.
create function app.check_taught_at(event_id uuid, member_id uuid, qualification_id uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare
  event public.events%rowtype;
  mark public.attendance_return;
begin
  select * into event from public.events e where e.id = check_taught_at.event_id;
  if event.id is null or event.teaches_qualification_id is distinct from check_taught_at.qualification_id then
    raise exception 'That event does not teach this qualification.' using errcode = '23514';
  end if;
  if event.state not in ('announced', 'done') or now() < event.starts_at then
    raise exception 'A pass is signed off once the event has started.' using errcode = '23514';
  end if;
  select r.returned into mark from public.attendance_returns r
  where r.event_id = check_taught_at.event_id and r.member_id = check_taught_at.member_id;
  if mark is not null then
    if mark <> 'present' then
      raise exception 'That member was marked absent from the event.' using errcode = '23514';
    end if;
  elsif not exists (
    select 1 from public.attendance t
    where t.event_id = check_taught_at.event_id and t.member_id = check_taught_at.member_id and t.place = 'in'
  ) then
    raise exception 'That member was not at the event.' using errcode = '23514';
  end if;
end;
$$;

create function app.guard_lesson_pass() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  course public.qualifications%rowtype;
  target public.members%rowtype;
begin
  if app.is_trusted_context() then
    return new;
  end if;
  -- Refused first, so that nothing below can tell an outsider anything.
  if not app.has_role('instructor') then
    raise exception 'Only an instructor signs off a lesson.' using errcode = '42501';
  end if;
  if new.member_id = me and not app.has_role('admin') then
    raise exception 'Nobody signs off their own lesson.' using errcode = '42501';
  end if;
  select q.* into course from public.qualifications q join public.lessons l on l.qualification_id = q.id where l.id = new.lesson_id;
  if course.id is null then
    raise exception 'There is no such lesson.' using errcode = '23514';
  end if;
  select m.* into target from public.members m where m.id = new.member_id;
  if target.id is null or target.status not in ('recruit', 'auxiliary', 'member', 'reserve') then
    raise exception 'A lesson is signed off for a serving member.' using errcode = '23514';
  end if;
  if app.holds_qualification(new.member_id, course.id) then
    raise exception 'They already hold this qualification.' using errcode = '23514';
  end if;
  if course.requires_qualification_id is not null and not app.holds_qualification(new.member_id, course.requires_qualification_id) then
    raise exception 'They must hold % first.', (select q.name from public.qualifications q where q.id = course.requires_qualification_id) using errcode = '23514';
  end if;
  if new.event_id is not null then
    perform app.check_taught_at(new.event_id, new.member_id, course.id);
  end if;
  new.signed_by := me;
  new.signed_at := now();
  return new;
end;
$$;

create trigger lesson_passes_guard before insert on public.lesson_passes
  for each row execute function app.guard_lesson_pass();
create trigger lesson_passes_audit after insert or update or delete on public.lesson_passes
  for each row execute function app.audit();

-- An award that names an event is checked against it, as before, now by the
-- same check a sign-off uses.
create or replace function app.guard_award_at_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.event_id is null or app.is_trusted_context() then
    return new;
  end if;
  perform app.check_taught_at(new.event_id, new.member_id, new.qualification_id);
  return new;
end;
$$;

-- An award needs what the course requires held first, and every lesson of the
-- course passed. A commission is the commissioning board's decision, which
-- command records. All this is checked after the access rules have had their
-- say, so that someone who may not award at all is told that, and nothing
-- about the course.
create function app.check_award_course() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  course public.qualifications%rowtype;
begin
  if app.is_trusted_context() then
    return new;
  end if;
  select q.* into course from public.qualifications q where q.id = new.qualification_id;
  if course.code = 'commission' and not app.has_role('command') then
    raise exception 'The commissioning board commissions an officer, and command records its decision.' using errcode = '42501';
  end if;
  if course.requires_qualification_id is not null and not app.holds_qualification(new.member_id, course.requires_qualification_id) then
    raise exception 'They must hold % first.', (select q.name from public.qualifications q where q.id = course.requires_qualification_id) using errcode = '23514';
  end if;
  if exists (
    select 1 from public.lessons l
    where l.qualification_id = new.qualification_id
      and not exists (select 1 from public.lesson_passes p where p.lesson_id = l.id and p.member_id = new.member_id)
  ) then
    raise exception 'Every lesson of the course is signed off before the qualification is awarded.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger qualification_awards_need_course after insert on public.qualification_awards
  for each row execute function app.check_award_course();

-- Taking a qualification away takes the course's passes with it: the member
-- trains again. The SQL editor, putting right a mistake, is not held to this.
create function app.retrain_on_revoke() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if app.is_trusted_context() then
    return old;
  end if;
  delete from public.lesson_passes p
  using public.lessons l
  where l.id = p.lesson_id and l.qualification_id = old.qualification_id and p.member_id = old.member_id;
  return old;
end;
$$;

create trigger qualification_awards_retrain after delete on public.qualification_awards
  for each row execute function app.retrain_on_revoke();

-- ---------------------------------------------------------------------------
-- Where each member is in each course
-- ---------------------------------------------------------------------------

-- One line per member and course they have started: how many lessons are
-- passed, how many there are, whether that is all of them, and whether the
-- qualification is held. Read with the reader's own access to the passes, so
-- a member sees their own lines and instructors and staff see everyone's.
create view public.training_progress with (security_invoker = true) as
select
  p.member_id,
  l.qualification_id,
  count(*)::int as passed,
  (select count(*)::int from public.lessons x where x.qualification_id = l.qualification_id) as lessons,
  count(*) = (select count(*) from public.lessons x where x.qualification_id = l.qualification_id) as complete,
  exists (select 1 from public.qualification_awards a where a.member_id = p.member_id and a.qualification_id = l.qualification_id) as held,
  max(p.signed_at) as last_signed_at
from public.lesson_passes p
join public.lessons l on l.id = p.lesson_id
group by p.member_id, l.qualification_id;

-- ---------------------------------------------------------------------------
-- The syllabus, drafted from the doctrine for command to edit
-- ---------------------------------------------------------------------------

update public.qualifications q set requires_qualification_id = r.id
from (values
  ('radio-user', 'induction'),
  ('navy-crew', 'radio-user'),
  ('net-controller', 'radio-user'),
  ('instructor', 'radio-user'),
  ('commission', 'navy-crew')
) as v (code, requires)
join public.qualifications r on r.code = v.requires
where q.code = v.code;

insert into public.lessons (qualification_id, sort_order, name, description)
select q.id, v.n, v.name, v.description
from (values
  ('induction', 1, 'The fleet and its values', 'What the 9th Fleet is for, its six values, and being in character on duty only.'),
  ('induction', 2, 'Conduct and the chain of command', 'The conduct rules, command on duty only, and who gives orders to whom.'),
  ('induction', 3, 'How an operation runs', 'The calendar, replying to an event, muster, the roll, orders and the debrief.'),
  ('induction', 4, 'The voice app', 'Installed, a net joined, push-to-talk set and levels checked.'),
  ('induction', 5, 'Radio check', 'A radio check answered correctly on a net.'),
  ('radio-user', 1, 'Nets and callsigns', 'Which nets there are, who is on each, your callsign and who Zero is.'),
  ('radio-user', 2, 'Voice procedure', 'The fleet''s procedure: the pro-words, keeping it short, and when to speak.'),
  ('radio-user', 3, 'Sending a message', 'The form of a message, acknowledging, correcting and saying again.'),
  ('radio-user', 4, 'Contact and casualty reports', 'The set reports: contact, situation and casualty.'),
  ('radio-user', 5, 'Assessed radio exchange', 'A scripted exchange sent and received without error.'),
  ('navy-crew', 1, 'Ship stations and the watch bill', 'Where each station is, who holds it, and reporting ready.'),
  ('navy-crew', 2, 'Boarding, launch and recovery', 'Getting aboard, seating, and launching and recovering ships and vehicles.'),
  ('navy-crew', 3, 'Emergency drills', 'Fire, hull breach and abandon ship: the calls and the drills.'),
  ('navy-crew', 4, 'Turret basics', 'Manning a turret, reporting targets, and the weapons states.'),
  ('navy-crew', 5, 'Damage control basics', 'Repair tools, what to fix first, and reporting damage.'),
  ('navy-crew', 6, 'Assessed drill', 'An emergency drill run as a crew, assessed by an instructor.'),
  ('net-controller', 1, 'Controlling a net', 'Zero''s job: opening and closing the net and keeping order on it.'),
  ('net-controller', 2, 'The net log', 'What is logged, and how.'),
  ('net-controller', 3, 'Relays and handovers', 'Passing traffic between nets and handing over control.'),
  ('net-controller', 4, 'Assessed watch', 'A watch as Zero on a live net, assessed.'),
  ('instructor', 1, 'Teaching a lesson', 'The lesson plan: demonstrate, practise, check.'),
  ('instructor', 2, 'Running a training evolution', 'Drafting it, the roll, signing off, and the report.'),
  ('instructor', 3, 'Assessing and signing off', 'The standard, what a pass is, and withdrawing a mistake.'),
  ('instructor', 4, 'Observed lesson', 'A lesson taught under the observation of an instructor.'),
  ('commission', 1, 'Leading on duty', 'The leader''s job, giving orders, the chain, and stepping up.'),
  ('commission', 2, 'The orders process', 'The warning order, operation orders in five paragraphs, quick orders and the back-brief.'),
  ('commission', 3, 'Planning an operation', 'The plan, manning, the opposing force and approval.'),
  ('commission', 4, 'Commanding under supervision', 'Second-in-command, then operation commander, on assessed operations.'),
  ('commission', 5, 'The teamwork exercise', 'The cadets plan and run an evolution together.'),
  ('commission', 6, 'The commissioning board', 'Passed the board: the Commandant, a commander at O4 or above and a senior enlisted member. Command records the commission.')
) as v (code, n, name, description)
join public.qualifications q on q.code = v.code;

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant all on public.lessons, public.lesson_passes, public.training_progress to service_role;
grant select on public.training_progress to authenticated;

grant select on public.lessons to authenticated;
grant insert (qualification_id, sort_order, name, description) on public.lessons to authenticated;
-- A lesson keeps to its course: the passes on it are passes in that course.
grant update (sort_order, name, description) on public.lessons to authenticated;
grant delete on public.lessons to authenticated;

grant select on public.lesson_passes to authenticated;
grant insert (lesson_id, member_id, event_id) on public.lesson_passes to authenticated;
grant delete on public.lesson_passes to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.lessons enable row level security;
alter table public.lesson_passes enable row level security;

create policy "Command sets what a course requires" on public.qualifications
  for update to authenticated
  using ((select app.has_role('command'))) with check ((select app.has_role('command')));

create policy "The fleet reads the syllabus" on public.lessons
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Command adds lessons" on public.lessons
  for insert to authenticated with check ((select app.has_role('command')));
create policy "Command changes lessons" on public.lessons
  for update to authenticated
  using ((select app.has_role('command'))) with check ((select app.has_role('command')));
create policy "Command removes lessons" on public.lessons
  for delete to authenticated using ((select app.has_role('command')));

-- A member sees their own passes. Staff see everyone's, and instructors those
-- of the members they can see.
create policy "See your own passes, or everyone's as an instructor or staff" on public.lesson_passes
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or (select app.is_staff())
    or ((select app.has_role('instructor')) and exists (select 1 from public.members m where m.id = lesson_passes.member_id))
  );
create policy "Instructors sign off lessons" on public.lesson_passes
  for insert to authenticated with check ((select app.has_role('instructor')));
create policy "The instructor who signed a lesson off withdraws it, until the award" on public.lesson_passes
  for delete to authenticated
  using (
    signed_by = (select auth.uid())
    and not exists (
      select 1 from public.qualification_awards a
      join public.lessons l on l.id = lesson_passes.lesson_id
      where a.member_id = lesson_passes.member_id and a.qualification_id = l.qualification_id
    )
  );
