-- UEE 9th Fleet: operations.
--
-- An event is one training or operation night. Around it sit its orders, the
-- roll of who is attending, the stand-ins for posts left empty on the night,
-- the attendance return and the after-action report. The cycle is the
-- roadmap's: a warning order, a roll that closes 24 hours out, the commander
-- filling the gaps, and a report within 48 hours.
--
-- Everything here is for the serving fleet. A visitor or an applicant can read
-- none of it: the place, time and aim of an operation are not public.
--
-- Who does what:
--   command creates any event, and an instructor creates training;
--   whoever runs an event keeps its orders, places stand-ins and makes the
--   attendance return and the after-action report. That is its operation
--   commander, its second-in-command, or command;
--   the return is seen by whoever ran the event, by staff, and by each member
--   for their own line only;
--   a member replies for themselves, until the roll closes;
--   an attending member with no post of their own may stand in for an empty
--   entry post. Leadership and key posts are filled by whoever runs the event.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

-- The operation types in the roadmap.
create type public.event_kind as enum ('training', 'patrol', 'response', 'strike', 'tasked_pve');
create type public.event_state as enum ('draft', 'announced', 'done', 'cancelled');
-- Hold: self-defence only. Tight: identified hostiles only. Free.
create type public.weapons_state as enum ('hold', 'tight', 'free');
create type public.attendance_reply as enum ('attending', 'not_attending');
create type public.attendance_return as enum ('present', 'absent_with_notice', 'absent_without_notice');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Times are kept in UTC, which is the time the fleet's orders use.
create table public.events (
  id uuid primary key default gen_random_uuid(),
  kind public.event_kind not null,
  title text not null check (char_length(title) between 3 and 80),
  summary text not null default '' check (char_length(summary) <= 200),
  starts_at timestamptz not null,
  duration_minutes smallint not null default 120 check (duration_minutes between 15 and 480),
  commander_id uuid references public.members (id) on delete set null,
  second_id uuid references public.members (id) on delete set null,
  -- An instructor who watches and debriefs on training and assessed operations.
  observer_id uuid references public.members (id) on delete set null,
  weapons_state public.weapons_state,
  -- Every operation against players carries something to do if nobody shows.
  pve_fallback text not null default '' check (char_length(pve_fallback) <= 200),
  state public.event_state not null default 'draft',
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  announced_at timestamptz,
  -- When members can no longer change their reply. Set by the database.
  roll_closes_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint events_title_tidy check (title !~ '(^\s|\s$)'),
  constraint events_second_differs check (second_id is null or second_id is distinct from commander_id)
);
create index events_starts_idx on public.events (starts_at);

-- The warning order, and the operation order in its five paragraphs. One row
-- for each event, made with the event.
create table public.event_orders (
  event_id uuid primary key references public.events (id) on delete cascade,
  warning_order text not null default '' check (char_length(warning_order) <= 4000),
  situation text not null default '' check (char_length(situation) <= 4000),
  mission text not null default '' check (char_length(mission) <= 1000),
  execution text not null default '' check (char_length(execution) <= 4000),
  support text not null default '' check (char_length(support) <= 4000),
  command_and_signal text not null default '' check (char_length(command_and_signal) <= 4000),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- The roll. One row for each member for each event, holding two things:
--   the member's own reply, given before the roll closes;
--   a post they stand in for on the night, if any.
-- The whole fleet reads it, because that is how the gaps are seen and filled.
create table public.attendance (
  event_id uuid not null references public.events (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  reply public.attendance_reply,
  replied_at timestamptz,
  stand_in_position_id uuid references public.positions (id) on delete set null,
  stand_in_set_by uuid references public.members (id) on delete set null,
  primary key (event_id, member_id)
);
-- One stand-in for each post on the night.
create unique index attendance_one_stand_in_per_post on public.attendance (event_id, stand_in_position_id)
  where stand_in_position_id is not null;
create index attendance_member_idx on public.attendance (member_id);

-- The attendance return: who was there, as whoever ran the event recorded it.
-- It feeds activity records, so it is kept apart from the roll and is not for
-- the whole fleet: a member sees their own line, and staff and whoever ran the
-- event see them all.
create table public.attendance_returns (
  event_id uuid not null references public.events (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  returned public.attendance_return not null,
  returned_by uuid references public.members (id) on delete set null,
  returned_at timestamptz not null default now(),
  primary key (event_id, member_id)
);
create index attendance_returns_member_idx on public.attendance_returns (member_id);

-- The headings follow the hot debrief: what happened, what to keep and what to change.
create table public.after_action_reports (
  event_id uuid primary key references public.events (id) on delete cascade,
  author_id uuid references public.members (id) on delete set null,
  what_happened text not null check (char_length(what_happened) between 1 and 6000),
  to_keep text not null default '' check (char_length(to_keep) <= 4000),
  to_change text not null default '' check (char_length(to_change) <= 4000),
  filed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helpers used by the access rules
-- ---------------------------------------------------------------------------

create function app.is_serving_member(target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members
    where id = target and status in ('recruit', 'auxiliary', 'member', 'reserve')
  );
$$;

-- Command creates any event. An instructor creates training.
create function app.may_create_event(wanted public.event_kind) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_role('command') or (wanted = 'training' and app.has_role('instructor'));
$$;

-- Whoever runs an event: its operation commander, its second-in-command, or command.
create function app.runs_event(target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_role('command') or (
    app.is_serving() and exists (
      select 1 from public.events e
      where e.id = target and (select auth.uid()) in (e.commander_id, e.second_id)
    )
  );
$$;

-- Whoever may write an event's orders: whoever runs it, and the person who
-- drafted it until it is announced.
create function app.edits_event(target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.runs_event(target) or (
    app.is_serving() and exists (
      select 1 from public.events e
      where e.id = target and e.state = 'draft' and e.created_by = (select auth.uid())
    )
  );
$$;

-- The stage at which a position can first be filled: no earlier than its unit
-- or any unit above that.
create function app.position_opens_at(target uuid) returns smallint
language sql stable security definer set search_path = ''
as $$
  with recursive above as (
    select u.id, u.parent_id, u.opens_at_stage
    from public.units u
    join public.positions p on p.unit_id = u.id
    where p.id = target
    union
    select u.id, u.parent_id, u.opens_at_stage from public.units u join above on u.id = above.parent_id
  )
  select greatest((select opens_at_stage from public.positions where id = target), max(above.opens_at_stage))::smallint
  from above;
$$;

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

-- An event starts as a draft, is announced, and ends done or cancelled.
-- The database stamps who drafted it and when it was announced, and works out
-- when the roll closes: 24 hours before the start, or at the start if it was
-- announced with less than 24 hours to go.
create function app.guard_event() returns trigger
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
    else
      new.created_by := old.created_by;
      new.announced_at := old.announced_at;
      if old.state in ('done', 'cancelled') then
        raise exception 'This event is closed.' using errcode = '23514';
      end if;
      if new.kind is distinct from old.kind and not app.may_create_event(new.kind) then
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

create trigger events_guard before insert or update on public.events
  for each row execute function app.guard_event();

-- Every event has one row of orders from the moment it is drafted.
create function app.make_event_orders() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.event_orders (event_id, updated_by) values (new.id, new.created_by);
  return new;
end;
$$;

create trigger events_make_orders after insert on public.events
  for each row execute function app.make_event_orders();

-- Orders are stamped with who last wrote them, and are fixed once the event
-- is done or cancelled.
create function app.guard_event_orders() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.event_id is distinct from old.event_id then
    raise exception 'Orders cannot be moved to another event.' using errcode = '42501';
  end if;
  if app.is_trusted_context() then
    return new;
  end if;
  if exists (select 1 from public.events e where e.id = new.event_id and e.state in ('done', 'cancelled')) then
    raise exception 'This event is closed.' using errcode = '23514';
  end if;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;

create trigger event_orders_guard before update on public.event_orders
  for each row execute function app.guard_event_orders();

-- ---------------------------------------------------------------------------
-- The roll
-- ---------------------------------------------------------------------------

-- One row holds two things, each with its own rule.
--
-- The reply is the member's own. It can change until the roll closes and
-- cannot be taken back, only changed.
--
-- A stand-in fills a post that is empty on the night. A post is empty if
-- nobody holds it, if its holder has said they are not attending, if its
-- holder has been moved to another post for the night, or if the roll has
-- closed and its holder never replied.
--   An attending member with no post of their own may take an empty entry post.
--   Whoever runs the event may place any attending member in any post whose
--   holder is not in it. That is how leadership and key posts are filled: a
--   member steps up for the night, and someone else fills the post they left.
create function app.guard_attendance() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  event public.events%rowtype;
  post public.positions%rowtype;
  runs boolean;
  mine boolean;
  was_reply public.attendance_reply := case when tg_op = 'UPDATE' then old.reply end;
  was_stand_in uuid := case when tg_op = 'UPDATE' then old.stand_in_position_id end;
  holder uuid;
  holder_reply public.attendance_reply;
  holder_elsewhere uuid;
begin
  if tg_op = 'UPDATE' and (new.event_id is distinct from old.event_id or new.member_id is distinct from old.member_id) then
    raise exception 'A reply cannot be moved to another event or member.' using errcode = '42501';
  end if;
  if app.is_trusted_context() then
    return new;
  end if;
  -- Refused first, so that nothing below can tell an outsider anything.
  if not app.is_serving() then
    raise exception 'The roll is for serving members.' using errcode = '42501';
  end if;

  select * into event from public.events where id = new.event_id;
  if event.id is null or event.state = 'draft' then
    raise exception 'This event has not been announced.' using errcode = '23514';
  end if;
  if event.state = 'cancelled' then
    raise exception 'This event was cancelled.' using errcode = '23514';
  end if;
  if not app.is_serving_member(new.member_id) then
    raise exception 'The roll is for serving members.' using errcode = '23514';
  end if;
  runs := app.runs_event(new.event_id);
  mine := new.member_id = me;

  -- The reply.
  if new.reply is distinct from was_reply then
    if not mine then
      raise exception 'Only the member can reply for themselves.' using errcode = '42501';
    end if;
    if new.reply is null then
      raise exception 'A reply cannot be taken back, only changed.' using errcode = '23514';
    end if;
    if event.state <> 'announced' or now() >= event.roll_closes_at then
      raise exception 'The roll has closed. Tell the operation commander if your plans change.'
        using errcode = '23514';
    end if;
    new.replied_at := now();
    -- Someone who is no longer attending cannot stand in.
    if new.reply = 'not_attending' then
      new.stand_in_position_id := null;
    end if;
  elsif tg_op = 'UPDATE' then
    new.replied_at := old.replied_at;
  else
    new.replied_at := null;
  end if;

  -- Standing in.
  if new.stand_in_position_id is distinct from was_stand_in then
    if event.state <> 'announced' then
      raise exception 'This event is closed.' using errcode = '23514';
    end if;
    if not (mine or runs) then
      raise exception 'Only the operation commander places someone else in a post.' using errcode = '42501';
    end if;
    if new.stand_in_position_id is not null then
      if new.reply is distinct from 'attending' then
        raise exception 'Only a member who is attending can stand in.' using errcode = '23514';
      end if;
      select * into post from public.positions where id = new.stand_in_position_id;
      if post.id is null or post.kind <> 'primary' then
        raise exception 'A stand-in fills a primary post.' using errcode = '23514';
      end if;
      if app.position_opens_at(post.id) > (select current_stage from public.fleet_settings) then
        raise exception 'That post is not open yet.' using errcode = '23514';
      end if;

      select a.member_id into holder from public.assignments a
      where a.position_id = post.id and a.kind = 'primary' and a.ended_on is null;
      if holder = new.member_id then
        raise exception 'That is the member''s own post.' using errcode = '23514';
      end if;
      -- A holder who has been moved to another post for the night has left this one empty.
      select t.reply, t.stand_in_position_id into holder_reply, holder_elsewhere from public.attendance t
      where t.event_id = new.event_id and t.member_id = holder;
      if holder is not null and holder_reply = 'attending' and holder_elsewhere is null then
        raise exception 'The holder of that post is attending.' using errcode = '23514';
      end if;

      if not runs then
        if not post.is_entry then
          raise exception 'The operation commander fills this post.' using errcode = '42501';
        end if;
        if holder is not null and holder_reply is null and now() < event.roll_closes_at then
          raise exception 'The holder of that post has not replied. It opens to stand-ins when the roll closes.'
            using errcode = '23514';
        end if;
        if exists (
          select 1 from public.assignments a
          where a.member_id = new.member_id and a.kind = 'primary' and a.ended_on is null
        ) then
          raise exception 'You hold a post of your own. The operation commander can move you for the night.'
            using errcode = '23514';
        end if;
      end if;
    end if;
    new.stand_in_set_by := me;
  elsif tg_op = 'UPDATE' then
    new.stand_in_set_by := old.stand_in_set_by;
  else
    new.stand_in_set_by := null;
  end if;

  return new;
end;
$$;

create trigger attendance_guard before insert or update on public.attendance
  for each row execute function app.guard_attendance();

-- The attendance return is made by whoever ran the event, once it has started,
-- and is stamped with who made it and when. It can be corrected afterwards.
create function app.guard_attendance_return() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  event public.events%rowtype;
begin
  if tg_op = 'UPDATE' and (new.event_id is distinct from old.event_id or new.member_id is distinct from old.member_id) then
    raise exception 'A line of the return cannot be moved to another event or member.' using errcode = '42501';
  end if;
  if app.is_trusted_context() then
    return new;
  end if;
  -- Refused first, so that nothing below can tell an outsider anything.
  if not app.runs_event(new.event_id) then
    raise exception 'The attendance return is made by whoever ran the event.' using errcode = '42501';
  end if;

  select * into event from public.events where id = new.event_id;
  if event.state not in ('announced', 'done') then
    raise exception 'A return is made for an event that took place.' using errcode = '23514';
  end if;
  if now() < event.starts_at then
    raise exception 'The attendance return is made once the event has started.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and not app.is_serving_member(new.member_id) then
    raise exception 'The roll is for serving members.' using errcode = '23514';
  end if;

  new.returned_by := (select auth.uid());
  new.returned_at := now();
  return new;
end;
$$;

create trigger attendance_returns_guard before insert or update on public.attendance_returns
  for each row execute function app.guard_attendance_return();

-- ---------------------------------------------------------------------------
-- After-action reports
-- ---------------------------------------------------------------------------

-- Filed by whoever ran the event, once it has started. Stamped with who and when.
create function app.guard_after_action_report() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  event public.events%rowtype;
begin
  if tg_op = 'UPDATE' and new.event_id is distinct from old.event_id then
    raise exception 'A report cannot be moved to another event.' using errcode = '42501';
  end if;
  if app.is_trusted_context() then
    return new;
  end if;

  select * into event from public.events where id = new.event_id;
  if event.id is null or event.state not in ('announced', 'done') then
    raise exception 'A report is filed for an event that took place.' using errcode = '23514';
  end if;
  if now() < event.starts_at then
    raise exception 'A report is filed once the event has started.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.author_id := (select auth.uid());
    new.filed_at := now();
  else
    new.author_id := old.author_id;
    new.filed_at := old.filed_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger after_action_reports_guard before insert or update on public.after_action_reports
  for each row execute function app.guard_after_action_report();

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create trigger events_audit after insert or update or delete on public.events
  for each row execute function app.audit();
create trigger event_orders_audit after update on public.event_orders
  for each row execute function app.audit();
create trigger attendance_audit after insert or update or delete on public.attendance
  for each row execute function app.audit();
create trigger attendance_returns_audit after insert or update or delete on public.attendance_returns
  for each row execute function app.audit();
create trigger after_action_reports_audit after insert or update or delete on public.after_action_reports
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

-- Only the helpers the access rules call. The others run inside the triggers.
grant execute on function
  app.may_create_event(public.event_kind), app.runs_event(uuid), app.edits_event(uuid)
to authenticated, service_role;

grant all on
  public.events, public.event_orders, public.attendance, public.attendance_returns, public.after_action_reports
to service_role;

grant select on
  public.events, public.event_orders, public.attendance, public.attendance_returns, public.after_action_reports
to authenticated;

-- Writes are granted column by column. Who drafted an event, when it was
-- announced, when the roll closes and every signature are the database's.
grant insert (kind, title, summary, starts_at, duration_minutes, commander_id, second_id, observer_id,
              weapons_state, pve_fallback)
  on public.events to authenticated;
grant update (kind, title, summary, starts_at, duration_minutes, commander_id, second_id, observer_id,
              weapons_state, pve_fallback, state)
  on public.events to authenticated;
grant delete on public.events to authenticated;

grant update (warning_order, situation, mission, execution, support, command_and_signal)
  on public.event_orders to authenticated;

grant insert (event_id, member_id, reply, stand_in_position_id) on public.attendance to authenticated;
grant update (reply, stand_in_position_id) on public.attendance to authenticated;

grant insert (event_id, member_id, returned) on public.attendance_returns to authenticated;
grant update (returned) on public.attendance_returns to authenticated;

grant insert (event_id, what_happened, to_keep, to_change) on public.after_action_reports to authenticated;
grant update (what_happened, to_keep, to_change) on public.after_action_reports to authenticated;

-- Only an admin's rule lets these through.
grant delete on public.attendance, public.attendance_returns, public.after_action_reports to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.events enable row level security;
alter table public.event_orders enable row level security;
alter table public.attendance enable row level security;
alter table public.attendance_returns enable row level security;
alter table public.after_action_reports enable row level security;

-- A draft is seen only by the people working on it.
create policy "The fleet sees announced events, and drafts are for those writing them" on public.events
  for select to authenticated
  using (
    (select app.is_serving())
    and (
      state <> 'draft'
      or created_by = (select auth.uid())
      or commander_id = (select auth.uid())
      or (select app.has_role('command'))
    )
  );
create policy "Command drafts any event, and instructors draft training" on public.events
  for insert to authenticated
  with check ((select app.may_create_event(kind)) and state = 'draft');
create policy "Whoever runs an event changes it, and its author while it is a draft" on public.events
  for update to authenticated
  using (
    (select app.has_role('command'))
    or ((select app.is_serving()) and (select auth.uid()) in (commander_id, second_id))
    or ((select app.is_serving()) and state = 'draft' and created_by = (select auth.uid()))
  )
  with check (
    (select app.has_role('command'))
    or ((select app.is_serving()) and (select auth.uid()) in (commander_id, second_id, created_by))
  );
-- An announced event is cancelled, not deleted, so the record stays.
create policy "A draft can be deleted by its author or command, and anything by an admin" on public.events
  for delete to authenticated
  using (
    (select app.has_role('admin'))
    or (state = 'draft' and ((select app.has_role('command')) or created_by = (select auth.uid())))
  );

-- Orders, the roll and the report are seen by whoever can see the event.
create policy "Orders are seen with their event" on public.event_orders
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_orders.event_id));
create policy "Whoever runs an event writes its orders" on public.event_orders
  for update to authenticated
  using (app.edits_event(event_id)) with check (app.edits_event(event_id));

create policy "The roll is seen with its event" on public.attendance
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = attendance.event_id));
create policy "Reply for yourself, or keep the roll as whoever runs the event" on public.attendance
  for insert to authenticated
  with check ((select app.is_serving()) and (member_id = (select auth.uid()) or app.runs_event(event_id)));
create policy "Change your own line, or any as whoever runs the event" on public.attendance
  for update to authenticated
  using ((select app.is_serving()) and (member_id = (select auth.uid()) or app.runs_event(event_id)))
  with check ((select app.is_serving()) and (member_id = (select auth.uid()) or app.runs_event(event_id)));
create policy "Admins delete a line of the roll made by mistake" on public.attendance
  for delete to authenticated using ((select app.has_role('admin')));

-- Who was marked absent is not for the whole fleet.
create policy "See your own line of a return, or all of it as staff or whoever ran the event" on public.attendance_returns
  for select to authenticated
  using (
    ((select app.is_serving()) and member_id = (select auth.uid()))
    or (select app.is_staff())
    or app.runs_event(event_id)
  );
create policy "Whoever ran an event makes its return" on public.attendance_returns
  for insert to authenticated with check (app.runs_event(event_id));
create policy "Whoever ran an event corrects its return" on public.attendance_returns
  for update to authenticated
  using (app.runs_event(event_id)) with check (app.runs_event(event_id));
create policy "Admins delete a line of a return made by mistake" on public.attendance_returns
  for delete to authenticated using ((select app.has_role('admin')));

create policy "Reports are seen with their event" on public.after_action_reports
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = after_action_reports.event_id));
create policy "Whoever ran an event files its report" on public.after_action_reports
  for insert to authenticated with check (app.runs_event(event_id));
create policy "Whoever ran an event corrects its report" on public.after_action_reports
  for update to authenticated
  using (app.runs_event(event_id)) with check (app.runs_event(event_id));
create policy "Admins delete a report filed by mistake" on public.after_action_reports
  for delete to authenticated using ((select app.has_role('admin')));
