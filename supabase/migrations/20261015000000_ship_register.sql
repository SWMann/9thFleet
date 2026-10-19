-- The ship register and readiness
--
-- Ships are member-owned for now, so the register is each member's own
-- hulls, which the serving fleet can see. Command may add or correct any
-- entry, and register a hull as the fleet's. An owner marks each ship ready or
-- not, and that is the standing readiness: what could sail tonight.
--
--   Every hull is one of the ship models the site keeps, which an admin edits
--   with the rest of the structure. A model has crew templates: the stations
--   aboard, each a role of the order of battle with a count, as Volume 1 sets
--   out for the Idris. One template is the standard; command adds variants.
--   An event's plan says which models it needs and how many. An owner who is
--   attending offers the ready ships they will bring, until the roll closes.
--   The event page then shows offered against wanted, hull by hull and seat
--   by seat.
--   An owner's note on a ship is for the owner and command.

-- ---------------------------------------------------------------------------
-- Ship models
-- ---------------------------------------------------------------------------

create type public.ship_kind as enum (
  'fighter', 'bomber', 'gunship', 'dropship', 'corvette', 'frigate', 'capital',
  'transport', 'medical', 'support', 'salvage', 'mining', 'exploration', 'runabout'
);

create table public.ship_models (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name text not null unique check (char_length(name) between 2 and 60 and name !~ '(^\s|\s$)'),
  maker text not null default '' check (char_length(maker) <= 60),
  kind public.ship_kind not null,
  crew_min smallint not null check (crew_min >= 1),
  crew_max smallint not null check (crew_max >= crew_min and crew_max <= 200),
  -- Whether the hull can be flown in the game today. Nobody registers one that cannot.
  flyable boolean not null default true,
  sort_order smallint not null default 0
);
create trigger ship_models_audit after insert or update or delete on public.ship_models
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- Crew templates: the stations aboard each model
-- ---------------------------------------------------------------------------

create table public.crew_templates (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.ship_models (id) on delete cascade,
  name text not null default 'Standard' check (char_length(name) between 1 and 60 and name !~ '(^\s|\s$)'),
  is_default boolean not null default false,
  unique (model_id, name)
);
-- One standard template for each model.
create unique index crew_templates_one_default on public.crew_templates (model_id) where is_default;
create trigger crew_templates_audit after insert or update or delete on public.crew_templates
  for each row execute function app.audit();

create table public.crew_template_stations (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.crew_templates (id) on delete cascade,
  role_id uuid not null references public.fleet_roles (id) on delete restrict,
  count smallint not null check (count between 1 and 99),
  sort_order smallint not null default 0,
  unique (template_id, role_id)
);
create index crew_template_stations_template_idx on public.crew_template_stations (template_id);
create trigger crew_template_stations_audit after insert or update or delete on public.crew_template_stations
  for each row execute function app.audit();

-- The standard template of a model stays while the model does. Another is
-- made the standard first.
create function app.guard_template() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.is_default and not app.is_trusted_context() and pg_trigger_depth() <= 1 then
    raise exception 'The standard template stays. Make another the standard first.' using errcode = '23514';
  end if;
  return old;
end;
$$;
create trigger crew_templates_guard before delete on public.crew_templates
  for each row execute function app.guard_template();

-- A template's stations stay with it.
create function app.guard_station() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.template_id is distinct from old.template_id then
    raise exception 'A station cannot be moved to another template.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger crew_template_stations_guard before update on public.crew_template_stations
  for each row execute function app.guard_station();

-- ---------------------------------------------------------------------------
-- The register
-- ---------------------------------------------------------------------------

create table public.ships (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.ship_models (id) on delete restrict,
  -- Whose it is. Empty for a hull that is the fleet's.
  owner_id uuid references public.members (id) on delete cascade,
  -- What the owner calls it, if anything. One line, with nothing hidden in it.
  name text not null default ''
    check (
      char_length(name) <= 60 and name !~ '(^\s|\s$)'
      and name !~ ('[[:cntrl:]' || chr(8203) || chr(8232) || '-' || chr(8238) || chr(8288) || '-' || chr(8297) || chr(65279) || ']')
    ),
  -- Whether it could sail tonight, and since when the owner has said so.
  ready boolean not null default true,
  ready_as_of timestamptz not null default now(),
  registered_by uuid references public.members (id) on delete set null,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ships_owner_idx on public.ships (owner_id) where owner_id is not null;
create index ships_model_idx on public.ships (model_id);

-- The owner's own note on a ship: where it is kept, what is fitted, what is
-- wrong with it. For the owner and command.
create table public.ship_notes (
  ship_id uuid primary key references public.ships (id) on delete cascade,
  note text not null default '' check (char_length(note) <= 600)
);

-- What an owner decides and what the database keeps for itself.
--   A member registers their own ships, names them and marks them ready or
--   not. Command may register a hull for anyone, or as the fleet's, and
--   correct any entry.
--   The database: who registered it and when, and when it was last marked.
create function app.guard_ship() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  command boolean;
begin
  if app.is_trusted_context() then
    if tg_op = 'UPDATE' then
      new.updated_at := now();
      if new.ready is distinct from old.ready then
        new.ready_as_of := now();
      end if;
    end if;
    return new;
  end if;
  if not app.is_serving() then
    raise exception 'The register is for the serving fleet.' using errcode = '42501';
  end if;
  command := app.has_role('command');
  if tg_op = 'INSERT' then
    if not command then
      new.owner_id := me;
    elsif new.owner_id is not null and not app.is_serving_member(new.owner_id) then
      raise exception 'A ship is registered to a serving member, or to the fleet.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.ship_models m where m.id = new.model_id and m.flyable) then
      raise exception 'That model cannot be flown yet.' using errcode = '23514';
    end if;
    new.registered_by := me;
    new.registered_at := now();
    new.ready_as_of := now();
    new.updated_at := now();
    return new;
  end if;
  -- An owner changes a ship's name and whether it is ready. Command changes anything else.
  new.registered_by := old.registered_by;
  new.registered_at := old.registered_at;
  if not command then
    if old.owner_id is distinct from me then
      raise exception 'Only the owner or command changes a ship.' using errcode = '42501';
    end if;
    new.owner_id := old.owner_id;
    new.model_id := old.model_id;
  elsif new.owner_id is not null and not app.is_serving_member(new.owner_id) then
    raise exception 'A ship is registered to a serving member, or to the fleet.' using errcode = '23514';
  end if;
  new.ready_as_of := case when new.ready is distinct from old.ready then now() else old.ready_as_of end;
  new.updated_at := now();
  return new;
end;
$$;

create trigger ships_guard before insert or update on public.ships
  for each row execute function app.guard_ship();

-- A note is the owner's or command's. The rule is here as well as in the
-- access rules, so that the database says why.
create function app.guard_ship_note() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  target uuid := case when tg_op = 'DELETE' then old.ship_id else new.ship_id end;
begin
  -- The database's own housekeeping: the note goes with its ship.
  if app.is_trusted_context() or (tg_op = 'DELETE' and pg_trigger_depth() > 1) then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.ship_id is distinct from old.ship_id then
    raise exception 'A note stays with its ship.' using errcode = '42501';
  end if;
  if not app.has_role('command') and not exists (
    select 1 from public.ships s where s.id = target and s.owner_id = (select auth.uid())
  ) then
    raise exception 'Only the owner or command writes a note on a ship.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger ship_notes_guard before insert or update or delete on public.ship_notes
  for each row execute function app.guard_ship_note();

-- The log records that a note was written or removed, not what it said, and
-- files a ship under its owner.
create or replace function app.audit() returns trigger
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
  elsif tg_table_name = 'ships' then
    who := (any_row ->> 'owner_id')::uuid;
  elsif tg_table_name = 'ship_notes' then
    before_row := before_row - 'note';
    after_row := after_row - 'note';
    select owner_id into who from public.ships where id = (any_row ->> 'ship_id')::uuid;
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

create trigger ships_audit after insert or update or delete on public.ships
  for each row execute function app.audit();
create trigger ship_notes_audit after insert or update or delete on public.ship_notes
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- What an event's plan needs, by model
-- ---------------------------------------------------------------------------

alter table public.event_ships
  add column model_id uuid references public.ship_models (id) on delete set null,
  add column count smallint not null default 1 check (count between 1 and 99);
create index event_ships_model_idx on public.event_ships (model_id) where model_id is not null;

-- A ship picked from the list is named by its model.
create function app.name_event_ship() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.model_id is not null then
    select m.name into new.ship from public.ship_models m where m.id = new.model_id;
    if new.ship is null then
      raise exception 'There is no such model.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger event_ships_named before insert or update of model_id on public.event_ships
  for each row execute function app.name_event_ship();

grant insert (model_id, count) on public.event_ships to authenticated;
grant update (model_id, count) on public.event_ships to authenticated;

-- A copy carries the plan's ships by model and count.
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
  insert into public.event_ships (event_id, ship, note, sort_order, model_id, count)
    select new.id, ship, note, sort_order, model_id, count from public.event_ships where event_id = new.copied_from;
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
-- What is offered for an event
-- ---------------------------------------------------------------------------

-- An owner who is attending offers the ready ships they will bring, until the
-- roll closes. Command offers the fleet's hulls. An offer goes when the owner
-- is no longer attending, or the ship is no longer ready.
create table public.event_ship_offers (
  event_id uuid not null references public.events (id) on delete cascade,
  ship_id uuid not null references public.ships (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  offered_at timestamptz not null default now(),
  primary key (event_id, ship_id)
);
create index event_ship_offers_member_idx on public.event_ship_offers (member_id);

create function app.guard_ship_offer() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  event public.events%rowtype;
  ship public.ships%rowtype;
begin
  -- The database's own housekeeping: an offer withdrawn because the owner is
  -- no longer attending, or the ship no longer ready.
  if app.is_trusted_context() or (tg_op = 'DELETE' and pg_trigger_depth() > 1) then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.member_id <> me and not app.has_role('command') then
      raise exception 'Only whoever offered a ship withdraws it.' using errcode = '42501';
    end if;
    if not app.has_role('command') and exists (
      select 1 from public.events e where e.id = old.event_id and (e.state <> 'announced' or now() >= e.roll_closes_at)
    ) then
      raise exception 'The roll has closed. Tell the operation commander if you cannot bring it.' using errcode = '23514';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'An offer is made or withdrawn, not changed.' using errcode = '42501';
  end if;
  -- Refused first, so that nothing below can tell an outsider anything.
  if not app.is_serving() then
    raise exception 'The roll is for serving members.' using errcode = '42501';
  end if;
  select * into event from public.events e where e.id = new.event_id;
  if event.id is null or event.state <> 'announced' then
    raise exception 'This event has not been announced.' using errcode = '23514';
  end if;
  if now() >= event.roll_closes_at then
    raise exception 'The roll has closed. Tell the operation commander what you can bring.' using errcode = '23514';
  end if;
  select * into ship from public.ships s where s.id = new.ship_id;
  if ship.id is null then
    raise exception 'There is no such ship on the register.' using errcode = '23514';
  end if;
  if ship.owner_id is distinct from me and not (ship.owner_id is null and app.has_role('command')) then
    raise exception 'You offer your own ships. Command offers the fleet''s.' using errcode = '42501';
  end if;
  if not ship.ready then
    raise exception 'That ship is not marked ready.' using errcode = '23514';
  end if;
  -- An owner brings their own ship, so they must be coming. The fleet's hulls
  -- are offered by command whether or not that officer is.
  if ship.owner_id is not null and not exists (
    select 1 from public.attendance a where a.event_id = new.event_id and a.member_id = me and a.reply = 'attending'
  ) then
    raise exception 'Reply that you are attending before offering a ship.' using errcode = '23514';
  end if;
  new.member_id := me;
  new.offered_at := now();
  return new;
end;
$$;

create trigger event_ship_offers_guard before insert or update or delete on public.event_ship_offers
  for each row execute function app.guard_ship_offer();
create trigger event_ship_offers_audit after insert or delete on public.event_ship_offers
  for each row execute function app.audit();

-- Someone no longer attending brings nothing of their own: their offers go
-- when they reply that they are not coming, and when their line on the roll
-- is removed. The fleet's hulls, which command offers, stay. A ship marked
-- not ready, or given to another owner, is withdrawn from every event whose
-- roll is still open. Once a roll has closed the offer stands, and the event
-- page shows the ship as not ready, so that whoever runs the event knows.
create function app.withdraw_offers() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'attendance' then
    if tg_op = 'DELETE' or (new.reply = 'not_attending' and old.reply is distinct from 'not_attending') then
      delete from public.event_ship_offers o
      using public.ships s
      where o.event_id = coalesce(new.event_id, old.event_id) and o.member_id = coalesce(new.member_id, old.member_id)
        and s.id = o.ship_id and s.owner_id is not null;
    end if;
  elsif tg_table_name = 'ships' then
    if (not new.ready and old.ready) or new.owner_id is distinct from old.owner_id then
      delete from public.event_ship_offers o
      using public.events e
      where o.ship_id = new.id and e.id = o.event_id and e.state = 'announced' and now() < e.roll_closes_at;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger attendance_withdraws_offers after update of reply or delete on public.attendance
  for each row execute function app.withdraw_offers();
create trigger ships_withdraw_offers after update of ready, owner_id on public.ships
  for each row execute function app.withdraw_offers();

-- A ship offered for an event whose roll has closed is counted on. Its owner
-- does not take it off the register until the event is over; command may.
create function app.guard_ship_removal() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  counted text;
begin
  if app.is_trusted_context() or pg_trigger_depth() > 1 or app.has_role('command') then
    return old;
  end if;
  select e.title into counted
  from public.event_ship_offers o join public.events e on e.id = o.event_id
  where o.ship_id = old.id and e.state = 'announced' and now() >= e.roll_closes_at and e.starts_at > now()
  order by e.starts_at limit 1;
  if counted is not null then
    raise exception 'It is offered for %, whose roll has closed. Mark it not ready, so that whoever runs the event knows, and take it off the register afterwards.', counted using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger ships_guard_removal before delete on public.ships
  for each row execute function app.guard_ship_removal();

-- A member who leaves the serving fleet brings nothing: their ships are marked
-- not ready and withdrawn from every event still to come, and they stay on the
-- register against the day they come back.
create function app.stand_down_ships() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.status in ('recruit', 'auxiliary', 'member', 'reserve') and new.status not in ('recruit', 'auxiliary', 'member', 'reserve') then
    delete from public.event_ship_offers o
    using public.ships s, public.events e
    where s.owner_id = new.id and o.ship_id = s.id and e.id = o.event_id and e.starts_at > now();
    update public.ships set ready = false where owner_id = new.id and ready;
  end if;
  return new;
end;
$$;

create trigger members_stand_down_ships after update of status on public.members
  for each row execute function app.stand_down_ships();

-- A plan line picked from the list follows its model's name.
create function app.rename_event_ships() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.name is distinct from old.name then
    update public.event_ships set ship = new.name where model_id = new.id;
  end if;
  return new;
end;
$$;

create trigger ship_models_renamed after update of name on public.ship_models
  for each row execute function app.rename_event_ships();

-- ---------------------------------------------------------------------------
-- The models the fleet flies, and the Idris's crew from Volume 1
-- ---------------------------------------------------------------------------

insert into public.ship_models (slug, name, maker, kind, crew_min, crew_max, sort_order) values
  ('idris-m', 'Idris-M', 'Aegis Dynamics', 'frigate', 8, 28, 10),
  ('idris-p', 'Idris-P', 'Aegis Dynamics', 'frigate', 8, 28, 11),
  ('polaris', 'Polaris', 'Roberts Space Industries', 'corvette', 6, 14, 20),
  ('hammerhead', 'Hammerhead', 'Aegis Dynamics', 'corvette', 7, 9, 21),
  ('redeemer', 'Redeemer', 'Aegis Dynamics', 'gunship', 2, 5, 30),
  ('valkyrie', 'Valkyrie', 'Anvil Aerospace', 'dropship', 2, 5, 40),
  ('cutlass-black', 'Cutlass Black', 'Drake Interplanetary', 'dropship', 1, 3, 41),
  ('cutlass-blue', 'Cutlass Blue', 'Drake Interplanetary', 'gunship', 1, 3, 31),
  ('cutlass-red', 'Cutlass Red', 'Drake Interplanetary', 'medical', 1, 3, 90),
  ('gladius', 'Gladius', 'Aegis Dynamics', 'fighter', 1, 1, 50),
  ('arrow', 'Arrow', 'Anvil Aerospace', 'fighter', 1, 1, 51),
  ('f7c-hornet-mk-ii', 'F7C Hornet Mk II', 'Anvil Aerospace', 'fighter', 1, 1, 52),
  ('f7a-hornet-mk-ii', 'F7A Hornet Mk II', 'Anvil Aerospace', 'fighter', 1, 1, 53),
  ('f8c-lightning', 'F8C Lightning', 'Anvil Aerospace', 'fighter', 1, 1, 54),
  ('sabre', 'Sabre', 'Aegis Dynamics', 'fighter', 1, 1, 55),
  ('hurricane', 'Hurricane', 'Anvil Aerospace', 'fighter', 1, 2, 56),
  ('scorpius', 'Scorpius', 'Roberts Space Industries', 'fighter', 1, 2, 57),
  ('vanguard-warden', 'Vanguard Warden', 'Aegis Dynamics', 'fighter', 1, 2, 58),
  ('vanguard-sentinel', 'Vanguard Sentinel', 'Aegis Dynamics', 'fighter', 1, 2, 59),
  ('vanguard-harbinger', 'Vanguard Harbinger', 'Aegis Dynamics', 'bomber', 1, 2, 60),
  ('ares-inferno', 'Ares Inferno', 'Crusader Industries', 'fighter', 1, 1, 61),
  ('ares-ion', 'Ares Ion', 'Crusader Industries', 'fighter', 1, 1, 62),
  ('buccaneer', 'Buccaneer', 'Drake Interplanetary', 'fighter', 1, 1, 63),
  ('avenger-titan', 'Avenger Titan', 'Aegis Dynamics', 'fighter', 1, 1, 64),
  ('aurora-mk-ii', 'Aurora Mk II', 'Roberts Space Industries', 'fighter', 1, 1, 65),
  ('mustang-alpha', 'Mustang Alpha', 'Consolidated Outland', 'fighter', 1, 1, 66),
  ('fury', 'Fury', 'Mirai', 'fighter', 1, 1, 67),
  ('guardian', 'Guardian', 'Mirai', 'fighter', 1, 1, 68),
  ('eclipse', 'Eclipse', 'Aegis Dynamics', 'bomber', 1, 1, 70),
  ('gladiator', 'Gladiator', 'Anvil Aerospace', 'bomber', 1, 2, 71),
  ('retaliator', 'Retaliator', 'Aegis Dynamics', 'bomber', 1, 6, 72),
  ('constellation-andromeda', 'Constellation Andromeda', 'Roberts Space Industries', 'gunship', 1, 4, 32),
  ('constellation-taurus', 'Constellation Taurus', 'Roberts Space Industries', 'transport', 1, 4, 80),
  ('constellation-aquila', 'Constellation Aquila', 'Roberts Space Industries', 'exploration', 1, 4, 110),
  ('corsair', 'Corsair', 'Drake Interplanetary', 'exploration', 1, 4, 111),
  ('carrack', 'Carrack', 'Anvil Aerospace', 'exploration', 1, 6, 112),
  ('600i', '600i', 'Origin Jumpworks', 'exploration', 1, 5, 113),
  ('400i', '400i', 'Origin Jumpworks', 'exploration', 1, 3, 114),
  ('terrapin', 'Terrapin', 'Anvil Aerospace', 'exploration', 1, 2, 115),
  ('890-jump', '890 Jump', 'Origin Jumpworks', 'capital', 1, 8, 15),
  ('freelancer', 'Freelancer', 'MISC', 'transport', 1, 4, 81),
  ('freelancer-max', 'Freelancer MAX', 'MISC', 'transport', 1, 4, 82),
  ('starlancer-max', 'Starlancer MAX', 'MISC', 'transport', 1, 4, 83),
  ('caterpillar', 'Caterpillar', 'Drake Interplanetary', 'transport', 1, 5, 84),
  ('c2-hercules', 'C2 Hercules', 'Crusader Industries', 'transport', 1, 3, 85),
  ('m2-hercules', 'M2 Hercules', 'Crusader Industries', 'transport', 1, 3, 86),
  ('a2-hercules', 'A2 Hercules', 'Crusader Industries', 'bomber', 1, 3, 73),
  ('mercury-star-runner', 'Mercury Star Runner', 'Crusader Industries', 'transport', 1, 3, 87),
  ('spirit-c1', 'Spirit C1', 'Crusader Industries', 'transport', 1, 2, 88),
  ('zeus-mk-ii-cl', 'Zeus Mk II CL', 'Roberts Space Industries', 'transport', 1, 3, 89),
  ('zeus-mk-ii-es', 'Zeus Mk II ES', 'Roberts Space Industries', 'exploration', 1, 3, 116),
  ('pisces-c8x', 'Pisces C8X', 'Anvil Aerospace', 'runabout', 1, 3, 120),
  ('pisces-c8r', 'Pisces C8R', 'Anvil Aerospace', 'medical', 1, 3, 91),
  ('starfarer', 'Starfarer', 'MISC', 'support', 1, 4, 100),
  ('starfarer-gemini', 'Starfarer Gemini', 'MISC', 'support', 1, 4, 101),
  ('reclaimer', 'Reclaimer', 'Aegis Dynamics', 'salvage', 1, 5, 130),
  ('vulture', 'Vulture', 'Drake Interplanetary', 'salvage', 1, 1, 131),
  ('prospector', 'Prospector', 'MISC', 'mining', 1, 1, 140),
  ('mole', 'MOLE', 'ARGO Astronautics', 'mining', 1, 4, 141),
  ('cutter', 'Cutter', 'Drake Interplanetary', 'runabout', 1, 1, 121),
  ('nomad', 'Nomad', 'Consolidated Outland', 'runabout', 1, 1, 122),
  ('intrepid', 'Intrepid', 'Crusader Industries', 'runabout', 1, 1, 123);

-- The Idris's standard crew, as Volume 1 lays it out, and the simplest
-- templates for the rest: command fills the others in.
insert into public.crew_templates (model_id, name, is_default)
select m.id, 'Standard', true from public.ship_models m;

insert into public.crew_template_stations (template_id, role_id, count, sort_order)
select t.id, r.id, v.n, v.sort
from (values
  ('idris-m', 'commanding-officer', 1, 1),
  ('idris-m', 'executive-officer', 1, 2),
  ('idris-m', 'tactical-officer', 1, 3),
  ('idris-m', 'chief-of-the-boat', 1, 4),
  ('idris-m', 'chief-engineer', 1, 5),
  ('idris-m', 'helmsman', 1, 6),
  ('idris-m', 'gunnery-chief', 1, 7),
  ('idris-m', 'flight-deck-chief', 1, 8),
  ('idris-m', 'master-at-arms', 1, 9),
  ('idris-m', 'navigator', 1, 10),
  ('idris-m', 'signaller', 1, 11),
  ('idris-m', 'senior-engineer', 1, 12),
  ('idris-m', 'medic', 1, 13),
  ('idris-m', 'gunner', 9, 14),
  ('idris-m', 'engineer', 2, 15),
  ('idris-m', 'deck-hand', 1, 16),
  ('idris-p', 'commanding-officer', 1, 1),
  ('idris-p', 'executive-officer', 1, 2),
  ('idris-p', 'tactical-officer', 1, 3),
  ('idris-p', 'chief-of-the-boat', 1, 4),
  ('idris-p', 'chief-engineer', 1, 5),
  ('idris-p', 'helmsman', 1, 6),
  ('idris-p', 'gunnery-chief', 1, 7),
  ('idris-p', 'flight-deck-chief', 1, 8),
  ('idris-p', 'master-at-arms', 1, 9),
  ('idris-p', 'navigator', 1, 10),
  ('idris-p', 'signaller', 1, 11),
  ('idris-p', 'senior-engineer', 1, 12),
  ('idris-p', 'medic', 1, 13),
  ('idris-p', 'gunner', 9, 14),
  ('idris-p', 'engineer', 2, 15),
  ('idris-p', 'deck-hand', 1, 16),
  -- A corvette: the escort crew of ten.
  ('polaris', 'commanding-officer', 1, 1),
  ('polaris', 'executive-officer', 1, 2),
  ('polaris', 'chief-of-the-boat', 1, 3),
  ('polaris', 'helmsman', 1, 4),
  ('polaris', 'engineer', 1, 5),
  ('polaris', 'gunner', 6, 6),
  ('hammerhead', 'commanding-officer', 1, 1),
  ('hammerhead', 'executive-officer', 1, 2),
  ('hammerhead', 'chief-of-the-boat', 1, 3),
  ('hammerhead', 'engineer', 1, 4),
  ('hammerhead', 'gunner', 6, 5),
  -- A gunship: the escort crew of five.
  ('redeemer', 'commanding-officer', 1, 1),
  ('redeemer', 'engineer', 1, 2),
  ('redeemer', 'gunner', 3, 3),
  ('cutlass-blue', 'commanding-officer', 1, 1),
  ('cutlass-blue', 'gunner', 2, 2),
  ('constellation-andromeda', 'commanding-officer', 1, 1),
  ('constellation-andromeda', 'engineer', 1, 2),
  ('constellation-andromeda', 'gunner', 2, 3),
  -- Single-seat fighters and bombers.
  ('gladius', 'fighter-pilot', 1, 1),
  ('arrow', 'fighter-pilot', 1, 1),
  ('f7c-hornet-mk-ii', 'fighter-pilot', 1, 1),
  ('f7a-hornet-mk-ii', 'fighter-pilot', 1, 1),
  ('f8c-lightning', 'fighter-pilot', 1, 1),
  ('sabre', 'fighter-pilot', 1, 1),
  ('ares-inferno', 'fighter-pilot', 1, 1),
  ('ares-ion', 'fighter-pilot', 1, 1),
  ('buccaneer', 'fighter-pilot', 1, 1),
  ('avenger-titan', 'fighter-pilot', 1, 1),
  ('aurora-mk-ii', 'fighter-pilot', 1, 1),
  ('mustang-alpha', 'fighter-pilot', 1, 1),
  ('fury', 'fighter-pilot', 1, 1),
  ('guardian', 'fighter-pilot', 1, 1),
  ('eclipse', 'fighter-pilot', 1, 1),
  -- Two-seat fighters: a pilot and a gunner.
  ('hurricane', 'fighter-pilot', 1, 1),
  ('hurricane', 'gunner', 1, 2),
  ('scorpius', 'fighter-pilot', 1, 1),
  ('scorpius', 'gunner', 1, 2),
  ('vanguard-warden', 'fighter-pilot', 1, 1),
  ('vanguard-warden', 'gunner', 1, 2),
  ('vanguard-sentinel', 'fighter-pilot', 1, 1),
  ('vanguard-sentinel', 'gunner', 1, 2),
  ('vanguard-harbinger', 'fighter-pilot', 1, 1),
  ('vanguard-harbinger', 'gunner', 1, 2),
  ('gladiator', 'fighter-pilot', 1, 1),
  ('gladiator', 'gunner', 1, 2)
) as v (model, role, n, sort)
join public.ship_models m on m.slug = v.model
join public.crew_templates t on t.model_id = m.id and t.is_default
join public.fleet_roles r on r.slug = v.role;

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant all on public.ship_models, public.crew_templates, public.crew_template_stations, public.ships, public.ship_notes, public.event_ship_offers to service_role;

grant select, insert, update, delete on public.ship_models to authenticated;
grant select on public.crew_templates, public.crew_template_stations to authenticated;
grant insert (model_id, name, is_default) on public.crew_templates to authenticated;
grant update (name, is_default) on public.crew_templates to authenticated;
grant delete on public.crew_templates to authenticated;
grant insert (template_id, role_id, count, sort_order) on public.crew_template_stations to authenticated;
grant update (role_id, count, sort_order) on public.crew_template_stations to authenticated;
grant delete on public.crew_template_stations to authenticated;

grant select on public.ships to authenticated;
grant insert (model_id, owner_id, name, ready) on public.ships to authenticated;
grant update (model_id, owner_id, name, ready) on public.ships to authenticated;
grant delete on public.ships to authenticated;

grant select, insert, update, delete on public.ship_notes to authenticated;

grant select on public.event_ship_offers to authenticated;
grant insert (event_id, ship_id) on public.event_ship_offers to authenticated;
grant delete on public.event_ship_offers to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.ship_models enable row level security;
alter table public.crew_templates enable row level security;
alter table public.crew_template_stations enable row level security;
alter table public.ships enable row level security;
alter table public.ship_notes enable row level security;
alter table public.event_ship_offers enable row level security;

create policy "The fleet reads the ship models" on public.ship_models
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Admins add ship models" on public.ship_models
  for insert to authenticated with check ((select app.has_role('admin')));
create policy "Admins change ship models" on public.ship_models
  for update to authenticated using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
create policy "Admins remove ship models" on public.ship_models
  for delete to authenticated using ((select app.has_role('admin')));

create policy "The fleet reads the crew templates" on public.crew_templates
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Command adds crew templates" on public.crew_templates
  for insert to authenticated with check ((select app.has_role('command')));
create policy "Command changes crew templates" on public.crew_templates
  for update to authenticated using ((select app.has_role('command'))) with check ((select app.has_role('command')));
create policy "Command removes crew templates" on public.crew_templates
  for delete to authenticated using ((select app.has_role('command')));

create policy "The fleet reads the stations of each template" on public.crew_template_stations
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Command adds stations" on public.crew_template_stations
  for insert to authenticated with check ((select app.has_role('command')));
create policy "Command changes stations" on public.crew_template_stations
  for update to authenticated using ((select app.has_role('command'))) with check ((select app.has_role('command')));
create policy "Command removes stations" on public.crew_template_stations
  for delete to authenticated using ((select app.has_role('command')));

-- The register is the serving fleet's to read. A serving member registers
-- their own ships; command registers any.
create policy "The serving fleet reads the register" on public.ships
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "A serving member registers a ship" on public.ships
  for insert to authenticated with check ((select app.is_serving()));
create policy "The owner or command changes a ship" on public.ships
  for update to authenticated
  using ((select app.is_serving()) and (owner_id = (select auth.uid()) or (select app.has_role('command'))))
  with check ((select app.is_serving()));
create policy "The owner or command removes a ship" on public.ships
  for delete to authenticated
  using ((select app.is_serving()) and (owner_id = (select auth.uid()) or (select app.has_role('command'))));

create policy "The owner or command reads a ship's note" on public.ship_notes
  for select to authenticated
  using (
    (select app.has_role('command'))
    or exists (select 1 from public.ships s where s.id = ship_notes.ship_id and s.owner_id = (select auth.uid()))
  );
create policy "The owner or command writes a ship's note" on public.ship_notes
  for insert to authenticated
  with check (
    (select app.has_role('command'))
    or exists (select 1 from public.ships s where s.id = ship_notes.ship_id and s.owner_id = (select auth.uid()))
  );
create policy "The owner or command changes a ship's note" on public.ship_notes
  for update to authenticated
  using (
    (select app.has_role('command'))
    or exists (select 1 from public.ships s where s.id = ship_notes.ship_id and s.owner_id = (select auth.uid()))
  )
  with check (
    (select app.has_role('command'))
    or exists (select 1 from public.ships s where s.id = ship_notes.ship_id and s.owner_id = (select auth.uid()))
  );
create policy "The owner or command removes a ship's note" on public.ship_notes
  for delete to authenticated
  using (
    (select app.has_role('command'))
    or exists (select 1 from public.ships s where s.id = ship_notes.ship_id and s.owner_id = (select auth.uid()))
  );

create policy "An event's offers are seen with it" on public.event_ship_offers
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_ship_offers.event_id));
create policy "An attending owner offers a ship" on public.event_ship_offers
  for insert to authenticated with check ((select app.is_serving()));
create policy "Whoever offered a ship withdraws it, or command does" on public.event_ship_offers
  for delete to authenticated
  using ((select app.is_serving()) and (member_id = (select auth.uid()) or (select app.has_role('command'))));
