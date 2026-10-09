-- A task for each unit, and who may read it.
--
-- An event's orders give each unit taking part a task. A task is read by
-- everyone, by the unit, by the unit's leaders, or by its commander alone.
-- The commanders of the units above always read it, and so do command and
-- whoever writes the event's orders. Everyone else is shown that the unit has
-- a task, and none of its words. A unit's commander can pass a task down
-- inside the unit. Once the event is closed, every task is open to all who
-- can read the event.
--
-- To know who that is, the order of battle now says which post commands each
-- unit, and which posts lead.

-- ---------------------------------------------------------------------------
-- Who commands a unit, and who leads in it
-- ---------------------------------------------------------------------------

alter table public.units
  -- The post that commands this unit. It may sit in a unit under it, as a ship's commanding officer sits on the bridge.
  add column commander_position_id uuid references public.positions (id) on delete set null;

alter table public.positions
  -- A leader in its unit, on top of whoever commands a unit.
  add column is_leader boolean not null default false;

-- A starting point from the grades, for an admin to correct: officers and
-- senior non-commissioned posts lead.
update public.positions p
set is_leader = true
where p.kind = 'primary'
  and exists (
    select 1 from public.grades g
    where g.code = p.nominal_grade and (g.band = 'officer' or (g.band = 'nco' and g.sort_order >= 6))
  );

-- A starting point for who commands: the most senior post in the unit or
-- under it, where there is one of a leader's grade.
with recursive tree as (
  select u.id as root, u.id from public.units u
  union all
  select t.root, u.id from tree t join public.units u on u.parent_id = t.id
),
ranked as (
  select t.root, p.id as position_id, g.sort_order as grade,
         row_number() over (
           partition by t.root
           order by g.sort_order desc, (p.unit_id = t.root) desc, p.sort_order, p.title
         ) as place
  from tree t
  join public.positions p on p.unit_id = t.id and p.kind = 'primary'
  join public.grades g on g.code = p.nominal_grade
)
update public.units u
set commander_position_id = r.position_id
from ranked r
where r.root = u.id and r.place = 1 and r.grade >= 4;

-- The task force at launch is commanded from Fleet Command.
update public.units u
set commander_position_id = p.id
from public.positions p
join public.units fc on fc.id = p.unit_id
where u.name = 'Task Force Jericho' and fc.name = 'Fleet Command' and p.title = 'Fleet Commander';

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

create type public.task_level as enum ('everyone', 'unit', 'leaders', 'commander');

-- A unit's task for an event. Its words are kept here for whoever writes
-- them, and nobody reads them from here: the column cannot be selected. They
-- are read from the table below, a row at a time, by those the level allows.
create table public.event_unit_tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  unit_id uuid not null references public.units (id) on delete cascade,
  callsign text not null default '' check (char_length(callsign) <= 40),
  level public.task_level not null default 'unit',
  body text not null check (char_length(body) between 1 and 2000),
  set_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint event_unit_tasks_callsign_tidy check (callsign !~ '(^\s|\s$)'),
  unique (event_id, unit_id)
);
create index event_unit_tasks_unit_idx on public.event_unit_tasks (unit_id);

-- The words of each task, kept in step by the database.
create table public.event_unit_task_texts (
  task_id uuid primary key references public.event_unit_tasks (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  body text not null
);
create index event_unit_task_texts_event_idx on public.event_unit_task_texts (event_id);

-- ---------------------------------------------------------------------------
-- Who is where, for an event
-- ---------------------------------------------------------------------------

-- A unit and every unit under it.
create function app.unit_and_below(target uuid) returns setof uuid
language sql stable security definer set search_path = ''
as $$
  with recursive below as (
    select u.id from public.units u where u.id = target
    union
    select u.id from public.units u join below b on u.parent_id = b.id
  )
  select id from below;
$$;

-- A unit and every unit above it.
create function app.unit_and_above(target uuid) returns setof uuid
language sql stable security definer set search_path = ''
as $$
  with recursive above as (
    select u.id, u.parent_id from public.units u where u.id = target
    union
    select u.id, u.parent_id from public.units u join above a on u.id = a.parent_id
  )
  select id from above;
$$;

-- Whether a unit takes part in an event: it is named, or a unit above it is.
-- With no unit named, every unit takes part.
create function app.event_includes_unit(event uuid, target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (select 1 from public.event_units eu where eu.event_id = event)
    or exists (
      select 1 from public.event_units eu
      where eu.event_id = event and eu.unit_id in (select app.unit_and_above(target))
    );
$$;

-- Whether the person asking fills a post for an event: they hold it, or they
-- stand in for it on the night.
create function app.fills_post(event uuid, post uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select post is not null and (
    exists (
      select 1 from public.assignments a
      where a.position_id = post and a.member_id = (select auth.uid()) and a.ended_on is null
    )
    or exists (
      select 1 from public.attendance t
      where t.event_id = event and t.member_id = (select auth.uid())
        and t.stand_in_position_id = post and t.reply = 'attending'
    )
  );
$$;

-- Whether the person asking commands a unit for an event.
create function app.commands_unit(event uuid, target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_serving() and app.fills_post(event, (select u.commander_position_id from public.units u where u.id = target));
$$;

-- Whether the person asking leads in a unit for an event: they command it or
-- a unit under it, or they fill a post in it that is marked as a leader's.
create function app.leads_unit(event uuid, target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.commands_unit(event, target) or exists (
    select 1 from public.positions p
    where p.unit_id in (select app.unit_and_below(target))
      and (
        p.is_leader
        or exists (
          select 1 from public.units u
          where u.commander_position_id = p.id and u.id in (select app.unit_and_below(target))
        )
      )
      and app.fills_post(event, p.id)
  );
$$;

-- Whether the person asking is in a unit for an event: they fill a post in it or under it.
create function app.in_unit(event uuid, target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.positions p
    where p.unit_id in (select app.unit_and_below(target)) and app.fills_post(event, p.id)
  );
$$;

-- Whether the person asking commands a unit above this one, for an event.
create function app.commands_above(event uuid, target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from app.unit_and_above(target) as above (id)
    where above.id <> target and app.commands_unit(event, above.id)
  );
$$;

-- Whether the person asking may read a task's words.
--
-- Someone on the event's opposing force reads only what everyone reads, even
-- if they hold a post in the unit: for this event they are on the other side.
create function app.reads_unit_task(target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_serving() and exists (
    select 1
    from public.event_unit_tasks t
    join public.events e on e.id = t.event_id
    where t.id = target
      and (
        t.level = 'everyone'
        or e.state in ('done', 'cancelled')
        or app.edits_event(e.id)
        or (
          not app.on_opfor(e.id)
          and (
            app.commands_unit(e.id, t.unit_id)
            or app.commands_above(e.id, t.unit_id)
            or (t.level in ('unit', 'leaders') and app.leads_unit(e.id, t.unit_id))
            or (t.level = 'unit' and app.in_unit(e.id, t.unit_id))
          )
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- A task is fixed with its event when the event closes. It is for a unit that
-- takes part. Whoever writes the event's orders writes it and says who reads
-- it. The unit's commander may pass it down inside the unit, and change
-- nothing else.
create function app.guard_unit_task() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  target uuid := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
begin
  if tg_op = 'UPDATE' and (new.event_id is distinct from old.event_id or new.unit_id is distinct from old.unit_id) then
    raise exception 'A task cannot be moved to another event or another unit.' using errcode = '42501';
  end if;
  -- What goes with an event that is removed, and what a copy brings, is the database's own doing.
  if app.is_trusted_context() or pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if exists (select 1 from public.events e where e.id = target and e.state in ('done', 'cancelled')) then
    raise exception 'This event is closed.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'INSERT' then
    if not app.event_includes_unit(new.event_id, new.unit_id) then
      raise exception 'That unit is not taking part in this event.' using errcode = '23514';
    end if;
  elsif not app.edits_event(new.event_id) then
    if new.body is distinct from old.body or new.callsign is distinct from old.callsign then
      raise exception 'Only whoever writes the event''s orders changes a task.' using errcode = '42501';
    end if;
    if not (
      (old.level = 'commander' and new.level in ('leaders', 'unit'))
      or (old.level = 'leaders' and new.level = 'unit')
    ) then
      raise exception 'A unit''s commander can only pass its task down inside the unit.' using errcode = '42501';
    end if;
  end if;

  new.set_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;

create trigger event_unit_tasks_guard before insert or update or delete on public.event_unit_tasks
  for each row execute function app.guard_unit_task();

-- The words go to the table they are read from.
create function app.keep_task_text() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.event_unit_task_texts (task_id, event_id, body)
  values (new.id, new.event_id, new.body)
  on conflict (task_id) do update set body = excluded.body;
  return new;
end;
$$;

create trigger event_unit_tasks_text after insert or update of body on public.event_unit_tasks
  for each row execute function app.keep_task_text();

-- A copy brings the tasks the person copying may read. One they may not read stays behind.
create or replace function app.copy_event_parts() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.copied_from is null then
    return new;
  end if;
  insert into public.event_units (event_id, unit_id)
    select new.id, unit_id from public.event_units where event_id = new.copied_from;
  insert into public.event_key_posts (event_id, position_id)
    select new.id, position_id from public.event_key_posts where event_id = new.copied_from;
  insert into public.event_posts (event_id, title, role_id, must_fill, open_to_volunteers, sort_order)
    select new.id, title, role_id, must_fill, open_to_volunteers, sort_order
    from public.event_posts where event_id = new.copied_from;
  insert into public.event_objectives (event_id, title, sort_order)
    select new.id, title, sort_order from public.event_objectives where event_id = new.copied_from;
  insert into public.event_elements (event_id, name, callsign, task, sort_order)
    select new.id, name, callsign, task, sort_order from public.event_elements where event_id = new.copied_from;
  insert into public.event_timings (event_id, offset_minutes, label)
    select new.id, offset_minutes, label from public.event_timings where event_id = new.copied_from;
  insert into public.event_ships (event_id, ship, note, sort_order)
    select new.id, ship, note, sort_order from public.event_ships where event_id = new.copied_from;
  insert into public.event_nets (event_id, name, purpose, controller, sort_order)
    select new.id, name, purpose, controller, sort_order from public.event_nets where event_id = new.copied_from;
  insert into public.event_unit_tasks (event_id, unit_id, callsign, level, body, set_by)
    select new.id, t.unit_id, t.callsign, t.level, t.body, (select auth.uid())
    from public.event_unit_tasks t
    where t.event_id = new.copied_from and (app.is_trusted_context() or app.reads_unit_task(t.id));
  -- The opposing force goes with a copy only when the person copying may see it.
  if app.has_role('command') then
    insert into public.event_opfor (event_id, plan, updated_by)
      select new.id, o.plan, (select auth.uid()) from public.event_opfor o where o.event_id = new.copied_from;
    insert into public.event_opfor_members (event_id, member_id, leads, added_by)
      select new.id, m.member_id, m.leads, (select auth.uid())
      from public.event_opfor_members m
      where m.event_id = new.copied_from and app.is_serving_member(m.member_id);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create trigger event_unit_tasks_audit after insert or update or delete on public.event_unit_tasks
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant execute on function app.reads_unit_task(uuid), app.commands_unit(uuid, uuid) to authenticated, service_role;

grant all on public.event_unit_tasks, public.event_unit_task_texts to service_role;
-- Every column but the words, which are read from the other table.
grant select (id, event_id, unit_id, callsign, level, set_by, updated_at) on public.event_unit_tasks to authenticated;
grant insert (event_id, unit_id, callsign, level, body) on public.event_unit_tasks to authenticated;
grant update (callsign, level, body) on public.event_unit_tasks to authenticated;
grant delete on public.event_unit_tasks to authenticated;
grant select on public.event_unit_task_texts to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.event_unit_tasks enable row level security;
alter table public.event_unit_task_texts enable row level security;

-- That a unit has a task, its callsign and who it is for, are seen with the event.
create policy "A unit's task is listed with its event" on public.event_unit_tasks
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_unit_tasks.event_id));
create policy "Whoever writes an event's orders gives a unit its task" on public.event_unit_tasks
  for insert to authenticated with check (app.edits_event(event_id));
create policy "Whoever writes the orders changes a task, and a unit's commander passes it down" on public.event_unit_tasks
  for update to authenticated
  using (app.edits_event(event_id) or app.commands_unit(event_id, unit_id))
  with check (app.edits_event(event_id) or app.commands_unit(event_id, unit_id));
create policy "Whoever writes an event's orders removes a task" on public.event_unit_tasks
  for delete to authenticated using (app.edits_event(event_id));

-- The words, for those the task's level allows. The task itself must be one
-- the reader can see listed, so a draft's tasks stay with the draft.
create policy "A task's words are read by those it is for" on public.event_unit_task_texts
  for select to authenticated
  using (
    exists (select 1 from public.event_unit_tasks t where t.id = event_unit_task_texts.task_id)
    and app.reads_unit_task(task_id)
  );
