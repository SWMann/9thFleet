-- Fuller orders.
--
-- An event's orders were a warning order and five blocks of text. They can now
-- also hold, each as its own record:
--   objectives;
--   the elements taking part, each with its task and its callsign;
--   a timeline, kept as minutes before or after the start, so it moves with it;
--   where to muster, the area, and the ships;
--   what to read before the night;
--   the nets: what each is for and who controls it;
--   amendments, numbered and dated by the database once the event is announced.
--
-- A member who is attending acknowledges the latest amendment. Whoever runs the
-- event sees who has and who has not.

-- ---------------------------------------------------------------------------
-- Place and reading
-- ---------------------------------------------------------------------------

alter table public.events
  add column muster_at text not null default '' check (char_length(muster_at) <= 120),
  add column area text not null default '' check (char_length(area) <= 120),
  -- Sections of the fleet manual, each as volume/section.
  add column reading text[] not null default '{}' check (cardinality(reading) <= 12);

-- ---------------------------------------------------------------------------
-- The parts of the plan
-- ---------------------------------------------------------------------------

create table public.event_objectives (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 200),
  sort_order integer not null default 0,
  constraint event_objectives_title_tidy check (title !~ '(^\s|\s$)')
);
create index event_objectives_event_idx on public.event_objectives (event_id);

-- A ship, a flight, a section, a team: whatever the plan gives a task to.
create table public.event_elements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  callsign text not null default '' check (char_length(callsign) <= 40),
  task text not null default '' check (char_length(task) <= 1000),
  sort_order integer not null default 0,
  constraint event_elements_name_tidy check (name !~ '(^\s|\s$)'),
  unique (event_id, name)
);

-- One line of the timeline: so many minutes before or after the start.
create table public.event_timings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  offset_minutes integer not null check (offset_minutes between -1440 and 1440),
  label text not null check (char_length(label) between 2 and 120),
  constraint event_timings_label_tidy check (label !~ '(^\s|\s$)')
);
create index event_timings_event_idx on public.event_timings (event_id);

create table public.event_ships (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  ship text not null check (char_length(ship) between 2 and 80),
  note text not null default '' check (char_length(note) <= 200),
  sort_order integer not null default 0,
  constraint event_ships_ship_tidy check (ship !~ '(^\s|\s$)')
);
create index event_ships_event_idx on public.event_ships (event_id);

create table public.event_nets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  purpose text not null default '' check (char_length(purpose) <= 200),
  controller text not null default '' check (char_length(controller) <= 80),
  sort_order integer not null default 0,
  constraint event_nets_name_tidy check (name !~ '(^\s|\s$)'),
  unique (event_id, name)
);

-- A change to the orders after the event was announced. The database numbers
-- and dates it, and it is never rewritten.
create table public.event_amendments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  number smallint not null check (number >= 1),
  body text not null check (char_length(body) between 1 and 2000),
  issued_by uuid references public.members (id) on delete set null,
  issued_at timestamptz not null default now(),
  unique (event_id, number)
);

-- The latest amendment a member has acknowledged, one row for each member.
create table public.event_acknowledgements (
  event_id uuid not null references public.events (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  amendment_number smallint not null check (amendment_number >= 1),
  acknowledged_at timestamptz not null default now(),
  primary key (event_id, member_id)
);

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- The parts of the plan are fixed once the event is closed, like the rest of it.
create trigger event_objectives_guard before insert or update or delete on public.event_objectives
  for each row execute function app.guard_event_part();
create trigger event_elements_guard before insert or update or delete on public.event_elements
  for each row execute function app.guard_event_part();
create trigger event_timings_guard before insert or update or delete on public.event_timings
  for each row execute function app.guard_event_part();
create trigger event_ships_guard before insert or update or delete on public.event_ships
  for each row execute function app.guard_event_part();
create trigger event_nets_guard before insert or update or delete on public.event_nets
  for each row execute function app.guard_event_part();

-- An amendment is issued by whoever runs the event, once it is announced. A
-- draft has nobody to tell, so its orders are simply changed.
create function app.guard_event_amendment() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  event public.events%rowtype;
begin
  if app.is_trusted_context() then
    if new.number is null then
      new.number := coalesce((select max(a.number) from public.event_amendments a where a.event_id = new.event_id), 0) + 1;
    end if;
    return new;
  end if;
  -- One at a time for each event, so that two never take the same number.
  select * into event from public.events where id = new.event_id for update;
  if event.id is null or event.state <> 'announced' then
    raise exception 'An amendment is issued for an event that has been announced and is not yet closed.'
      using errcode = '23514';
  end if;
  new.number := coalesce((select max(a.number) from public.event_amendments a where a.event_id = new.event_id), 0) + 1;
  new.issued_by := (select auth.uid());
  new.issued_at := now();
  return new;
end;
$$;

create trigger event_amendments_guard before insert on public.event_amendments
  for each row execute function app.guard_event_amendment();

-- A member acknowledges the latest amendment, for themselves, if they are attending.
create function app.guard_event_acknowledgement() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  latest smallint;
begin
  if tg_op = 'UPDATE' and (new.event_id is distinct from old.event_id or new.member_id is distinct from old.member_id) then
    raise exception 'An acknowledgement cannot be moved to another event or member.' using errcode = '42501';
  end if;
  if app.is_trusted_context() then
    return new;
  end if;
  if new.member_id is distinct from (select auth.uid()) then
    raise exception 'Only the member can acknowledge for themselves.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events e where e.id = new.event_id and e.state = 'announced') then
    raise exception 'This event is not open.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.attendance t
    where t.event_id = new.event_id and t.member_id = new.member_id and t.reply = 'attending'
  ) then
    raise exception 'Only a member who is attending acknowledges the orders.' using errcode = '23514';
  end if;
  select max(a.number) into latest from public.event_amendments a where a.event_id = new.event_id;
  if latest is null then
    raise exception 'There is no amendment to acknowledge.' using errcode = '23514';
  end if;
  -- Whatever number was sent, it is the latest that is acknowledged.
  new.amendment_number := latest;
  new.acknowledged_at := now();
  return new;
end;
$$;

create trigger event_acknowledgements_guard before insert or update on public.event_acknowledgements
  for each row execute function app.guard_event_acknowledgement();

-- ---------------------------------------------------------------------------
-- Copies and repeats carry the plan, and not what was said about it
-- ---------------------------------------------------------------------------

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
  return new;
end;
$$;

-- Next week's event, as it was, now with the place and the reading.
create or replace function app.draft_next_week() returns trigger
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
       weapons_state, pve_fallback, repeats_weekly, copied_from, created_by,
       open_to_recruits, open_to_service, requires_qualification_id, places, minimum_attending,
       muster_at, area, reading)
    values
      (new.kind, app.next_title(new.title), new.summary, next_start, new.duration_minutes,
       case when app.is_serving_member(new.commander_id) then new.commander_id else closer end,
       case when app.is_serving_member(new.second_id) then new.second_id end,
       case when app.is_serving_member(new.observer_id) then new.observer_id end,
       new.weapons_state, new.pve_fallback, true, new.id, coalesce(closer, new.created_by),
       new.open_to_recruits, new.open_to_service, new.requires_qualification_id, new.places, new.minimum_attending,
       new.muster_at, new.area, new.reading);
  exception when others then
    raise warning 'Next week''s event was not drafted: %', sqlerrm;
  end;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create trigger event_objectives_audit after insert or update or delete on public.event_objectives
  for each row execute function app.audit();
create trigger event_elements_audit after insert or update or delete on public.event_elements
  for each row execute function app.audit();
create trigger event_timings_audit after insert or update or delete on public.event_timings
  for each row execute function app.audit();
create trigger event_ships_audit after insert or update or delete on public.event_ships
  for each row execute function app.audit();
create trigger event_nets_audit after insert or update or delete on public.event_nets
  for each row execute function app.audit();
create trigger event_amendments_audit after insert or update or delete on public.event_amendments
  for each row execute function app.audit();
create trigger event_acknowledgements_audit after insert or update or delete on public.event_acknowledgements
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant all on
  public.event_objectives, public.event_elements, public.event_timings, public.event_ships, public.event_nets,
  public.event_amendments, public.event_acknowledgements
to service_role;

grant select, delete on
  public.event_objectives, public.event_elements, public.event_timings, public.event_ships, public.event_nets
to authenticated;
grant insert (event_id, title, sort_order) on public.event_objectives to authenticated;
grant update (title, sort_order) on public.event_objectives to authenticated;
grant insert (event_id, name, callsign, task, sort_order) on public.event_elements to authenticated;
grant update (name, callsign, task, sort_order) on public.event_elements to authenticated;
grant insert (event_id, offset_minutes, label) on public.event_timings to authenticated;
grant update (offset_minutes, label) on public.event_timings to authenticated;
grant insert (event_id, ship, note, sort_order) on public.event_ships to authenticated;
grant update (ship, note, sort_order) on public.event_ships to authenticated;
grant insert (event_id, name, purpose, controller, sort_order) on public.event_nets to authenticated;
grant update (name, purpose, controller, sort_order) on public.event_nets to authenticated;

grant insert (muster_at, area, reading) on public.events to authenticated;
grant update (muster_at, area, reading) on public.events to authenticated;

-- An amendment is written once. Its number, its date and its signature are the database's.
grant select on public.event_amendments to authenticated;
grant insert (event_id, body) on public.event_amendments to authenticated;
-- Only an admin's rule lets this through.
grant delete on public.event_amendments to authenticated;

grant select on public.event_acknowledgements to authenticated;
grant insert (event_id, member_id, amendment_number) on public.event_acknowledgements to authenticated;
grant update (amendment_number) on public.event_acknowledgements to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.event_objectives enable row level security;
alter table public.event_elements enable row level security;
alter table public.event_timings enable row level security;
alter table public.event_ships enable row level security;
alter table public.event_nets enable row level security;
alter table public.event_amendments enable row level security;
alter table public.event_acknowledgements enable row level security;

-- The plan is seen by whoever can see its event, and kept by whoever may write
-- the event's orders: whoever runs it, and its author while it is a draft.
create policy "An event's objectives are seen with it" on public.event_objectives
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_objectives.event_id));
create policy "Whoever runs an event adds its objectives" on public.event_objectives
  for insert to authenticated with check (app.edits_event(event_id));
create policy "Whoever runs an event changes its objectives" on public.event_objectives
  for update to authenticated using (app.edits_event(event_id)) with check (app.edits_event(event_id));
create policy "Whoever runs an event removes its objectives" on public.event_objectives
  for delete to authenticated using (app.edits_event(event_id));

create policy "An event's elements are seen with it" on public.event_elements
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_elements.event_id));
create policy "Whoever runs an event adds its elements" on public.event_elements
  for insert to authenticated with check (app.edits_event(event_id));
create policy "Whoever runs an event changes its elements" on public.event_elements
  for update to authenticated using (app.edits_event(event_id)) with check (app.edits_event(event_id));
create policy "Whoever runs an event removes its elements" on public.event_elements
  for delete to authenticated using (app.edits_event(event_id));

create policy "An event's timeline is seen with it" on public.event_timings
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_timings.event_id));
create policy "Whoever runs an event adds to its timeline" on public.event_timings
  for insert to authenticated with check (app.edits_event(event_id));
create policy "Whoever runs an event changes its timeline" on public.event_timings
  for update to authenticated using (app.edits_event(event_id)) with check (app.edits_event(event_id));
create policy "Whoever runs an event removes from its timeline" on public.event_timings
  for delete to authenticated using (app.edits_event(event_id));

create policy "An event's ships are seen with it" on public.event_ships
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_ships.event_id));
create policy "Whoever runs an event adds its ships" on public.event_ships
  for insert to authenticated with check (app.edits_event(event_id));
create policy "Whoever runs an event changes its ships" on public.event_ships
  for update to authenticated using (app.edits_event(event_id)) with check (app.edits_event(event_id));
create policy "Whoever runs an event removes its ships" on public.event_ships
  for delete to authenticated using (app.edits_event(event_id));

create policy "An event's nets are seen with it" on public.event_nets
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_nets.event_id));
create policy "Whoever runs an event adds its nets" on public.event_nets
  for insert to authenticated with check (app.edits_event(event_id));
create policy "Whoever runs an event changes its nets" on public.event_nets
  for update to authenticated using (app.edits_event(event_id)) with check (app.edits_event(event_id));
create policy "Whoever runs an event removes its nets" on public.event_nets
  for delete to authenticated using (app.edits_event(event_id));

create policy "An event's amendments are seen with it" on public.event_amendments
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_amendments.event_id));
create policy "Whoever runs an event issues its amendments" on public.event_amendments
  for insert to authenticated with check (app.runs_event(event_id));
create policy "Admins delete an amendment issued by mistake" on public.event_amendments
  for delete to authenticated using ((select app.has_role('admin')));

-- Who has acknowledged is for whoever runs the event, and each member for their own line.
create policy "See your own acknowledgement, or all of them as whoever runs the event" on public.event_acknowledgements
  for select to authenticated
  using (((select app.is_serving()) and member_id = (select auth.uid())) or app.runs_event(event_id));
create policy "Acknowledge for yourself" on public.event_acknowledgements
  for insert to authenticated with check ((select app.is_serving()) and member_id = (select auth.uid()));
create policy "Acknowledge again for yourself" on public.event_acknowledgements
  for update to authenticated
  using ((select app.is_serving()) and member_id = (select auth.uid()))
  with check ((select app.is_serving()) and member_id = (select auth.uid()));
