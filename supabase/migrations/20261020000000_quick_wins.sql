-- Four small things
--
--   1. A calendar feed. Each serving member has a private feed address, which
--      a calendar app reads without signing in, so the address carries its own
--      key. The member makes a new key whenever they like, and the old one
--      stops working.
--   2. Monthly returns. On the first of each month the database records the
--      month just ended: strength by status, who joined and left, hulls
--      registered and ready, events held and attendances. Volume 2 asks for a
--      monthly strength return and a readiness return; this is where they are
--      kept. Months before this existed are worked out from the record.
--   3. Secondary duties have three-month terms. Command renews a duty in place,
--      and the term runs on from that day.
--   4. The lessons log needs nothing new here: it gathers what each after-action
--      report says to keep and to change.

-- ---------------------------------------------------------------------------
-- The calendar feed
-- ---------------------------------------------------------------------------

create table public.calendar_keys (
  member_id uuid primary key references public.members (id) on delete cascade,
  -- Two random ids, run together: long enough that nobody guesses one.
  key text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  made_at timestamptz not null default now()
);

-- A member's own key, made by the database. Any change to the line makes a
-- new key.
create function app.guard_calendar_key() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if app.is_trusted_context() then
    return new;
  end if;
  if not app.is_serving() then
    raise exception 'The calendar feed is for the serving fleet.' using errcode = '42501';
  end if;
  new.member_id := case when tg_op = 'INSERT' then (select auth.uid()) else old.member_id end;
  new.key := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  new.made_at := now();
  return new;
end;
$$;

create trigger calendar_keys_guard before insert or update on public.calendar_keys
  for each row execute function app.guard_calendar_key();

-- What a feed holds: the events its key's owner can see, with their own reply.
-- The key comes in a request header, since a calendar app has no session. The
-- view reads as the database itself and lets through only the rows the key
-- earns: nothing without a key, and nothing for a key whose owner has left.
create view public.calendar_feed as
select
  e.id,
  e.title,
  e.kind,
  t.name as kind_name,
  e.starts_at,
  e.duration_minutes,
  e.muster_at,
  e.state,
  e.roll_closes_at,
  e.updated_at,
  a.reply
from public.calendar_keys k
join public.members m on m.id = k.member_id and m.status in ('recruit', 'auxiliary', 'member', 'reserve')
join public.events e on e.announced_at is not null and e.state in ('announced', 'done', 'cancelled')
join public.event_types t on t.key = e.kind
left join public.attendance a on a.event_id = e.id and a.member_id = k.member_id
where k.key = (nullif(current_setting('request.headers', true), '')::json ->> 'x-feed-key')
  and e.starts_at > now() - interval '90 days';

-- ---------------------------------------------------------------------------
-- Monthly returns
-- ---------------------------------------------------------------------------

create table public.fleet_returns (
  -- The first day of the month the return is for.
  month date primary key check (month = date_trunc('month', month)::date),
  recorded_at timestamptz not null default now(),
  -- Strength at the end of the month, by status.
  serving integer not null,
  members integer not null,
  auxiliaries integer not null,
  recruits integer not null,
  reserve integer not null,
  -- Who came in and who left during the month.
  joined integer not null,
  departed integer not null,
  -- The register at the end of the month. Empty for months before it was kept.
  hulls integer,
  hulls_ready integer,
  -- What was done in the month.
  events_held integer not null,
  attendances integer not null
);

-- The return for one month: the month given, or the month just ended. Run
-- again, it writes the month afresh, keeping a register figure it had and
-- the new one lacks.
create function app.record_monthly_return(target date default null) returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC'
as $$
declare
  today date := current_date;
  -- The month just ended is the one before this, whatever day of this month it is.
  last_month date := date_trunc('month', today - interval '1 month')::date;
  m date := date_trunc('month', coalesce(target, last_month))::date;
  last_day date := (m + interval '1 month' - interval '1 day')::date;
  -- The register has no history, so its figures are taken now, and only for the month just ended.
  register_now boolean := m = last_month;
  strength record;
  movement record;
  doing record;
  hull_count integer;
  ready_count integer;
begin
  with latest as (
    select distinct on (c.member_id) c.member_id, c.status
    from public.member_status_changes c
    join public.members mm on mm.id = c.member_id
    where c.changed_on <= last_day
    order by c.member_id, c.changed_on desc, c.id desc
  )
  select
    count(*) filter (where status in ('recruit', 'auxiliary', 'member', 'reserve'))::integer as serving,
    count(*) filter (where status = 'member')::integer as members,
    count(*) filter (where status = 'auxiliary')::integer as auxiliaries,
    count(*) filter (where status = 'recruit')::integer as recruits,
    count(*) filter (where status = 'reserve')::integer as reserve
  into strength
  from latest;

  -- Joined: came into the serving fleet, from applicant or from outside. Departed: left it.
  with lines as (
    select c.status, c.changed_on,
           lag(c.status) over (partition by c.member_id order by c.changed_on, c.id) as before
    from public.member_status_changes c
  )
  select
    count(*) filter (where status in ('recruit', 'auxiliary', 'member', 'reserve') and (before is null or before not in ('recruit', 'auxiliary', 'member', 'reserve')))::integer as joined,
    count(*) filter (where status not in ('recruit', 'auxiliary', 'member', 'reserve') and before in ('recruit', 'auxiliary', 'member', 'reserve'))::integer as departed
  into movement
  from lines
  where changed_on between m and last_day;

  select
    count(distinct e.id)::integer as events_held,
    count(r.event_id) filter (where r.returned = 'present')::integer as attendances
  into doing
  from public.events e
  left join public.attendance_returns r on r.event_id = e.id
  where e.state = 'done' and e.starts_at >= m and e.starts_at < m + interval '1 month';

  if register_now then
    select count(*)::integer, count(*) filter (where s.ready)::integer into hull_count, ready_count
    from public.ships s
    left join public.members o on o.id = s.owner_id
    where s.owner_id is null or o.status in ('recruit', 'auxiliary', 'member', 'reserve');
  end if;

  insert into public.fleet_returns (month, serving, members, auxiliaries, recruits, reserve, joined, departed, hulls, hulls_ready, events_held, attendances)
  values (m, strength.serving, strength.members, strength.auxiliaries, strength.recruits, strength.reserve,
          movement.joined, movement.departed, hull_count, ready_count, doing.events_held, doing.attendances)
  on conflict (month) do update set
    recorded_at = now(),
    serving = excluded.serving,
    members = excluded.members,
    auxiliaries = excluded.auxiliaries,
    recruits = excluded.recruits,
    reserve = excluded.reserve,
    joined = excluded.joined,
    departed = excluded.departed,
    hulls = coalesce(excluded.hulls, public.fleet_returns.hulls),
    hulls_ready = coalesce(excluded.hulls_ready, public.fleet_returns.hulls_ready),
    events_held = excluded.events_held,
    attendances = excluded.attendances;
end;
$$;

-- The months before today, from the record.
do $$
declare
  first_month date;
  m date;
begin
  select date_trunc('month', min(changed_on))::date into first_month from public.member_status_changes;
  if first_month is not null then
    m := first_month;
    while m < date_trunc('month', (now() at time zone 'utc')::date)::date loop
      perform app.record_monthly_return(m);
      m := (m + interval '1 month')::date;
    end loop;
  end if;
end;
$$;

-- The database writes the return itself at five past midnight UTC on the first
-- of each month, where the scheduler is installed. It is on the fleet's own
-- database; the test copy has no scheduler, and skips this.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    grant usage on schema cron to postgres;
    perform cron.unschedule(jobid) from cron.job where jobname = 'monthly-return';
    perform cron.schedule('monthly-return', '5 0 1 * *', 'select app.record_monthly_return()');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Secondary duties have terms
-- ---------------------------------------------------------------------------

-- The day a duty was last renewed. Its term runs three months from this day,
-- or from the day it began.
alter table public.assignments
  add column renewed_on date check (renewed_on is null or renewed_on >= started_on);

-- Command renews a duty, in place, on the day. A post is held until it is
-- left, so it is not renewed.
create function app.check_duty_term() returns trigger
language plpgsql security definer set search_path = '' set timezone = 'UTC'
as $$
begin
  if new.renewed_on is distinct from old.renewed_on and not app.is_trusted_context() then
    if new.kind <> 'duty' then
      raise exception 'Only a secondary duty is renewed. A post is held until it is left.' using errcode = '23514';
    end if;
    if new.renewed_on is null or new.renewed_on <> current_date then
      raise exception 'A duty is renewed on the day it is renewed.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger assignments_duty_term before update of renewed_on on public.assignments
  for each row execute function app.check_duty_term();

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant all on public.calendar_keys, public.fleet_returns to service_role;
grant select on public.calendar_feed to service_role;

grant select on public.calendar_keys to authenticated;
grant insert (member_id) on public.calendar_keys to authenticated;
grant update (made_at) on public.calendar_keys to authenticated;
grant delete on public.calendar_keys to authenticated;

-- The feed is read by a calendar app, which is nobody in particular. The view
-- itself decides what a key earns.
grant select on public.calendar_feed to anon, authenticated;

grant select on public.fleet_returns to authenticated;

grant select (renewed_on) on public.assignments to authenticated;
grant update (renewed_on) on public.assignments to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.calendar_keys enable row level security;
alter table public.fleet_returns enable row level security;

create policy "A member reads their own feed key" on public.calendar_keys
  for select to authenticated using (member_id = (select auth.uid()));
create policy "A serving member makes a feed key" on public.calendar_keys
  for insert to authenticated with check ((select app.is_serving()));
create policy "A member makes themselves a new feed key" on public.calendar_keys
  for update to authenticated
  using (member_id = (select auth.uid())) with check (member_id = (select auth.uid()));
create policy "A member removes their feed key" on public.calendar_keys
  for delete to authenticated using (member_id = (select auth.uid()));

create policy "Command reads the monthly returns" on public.fleet_returns
  for select to authenticated using ((select app.has_role('command')));
