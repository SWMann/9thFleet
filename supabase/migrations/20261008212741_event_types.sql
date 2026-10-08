-- Event types: what kind of night an event is, kept as records an admin edits.
--
-- The five types were a fixed list in the database. They are now rows of a
-- table, so the Fleet Commander can add his own and say, for each: who may
-- draft it, how long it usually runs, its usual weapons state, and what its
-- five order sections are called.
--
-- An event still holds its type in the column `kind`, now as the type's key.
--
-- Two more things an event can do:
--   it can be copied into a new draft, with its orders;
--   it can repeat weekly, so that closing it drafts next week's.
--
-- The old fixed list (the type public.event_kind) and the helper that used it
-- are left in place, unused. Removing them is a deletion, which the database's
-- owner confirms, so that is done separately.

-- ---------------------------------------------------------------------------
-- Event types
-- ---------------------------------------------------------------------------

create table public.event_types (
  id uuid primary key default gen_random_uuid(),
  -- The short name an event holds, so a type can be renamed without touching its events.
  key text not null unique check (key ~ '^[a-z0-9]+([_-][a-z0-9]+)*$' and char_length(key) <= 40),
  name text not null unique check (char_length(name) between 2 and 60),
  -- Who usually runs one, and an example, shown to whoever drafts it.
  run_by text not null default '' check (char_length(run_by) <= 80),
  example text not null default '' check (char_length(example) <= 200),
  -- Command drafts every type. This lets instructors draft this one too.
  instructors_may_draft boolean not null default false,
  default_duration_minutes smallint not null default 120 check (default_duration_minutes between 15 and 480),
  default_weapons_state public.weapons_state,
  -- What this type calls each of the five order sections, and what each holds.
  -- Left empty, a section keeps the name and the guidance in Volume 2.
  situation_name text not null default '' check (char_length(situation_name) <= 60),
  situation_holds text not null default '' check (char_length(situation_holds) <= 300),
  mission_name text not null default '' check (char_length(mission_name) <= 60),
  mission_holds text not null default '' check (char_length(mission_holds) <= 300),
  execution_name text not null default '' check (char_length(execution_name) <= 60),
  execution_holds text not null default '' check (char_length(execution_holds) <= 300),
  support_name text not null default '' check (char_length(support_name) <= 60),
  support_holds text not null default '' check (char_length(support_holds) <= 300),
  command_and_signal_name text not null default '' check (char_length(command_and_signal_name) <= 60),
  command_and_signal_holds text not null default '' check (char_length(command_and_signal_holds) <= 300),
  sort_order integer not null default 0
);

-- The roadmap's five types, as they were.
insert into public.event_types (key, name, run_by, example, instructors_may_draft, sort_order) values
  ('training', 'Training evolution', 'Training team', 'Ship emergency drills, turret gunnery, launch and recovery', true, 1),
  ('patrol', 'Patrol', 'Duty commander', 'Presence patrol of a Stanton sector, reporting contacts', false, 2),
  ('response', 'Response', 'Duty commander', 'Answering a piracy report from the public request line', false, 3),
  ('strike', 'Strike', 'Command', 'Planned action against a declared hostile org or a known pirate spot', false, 4),
  ('tasked_pve', 'Tasked PvE', 'Duty commander', 'In-game contracts given a tasking, when no hostile shows', false, 5);

-- ---------------------------------------------------------------------------
-- An event's type is a row of that table
-- ---------------------------------------------------------------------------

-- The rule on drafting names the column, so it steps aside while the column
-- changes and comes back below. All of this is one transaction.
alter policy "Command drafts any event, and instructors draft training" on public.events
  with check (state = 'draft');

alter table public.events alter column kind type text using kind::text;
alter table public.events
  add constraint events_kind_fkey foreign key (kind) references public.event_types (key) on update cascade on delete restrict;

-- Command drafts any type. An instructor drafts the types that are open to instructors.
create function app.may_draft(wanted text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_role('command') or (
    app.has_role('instructor')
    and exists (select 1 from public.event_types t where t.key = wanted and t.instructors_may_draft)
  );
$$;

alter policy "Command drafts any event, and instructors draft training" on public.events
  with check ((select app.may_draft(kind)) and state = 'draft');
alter policy "Command drafts any event, and instructors draft training" on public.events
  rename to "Command drafts any event, and instructors the types open to them";

-- ---------------------------------------------------------------------------
-- Copies and repeats
-- ---------------------------------------------------------------------------

alter table public.events
  add column copied_from uuid references public.events (id) on delete set null,
  -- Closing a weekly event drafts next week's.
  add column repeats_weekly boolean not null default false;

-- The event rule, as it was, with three changes: the type check uses the
-- table, an event can only be copied by someone who can read it, and what an
-- event was copied from cannot be changed afterwards.
create or replace function app.guard_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  named uuid;
begin
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.created_at is distinct from old.created_at) then
    raise exception 'An event cannot be moved or re-dated.' using errcode = '42501';
  end if;

  if not app.is_trusted_context() then
    if tg_op = 'INSERT' then
      if new.state <> 'draft' then
        raise exception 'An event starts as a draft.' using errcode = '23514';
      end if;
      new.created_by := (select auth.uid());
      new.created_at := now();
      new.announced_at := null;
      -- An event can only be copied by someone who can read it.
      if new.copied_from is not null and not exists (
        select 1 from public.events e
        where e.id = new.copied_from
          and (e.state <> 'draft' or e.created_by = (select auth.uid())
               or (select auth.uid()) in (e.commander_id, e.second_id) or app.has_role('command'))
      ) then
        raise exception 'You cannot copy that event.' using errcode = '42501';
      end if;
    else
      new.created_by := old.created_by;
      new.announced_at := old.announced_at;
      -- What an event was copied from is fixed. Only the database clears it,
      -- when the event it points at is deleted.
      if new.copied_from is not null then
        new.copied_from := old.copied_from;
      end if;
      if old.state in ('done', 'cancelled') then
        raise exception 'This event is closed.' using errcode = '23514';
      end if;
      if new.kind is distinct from old.kind and not app.may_draft(new.kind) then
        raise exception 'You cannot turn this into that type of event.' using errcode = '42501';
      end if;
      if new.commander_id is distinct from old.commander_id
         and not app.has_role('command')
         and not (old.state = 'draft' and old.created_by = (select auth.uid())) then
        raise exception 'Only command names a different operation commander.' using errcode = '42501';
      end if;
      if old.state = 'announced' and new.starts_at is distinct from old.starts_at and old.starts_at <= now() then
        raise exception 'The event has started, so its time cannot change.' using errcode = '23514';
      end if;

      if new.state is distinct from old.state then
        if old.state = 'draft' and new.state = 'announced' then
          if new.starts_at <= now() then
            raise exception 'An event is announced before it starts.' using errcode = '23514';
          end if;
          new.announced_at := now();
        elsif new.state = 'cancelled' then
          null;
        elsif old.state = 'announced' and new.state = 'done' then
          if now() < new.starts_at then
            raise exception 'An event is closed once it has started.' using errcode = '23514';
          end if;
        else
          raise exception 'An event goes from draft to announced to done, or is cancelled.' using errcode = '23514';
        end if;
      end if;
    end if;

    if new.commander_id is null then
      raise exception 'An event needs an operation commander.' using errcode = '23514';
    end if;
    foreach named in array array[new.commander_id, new.second_id, new.observer_id] loop
      if named is not null and not app.is_serving_member(named) then
        raise exception 'The commander, second-in-command and observer must be serving members.'
          using errcode = '23514';
      end if;
    end loop;
  end if;

  -- An event announced from the SQL editor is stamped too, so its roll always has a closing time.
  if new.state = 'announced' and new.announced_at is null then
    new.announced_at := now();
  end if;
  new.updated_at := now();
  new.roll_closes_at := case
    when new.announced_at is null then null
    when new.announced_at > new.starts_at - interval '24 hours' then new.starts_at
    else new.starts_at - interval '24 hours'
  end;
  return new;
end;
$$;

-- Every event has one row of orders from the moment it is drafted. A copy
-- starts with the orders of the event it was copied from.
create or replace function app.make_event_orders() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.event_orders
    (event_id, updated_by, warning_order, situation, mission, execution, support, command_and_signal)
  select new.id, new.created_by,
         coalesce(o.warning_order, ''), coalesce(o.situation, ''), coalesce(o.mission, ''),
         coalesce(o.execution, ''), coalesce(o.support, ''), coalesce(o.command_and_signal, '')
  from (select 1) as one
  left join public.event_orders o on o.event_id = new.copied_from;
  return new;
end;
$$;

-- The title of the event that follows this one: a number at its end goes up by
-- one, so Training Night 007 is followed by Training Night 008. A title with no
-- number at its end is kept.
create function app.next_title(title text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when parts.digits is null then title
    when char_length(parts.stem || parts.following) > 80 then title
    else parts.stem || parts.following
  end
  from (
    select found.digits,
           regexp_replace(title, '[0-9]{1,9}$', '') as stem,
           lpad((found.digits::bigint + 1)::text,
                greatest(char_length(found.digits), char_length((found.digits::bigint + 1)::text)), '0') as following
    from (select substring(title from '[0-9]{1,9}$') as digits) found
  ) parts;
$$;

-- A weekly event that took place, or was cancelled after it was announced,
-- leaves a draft for the same time next week. Whoever closed it drafted it, so
-- they can see it. It is never announced by itself.
create function app.draft_next_week() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  next_start timestamptz := new.starts_at + interval '7 days';
  closer uuid := (select auth.uid());
begin
  if not new.repeats_weekly or old.state <> 'announced' or new.state not in ('done', 'cancelled') then
    return new;
  end if;
  -- Once only, and not if someone has already drafted next week's by hand.
  if exists (select 1 from public.events e where e.copied_from = new.id and e.repeats_weekly) then
    return new;
  end if;
  while next_start <= now() loop
    next_start := next_start + interval '7 days';
  end loop;

  -- Closing the event matters more than drafting the next, so a fault here is
  -- reported and the close goes through.
  begin
    insert into public.events
      (kind, title, summary, starts_at, duration_minutes, commander_id, second_id, observer_id,
       weapons_state, pve_fallback, repeats_weekly, copied_from, created_by)
    values
      (new.kind, app.next_title(new.title), new.summary, next_start, new.duration_minutes,
       case when app.is_serving_member(new.commander_id) then new.commander_id else closer end,
       case when app.is_serving_member(new.second_id) then new.second_id end,
       case when app.is_serving_member(new.observer_id) then new.observer_id end,
       new.weapons_state, new.pve_fallback, true, new.id, coalesce(closer, new.created_by));
  exception when others then
    raise warning 'Next week''s event was not drafted: %', sqlerrm;
  end;
  return new;
end;
$$;

create trigger events_repeat after update of state on public.events
  for each row execute function app.draft_next_week();

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create trigger event_types_audit after insert or update or delete on public.event_types
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant execute on function app.may_draft(text) to authenticated, service_role;
-- The helper for the old fixed list is no longer used by any rule.
revoke execute on function app.may_create_event(public.event_kind) from authenticated, service_role;

grant all on public.event_types to service_role;
grant select on public.event_types to authenticated;
-- Only an admin's rule lets these through.
grant insert, update, delete on public.event_types to authenticated;

grant insert (copied_from, repeats_weekly) on public.events to authenticated;
grant update (repeats_weekly) on public.events to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.event_types enable row level security;

create policy "The fleet reads the event types" on public.event_types
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Admins add event types" on public.event_types
  for insert to authenticated with check ((select app.has_role('admin')));
create policy "Admins change event types" on public.event_types
  for update to authenticated
  using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
create policy "Admins remove event types" on public.event_types
  for delete to authenticated using ((select app.has_role('admin')));
