-- The service record
--
-- A member's record is the posts they have held, the events they were at and
-- the days their standing changed. The posts and the events were already kept.
-- This adds the two things that were not:
--
--   the day a member's status changed: recruit, auxiliary, full member, reserve;
--   the day their grade changed inside a post, which is a promotion.
--
-- The database writes both as the change is made. Nobody writes them through
-- the API, and nobody can change them afterwards.
--
-- It also closes a gap. A serving member could read every post anyone had ever
-- held. They now read other people's posts only while those posts are held,
-- which is all the order of battle needs. The history is for the member
-- themselves and for staff.

-- ---------------------------------------------------------------------------
-- When a member's status changed
-- ---------------------------------------------------------------------------

create table public.member_status_changes (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.members (id) on delete cascade,
  status public.member_status not null,
  changed_on date not null default current_date,
  -- Who made the change. Nobody, for the day the member first signed in.
  changed_by uuid references public.members (id) on delete set null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index member_status_changes_member_idx on public.member_status_changes (member_id, changed_on, id);

create function app.record_member_status() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.member_status_changes (member_id, status, changed_by)
    values (new.id, new.status, (select m.id from public.members m where m.id = (select auth.uid())));
  end if;
  return new;
end;
$$;

create trigger members_status_recorded after insert or update of status on public.members
  for each row execute function app.record_member_status();

-- ---------------------------------------------------------------------------
-- When a member's grade changed
-- ---------------------------------------------------------------------------

-- One line for the grade a post was taken up at, and one for each change to
-- the grade, or to whether it is acting, while the post is held.
create table public.assignment_grades (
  id bigint generated always as identity primary key,
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  grade_code text not null references public.grades (code),
  acting boolean not null,
  since date not null default current_date,
  set_by uuid references public.members (id) on delete set null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index assignment_grades_member_idx on public.assignment_grades (member_id, since, id);
create index assignment_grades_assignment_idx on public.assignment_grades (assignment_id);

create function app.record_assignment_grade() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- A duty carries no grade.
  if new.kind <> 'primary' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into public.assignment_grades (assignment_id, member_id, grade_code, acting, since, set_by)
    values (new.id, new.member_id, new.grade_code, new.acting, new.started_on, new.appointed_by);
  elsif new.grade_code is distinct from old.grade_code or new.acting is distinct from old.acting then
    insert into public.assignment_grades (assignment_id, member_id, grade_code, acting, set_by)
    values (new.id, new.member_id, new.grade_code, new.acting,
            (select m.id from public.members m where m.id = (select auth.uid())));
  end if;
  return new;
end;
$$;

create trigger assignments_grade_recorded after insert or update of grade_code, acting on public.assignments
  for each row execute function app.record_assignment_grade();

-- ---------------------------------------------------------------------------
-- What happened before today, from the audit log
-- ---------------------------------------------------------------------------

insert into public.member_status_changes (member_id, status, changed_on, changed_by, recorded_at)
select
  m.id,
  (l.new_row ->> 'status')::public.member_status,
  (l.at at time zone 'utc')::date,
  (select a.id from public.members a where a.id = l.actor),
  l.at
from public.audit_log l
join public.members m on m.id = l.subject
where l.table_name = 'members'
  and l.new_row ->> 'status' is not null
  and (
    l.action = 'insert'
    or (l.action = 'update' and l.old_row ->> 'status' is distinct from l.new_row ->> 'status')
  )
order by l.at, l.id;

-- Anyone the log does not cover starts from the day they first signed in.
insert into public.member_status_changes (member_id, status, changed_on)
select m.id, m.status, m.joined_on
from public.members m
where not exists (select 1 from public.member_status_changes c where c.member_id = m.id);

insert into public.assignment_grades (assignment_id, member_id, grade_code, acting, since, set_by, recorded_at)
select
  a.id,
  a.member_id,
  l.new_row ->> 'grade_code',
  (l.new_row ->> 'acting')::boolean,
  case when l.action = 'insert' then a.started_on else (l.at at time zone 'utc')::date end,
  (select m.id from public.members m
   where m.id = case when l.action = 'insert' then a.appointed_by else l.actor end),
  l.at
from public.audit_log l
join public.assignments a on a.id = (l.new_row ->> 'id')::uuid
where l.table_name = 'assignments'
  and a.kind = 'primary'
  and l.new_row ->> 'grade_code' is not null
  and (
    l.action = 'insert'
    or (
      l.action = 'update'
      and (
        l.old_row ->> 'grade_code' is distinct from l.new_row ->> 'grade_code'
        or l.old_row ->> 'acting' is distinct from l.new_row ->> 'acting'
      )
    )
  )
order by l.at, l.id;

insert into public.assignment_grades (assignment_id, member_id, grade_code, acting, since, set_by)
select a.id, a.member_id, a.grade_code, a.acting, a.started_on, a.appointed_by
from public.assignments a
where a.kind = 'primary'
  and not exists (select 1 from public.assignment_grades g where g.assignment_id = a.id);

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant all on public.member_status_changes, public.assignment_grades to service_role;
grant select on public.member_status_changes, public.assignment_grades to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.member_status_changes enable row level security;
alter table public.assignment_grades enable row level security;

create policy "See when your own status changed, or anyone's as staff" on public.member_status_changes
  for select to authenticated
  using (member_id = (select auth.uid()) or (select app.is_staff()));

create policy "See your own grades in post, or anyone's as staff" on public.assignment_grades
  for select to authenticated
  using (member_id = (select auth.uid()) or (select app.is_staff()));

-- A post someone else held and has left is part of their record, not of the
-- order of battle.
alter policy "See your own assignments, or the fleet's if you serve" on public.assignments
  rename to "See your own posts, anyone's as staff, or who holds a post now";
alter policy "See your own posts, anyone's as staff, or who holds a post now" on public.assignments
  using (
    member_id = (select auth.uid())
    or (select app.is_staff())
    or (
      (select app.is_serving())
      and ended_on is null
      and exists (select 1 from public.members m where m.id = assignments.member_id)
    )
  );
