-- An opposing force, and command's approval.
--
-- An exercise can have an opposing force: a plan of its own, and a roll of who
-- is on it. Command sets it up. Command and the members on it can read it, and
-- whoever leads it can write its plan. Nobody else can, and that includes the
-- event's own commander: the side being exercised sees neither the plan nor
-- who is against them.
--
-- A type of event can need command's approval. A draft of that type by someone
-- who is not command cannot be announced until command has approved it.

-- ---------------------------------------------------------------------------
-- Approval
-- ---------------------------------------------------------------------------

alter table public.event_types
  -- A draft of this type by someone who is not command waits for command's approval.
  add column needs_approval boolean not null default false;

create type public.event_approval as enum ('not_asked', 'asked', 'approved');

alter table public.events
  add column approval public.event_approval not null default 'not_asked',
  add column approved_by uuid references public.members (id) on delete set null,
  add column approved_at timestamptz;

-- The event rule, as it was, with approval: only command approves, the
-- database signs and dates it, and a type that needs approval is not announced
-- without it by anyone who is not command.
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
      new.approval := 'not_asked';
      new.approved_by := null;
      new.approved_at := null;
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
      new.approved_by := old.approved_by;
      new.approved_at := old.approved_at;
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
      -- Approval. Command gives it. Whoever is drafting asks for it, or takes the request back.
      if new.approval is distinct from old.approval then
        if old.state <> 'draft' then
          raise exception 'Approval is for a draft.' using errcode = '23514';
        end if;
        if new.approval = 'approved' then
          if not app.has_role('command') then
            raise exception 'Only command approves an event.' using errcode = '42501';
          end if;
          new.approved_by := (select auth.uid());
          new.approved_at := now();
        else
          if old.approval = 'approved' and not app.has_role('command') then
            raise exception 'Command has approved this event. Only command takes that back.' using errcode = '42501';
          end if;
          new.approved_by := null;
          new.approved_at := null;
        end if;
      elsif old.approval = 'approved' and new.kind is distinct from old.kind and not app.has_role('command') then
        -- What command approved was a different type of event.
        new.approval := 'not_asked';
        new.approved_by := null;
        new.approved_at := null;
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
          if new.approval <> 'approved' and not app.has_role('command')
             and exists (select 1 from public.event_types t where t.key = new.kind and t.needs_approval) then
            raise exception 'This type of event needs command''s approval before it is announced.' using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- The opposing force
-- ---------------------------------------------------------------------------

create table public.event_opfor (
  event_id uuid primary key references public.events (id) on delete cascade,
  plan text not null default '' check (char_length(plan) <= 6000),
  updated_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.event_opfor_members (
  event_id uuid not null references public.events (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  -- Whoever leads the opposing force writes its plan.
  leads boolean not null default false,
  added_by uuid references public.members (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (event_id, member_id)
);
create index event_opfor_members_member_idx on public.event_opfor_members (member_id);

-- Whether the person asking is on an event's opposing force, and whether they lead it.
create function app.on_opfor(target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_serving() and exists (
    select 1 from public.event_opfor_members m where m.event_id = target and m.member_id = (select auth.uid())
  );
$$;

create function app.leads_opfor(target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_serving() and exists (
    select 1 from public.event_opfor_members m
    where m.event_id = target and m.member_id = (select auth.uid()) and m.leads
  );
$$;

-- The opposing force is fixed with the event when it closes. Its plan is
-- stamped with who last wrote it, and its roll with who named each member.
-- Whoever runs the event is on the other side, so is never on it.
create function app.guard_event_opfor() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  target uuid := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  event public.events%rowtype;
begin
  if tg_op = 'UPDATE' and new.event_id is distinct from old.event_id then
    raise exception 'This cannot be moved to another event.' using errcode = '42501';
  end if;
  -- Asked in two steps, because only one of the two tables has a member on each row.
  if tg_table_name = 'event_opfor_members' and tg_op = 'UPDATE' then
    if new.member_id is distinct from old.member_id then
      raise exception 'A place on the opposing force cannot be moved to another member.' using errcode = '42501';
    end if;
  end if;
  -- What goes with an event or a member that is removed, and what a copy brings, is the database's own doing.
  if app.is_trusted_context() or pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  select * into event from public.events where id = target;
  if event.state in ('done', 'cancelled') then
    raise exception 'This event is closed.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_table_name = 'event_opfor' then
    new.updated_by := (select auth.uid());
    new.updated_at := now();
  elsif tg_op = 'INSERT' then
    if not app.is_serving_member(new.member_id) then
      raise exception 'The opposing force is made up of serving members.' using errcode = '23514';
    end if;
    if new.member_id is not distinct from event.commander_id or new.member_id is not distinct from event.second_id then
      raise exception 'Whoever runs the event is not on its opposing force.' using errcode = '23514';
    end if;
    new.added_by := (select auth.uid());
    new.added_at := now();
  else
    new.added_by := old.added_by;
    new.added_at := old.added_at;
  end if;
  return new;
end;
$$;

create trigger event_opfor_guard before insert or update or delete on public.event_opfor
  for each row execute function app.guard_event_opfor();
create trigger event_opfor_members_guard before insert or update or delete on public.event_opfor_members
  for each row execute function app.guard_event_opfor();

-- Someone named to the opposing force comes off the roll, which gives up
-- their place and any post they had for the night.
create function app.leave_roll_for_opfor() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.attendance where event_id = new.event_id and member_id = new.member_id;
  return new;
end;
$$;

create trigger event_opfor_members_leave_roll after insert on public.event_opfor_members
  for each row execute function app.leave_roll_for_opfor();

-- The rule on the roll, as it was, with one more: someone on the opposing
-- force is not on it.
create or replace function app.guard_attendance() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  event public.events%rowtype;
  post public.positions%rowtype;
  extra public.event_posts%rowtype;
  who public.members%rowtype;
  runs boolean;
  mine boolean;
  named boolean;
  was_reply public.attendance_reply := case when tg_op = 'UPDATE' then old.reply end;
  was_stand_in uuid := case when tg_op = 'UPDATE' then old.stand_in_position_id end;
  was_extra uuid := case when tg_op = 'UPDATE' then old.event_post_id end;
  was_place public.attendance_place := case when tg_op = 'UPDATE' then old.place end;
  holder uuid;
  holder_line public.attendance%rowtype;
begin
  if tg_op = 'UPDATE' and (new.event_id is distinct from old.event_id or new.member_id is distinct from old.member_id) then
    raise exception 'A reply cannot be moved to another event or member.' using errcode = '42501';
  end if;
  if app.is_trusted_context() then
    -- A line written from the SQL editor still says where its member stands.
    if new.reply is distinct from 'attending' then
      new.place := null;
    elsif new.place is null then
      new.place := 'in';
    end if;
    return new;
  end if;
  -- The database's own changes come from inside another change: a post that is
  -- removed takes its stand-in with it, and a place that opens goes to the
  -- reserve list. Nobody can ask for those through the API.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.reply is not distinct from old.reply then
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
  -- Someone on the opposing force is not on the roll. Only they are told why:
  -- anyone else acting on their line gets the ordinary answers below.
  if mine and exists (
    select 1 from public.event_opfor_members m where m.event_id = new.event_id and m.member_id = new.member_id
  ) then
    raise exception 'You are on the opposing force for this event, so you are not on its roll.' using errcode = '23514';
  end if;
  -- Whoever is named to run the event or to observe it is always welcome, and always has a place.
  named := new.member_id is not distinct from event.commander_id
    or new.member_id is not distinct from event.second_id
    or new.member_id is not distinct from event.observer_id;

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
    if new.reply = 'not_attending' then
      -- Someone who is no longer attending gives up their place and any post for the night.
      new.stand_in_position_id := null;
      new.event_post_id := null;
      new.place := null;
    else
      -- Who the event is open to.
      if not named then
        select * into who from public.members where id = new.member_id;
        if not event.open_to_recruits and who.status = 'recruit' then
          raise exception 'This event is not open to recruits.' using errcode = '23514';
        end if;
        if event.open_to_service is not null and who.service is distinct from event.open_to_service then
          raise exception 'This event is for the %.',
            case event.open_to_service when 'navy' then 'Navy' when 'army' then 'Army' else 'Marines' end
            using errcode = '23514';
        end if;
        if event.requires_qualification_id is not null and not exists (
          select 1 from public.qualification_awards q
          where q.member_id = new.member_id and q.qualification_id = event.requires_qualification_id
        ) then
          raise exception 'This event needs the % qualification.',
            (select name from public.qualifications where id = event.requires_qualification_id)
            using errcode = '23514';
        end if;
      end if;

      -- A place, or the reserve list. One reply at a time for each event, so
      -- that places are given in the order replies arrive.
      if event.places is null or named then
        new.place := 'in';
      else
        perform 1 from public.events e where e.id = new.event_id for update;
        new.place := case
          when (
            select count(*) from public.attendance t
            where t.event_id = new.event_id and t.member_id <> new.member_id and t.place = 'in'
          ) < event.places then 'in'::public.attendance_place
          else 'reserve'::public.attendance_place
        end;
      end if;
    end if;
  else
    if tg_op = 'UPDATE' then
      new.replied_at := old.replied_at;
    else
      new.replied_at := null;
      new.place := null;
    end if;

    -- Whoever runs the event may move someone on or off the reserve list.
    if new.place is distinct from was_place then
      if not runs then
        raise exception 'Only the operation commander moves someone on or off the reserve list.'
          using errcode = '42501';
      end if;
      if event.state <> 'announced' then
        raise exception 'This event is closed.' using errcode = '23514';
      end if;
      if new.reply is distinct from 'attending' or new.place is null then
        raise exception 'Only a member who is attending has a place.' using errcode = '23514';
      end if;
      if new.place = 'reserve' then
        new.stand_in_position_id := null;
        new.event_post_id := null;
      end if;
    end if;
  end if;

  -- Standing in for a post of the order of battle.
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
      if new.place is distinct from 'in' then
        raise exception 'Someone on the reserve list has no post until a place opens.' using errcode = '23514';
      end if;
      select * into post from public.positions where id = new.stand_in_position_id;
      if post.id is null or post.kind <> 'primary' then
        raise exception 'A stand-in fills a primary post.' using errcode = '23514';
      end if;
      if app.position_opens_at(post.id) > (select current_stage from public.fleet_settings) then
        raise exception 'That post is not open yet.' using errcode = '23514';
      end if;
      if not app.event_includes_position(new.event_id, post.id) then
        raise exception 'That post is not part of this event.' using errcode = '23514';
      end if;

      select a.member_id into holder from public.assignments a
      where a.position_id = post.id and a.kind = 'primary' and a.ended_on is null;
      if holder = new.member_id then
        raise exception 'That is the member''s own post.' using errcode = '23514';
      end if;
      -- A holder who is on the reserve list, or who has been moved to another
      -- post for the night, has left this one empty.
      select * into holder_line from public.attendance t
      where t.event_id = new.event_id and t.member_id = holder;
      if holder is not null and holder_line.place = 'in'
         and holder_line.stand_in_position_id is null and holder_line.event_post_id is null then
        raise exception 'The holder of that post is attending.' using errcode = '23514';
      end if;

      if not runs then
        if not post.is_entry then
          raise exception 'The operation commander fills this post.' using errcode = '42501';
        end if;
        if holder is not null and holder_line.reply is null and now() < event.roll_closes_at then
          raise exception 'The holder of that post has not replied. It opens to stand-ins when the roll closes.'
            using errcode = '23514';
        end if;
      end if;
    end if;
  end if;

  -- Filling a post that exists for this night only.
  if new.event_post_id is distinct from was_extra then
    if event.state <> 'announced' then
      raise exception 'This event is closed.' using errcode = '23514';
    end if;
    if not (mine or runs) then
      raise exception 'Only the operation commander places someone else in a post.' using errcode = '42501';
    end if;
    if new.event_post_id is not null then
      if new.reply is distinct from 'attending' then
        raise exception 'Only a member who is attending can fill a post.' using errcode = '23514';
      end if;
      if new.place is distinct from 'in' then
        raise exception 'Someone on the reserve list has no post until a place opens.' using errcode = '23514';
      end if;
      select * into extra from public.event_posts where id = new.event_post_id;
      if extra.id is null or extra.event_id <> new.event_id then
        raise exception 'That post is not part of this event.' using errcode = '23514';
      end if;
      if not runs and not extra.open_to_volunteers then
        raise exception 'The operation commander fills this post.' using errcode = '42501';
      end if;
    end if;
  end if;

  -- A member who takes a post themselves has none of their own on the night.
  -- A post in a unit that is not taking part does not count.
  if not runs and (
    (new.stand_in_position_id is not null and new.stand_in_position_id is distinct from was_stand_in)
    or (new.event_post_id is not null and new.event_post_id is distinct from was_extra)
  ) and exists (
    select 1 from public.assignments a
    where a.member_id = new.member_id and a.kind = 'primary' and a.ended_on is null
      and app.event_includes_position(new.event_id, a.position_id)
  ) then
    raise exception 'You hold a post of your own. The operation commander can move you for the night.'
      using errcode = '23514';
  end if;

  if new.stand_in_position_id is distinct from was_stand_in or new.event_post_id is distinct from was_extra then
    new.stand_in_set_by := me;
  elsif tg_op = 'UPDATE' then
    new.stand_in_set_by := old.stand_in_set_by;
  else
    new.stand_in_set_by := null;
  end if;

  return new;
end;
$$;

-- A copy also brings the opposing force, when the person copying may see it.
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

create trigger event_opfor_audit after insert or update or delete on public.event_opfor
  for each row execute function app.audit();
create trigger event_opfor_members_audit after insert or update or delete on public.event_opfor_members
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant execute on function app.on_opfor(uuid), app.leads_opfor(uuid) to authenticated, service_role;

-- Asking for approval, and giving it, is a change to this one field. Who
-- approved and when are the database's.
grant update (approval) on public.events to authenticated;

grant all on public.event_opfor, public.event_opfor_members to service_role;
grant select, delete on public.event_opfor, public.event_opfor_members to authenticated;
grant insert (event_id, plan) on public.event_opfor to authenticated;
grant update (plan) on public.event_opfor to authenticated;
grant insert (event_id, member_id, leads) on public.event_opfor_members to authenticated;
grant update (leads) on public.event_opfor_members to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.event_opfor enable row level security;
alter table public.event_opfor_members enable row level security;

-- Command and the opposing force read it. Nobody on the other side does.
create policy "Command and the opposing force read its plan" on public.event_opfor
  for select to authenticated
  using ((select app.has_role('command')) or app.on_opfor(event_id));
create policy "Command or whoever leads the opposing force starts its plan" on public.event_opfor
  for insert to authenticated
  with check ((select app.has_role('command')) or app.leads_opfor(event_id));
create policy "Command or whoever leads the opposing force writes its plan" on public.event_opfor
  for update to authenticated
  using ((select app.has_role('command')) or app.leads_opfor(event_id))
  with check ((select app.has_role('command')) or app.leads_opfor(event_id));
create policy "Command removes an opposing force's plan" on public.event_opfor
  for delete to authenticated using ((select app.has_role('command')));

create policy "Command and the opposing force read who is on it" on public.event_opfor_members
  for select to authenticated
  using ((select app.has_role('command')) or app.on_opfor(event_id));
create policy "Command names the opposing force" on public.event_opfor_members
  for insert to authenticated with check ((select app.has_role('command')));
create policy "Command says who leads the opposing force" on public.event_opfor_members
  for update to authenticated
  using ((select app.has_role('command'))) with check ((select app.has_role('command')));
create policy "Command takes a member off the opposing force" on public.event_opfor_members
  for delete to authenticated using ((select app.has_role('command')));
