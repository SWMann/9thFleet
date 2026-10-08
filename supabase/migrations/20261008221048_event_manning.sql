-- Who takes part in an event.
--
-- Until now every open post in the fleet was on every event's roll, and any
-- serving member could reply. An event can now say:
--   which units take part, so the roll shows only their posts;
--   extra posts for that one night, each with a role;
--   which posts must be filled, and how many must attend, for it to go ahead;
--   who it is open to: recruits or not, one service, holders of a qualification;
--   how many places it has. Replies past that go on a reserve list in the
--   order they arrive, and a place that opens goes to the first on the list.
--
-- Whether an event goes ahead is still the operation commander's decision. The
-- database keeps the numbers. The site works out go or no-go from them.

-- ---------------------------------------------------------------------------
-- What an event says about who takes part
-- ---------------------------------------------------------------------------

alter table public.events
  add column open_to_recruits boolean not null default true,
  -- Empty means every service.
  add column open_to_service public.service,
  add column requires_qualification_id uuid references public.qualifications (id) on delete set null,
  -- How many can attend. Empty means no limit.
  add column places smallint check (places between 1 and 500),
  -- How many must attend for the event to go ahead. Empty means no minimum.
  add column minimum_attending smallint check (minimum_attending between 1 and 500);

-- The units that take part. With none chosen, every open unit does. A unit
-- brings everything under it: a ship brings its departments.
create table public.event_units (
  event_id uuid not null references public.events (id) on delete cascade,
  unit_id uuid not null references public.units (id) on delete cascade,
  primary key (event_id, unit_id)
);

-- Posts that must be filled for the event to go ahead.
create table public.event_key_posts (
  event_id uuid not null references public.events (id) on delete cascade,
  position_id uuid not null references public.positions (id) on delete cascade,
  primary key (event_id, position_id)
);

-- Posts that exist for one night: a range safety officer, an umpire, a trainee.
create table public.event_posts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 80),
  -- The role it is, which says what it does and what to read.
  role_id uuid references public.fleet_roles (id) on delete set null,
  must_fill boolean not null default false,
  -- An attending member with no post of their own on the night may take it.
  -- Otherwise whoever runs the event fills it.
  open_to_volunteers boolean not null default false,
  sort_order integer not null default 0,
  constraint event_posts_title_tidy check (title !~ '(^\s|\s$)'),
  unique (event_id, title)
);
create index event_posts_event_idx on public.event_posts (event_id);

-- A member's line on the roll now also says whether they have a place, and
-- which extra post they fill, if any.
create type public.attendance_place as enum ('in', 'reserve');

alter table public.attendance
  add column place public.attendance_place,
  add column event_post_id uuid references public.event_posts (id) on delete set null;

update public.attendance set place = 'in' where reply = 'attending';

alter table public.attendance
  -- Someone attending has a place or is on the reserve list. Nobody else is either.
  add constraint attendance_place_with_reply check ((place is not null) = (reply is not distinct from 'attending')),
  -- A member fills one post for the night.
  add constraint attendance_one_post check (stand_in_position_id is null or event_post_id is null);
create unique index attendance_one_member_per_extra_post on public.attendance (event_id, event_post_id)
  where event_post_id is not null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Whether a position is part of an event: always, unless the event names its
-- units, and then only if the position sits in one of them or under one.
create function app.event_includes_position(event uuid, target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (select 1 from public.event_units eu where eu.event_id = event)
    or exists (
      with recursive above as (
        select u.id, u.parent_id
        from public.units u
        join public.positions p on p.unit_id = u.id
        where p.id = target
        union
        select u.id, u.parent_id from public.units u join above on u.id = above.parent_id
      )
      select 1 from above join public.event_units eu on eu.unit_id = above.id where eu.event_id = event
    );
$$;

-- Give the places that are free to the reserve list, in the order of reply.
create function app.give_places(target uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  event public.events%rowtype;
  next_member uuid;
begin
  select * into event from public.events where id = target for update;
  if event.id is null or event.state <> 'announced' then
    return;
  end if;
  loop
    exit when event.places is not null and (
      select count(*) from public.attendance t where t.event_id = target and t.place = 'in'
    ) >= event.places;
    select t.member_id into next_member
    from public.attendance t
    where t.event_id = target and t.place = 'reserve'
    order by t.replied_at, t.member_id
    limit 1;
    exit when next_member is null;
    update public.attendance set place = 'in' where event_id = target and member_id = next_member;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- The roll, again
-- ---------------------------------------------------------------------------

-- The rule on the roll, as it was, with these changes:
--   a reply of attending is refused to someone the event is not open to;
--   an attending member has a place, or is on the reserve list;
--   whoever runs the event may move someone on or off the reserve list;
--   a stand-in fills a post that is part of the event;
--   an extra post is filled the same way a real one is;
--   what the database changes by itself is let through.
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

-- When someone with a place drops out, the place goes to the first on the
-- reserve list. Someone the operation commander moves to the reserve list does
-- not set this off: who takes that place is the commander's to say.
create function app.pass_on_place() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.place = 'in' then
      perform app.give_places(old.event_id);
    end if;
    return old;
  end if;
  if old.place = 'in' and new.place is null then
    perform app.give_places(new.event_id);
  end if;
  return new;
end;
$$;

create trigger attendance_pass_on_place after update or delete on public.attendance
  for each row execute function app.pass_on_place();

-- More places, or no limit, lets the reserve list in.
create function app.open_more_places() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.places is distinct from old.places then
    perform app.give_places(new.id);
  end if;
  return new;
end;
$$;

create trigger events_open_more_places after update of places on public.events
  for each row execute function app.open_more_places();

-- ---------------------------------------------------------------------------
-- The parts of an event that say who takes part
-- ---------------------------------------------------------------------------

-- They are fixed once the event is done or cancelled, and cannot be moved to
-- another event. What goes when an event, a unit or a post is removed is the
-- database's own doing.
create function app.guard_event_part() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  target uuid := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
begin
  if tg_op = 'UPDATE' and new.event_id is distinct from old.event_id then
    raise exception 'This cannot be moved to another event.' using errcode = '42501';
  end if;
  if not app.is_trusted_context() and pg_trigger_depth() = 1
     and exists (select 1 from public.events e where e.id = target and e.state in ('done', 'cancelled')) then
    raise exception 'This event is closed.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger event_units_guard before insert or update or delete on public.event_units
  for each row execute function app.guard_event_part();
create trigger event_key_posts_guard before insert or update or delete on public.event_key_posts
  for each row execute function app.guard_event_part();
create trigger event_posts_guard before insert or update or delete on public.event_posts
  for each row execute function app.guard_event_part();

-- ---------------------------------------------------------------------------
-- Copies and repeats carry all of it
-- ---------------------------------------------------------------------------

-- A copy starts with the units, the posts that must be filled and the extra
-- posts of the event it was copied from. Nobody is placed in them.
create function app.copy_event_parts() returns trigger
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
  return new;
end;
$$;

create trigger events_copy_parts after insert on public.events
  for each row execute function app.copy_event_parts();

-- Next week's event, as it was, now with who the event is open to.
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
       open_to_recruits, open_to_service, requires_qualification_id, places, minimum_attending)
    values
      (new.kind, app.next_title(new.title), new.summary, next_start, new.duration_minutes,
       case when app.is_serving_member(new.commander_id) then new.commander_id else closer end,
       case when app.is_serving_member(new.second_id) then new.second_id end,
       case when app.is_serving_member(new.observer_id) then new.observer_id end,
       new.weapons_state, new.pve_fallback, true, new.id, coalesce(closer, new.created_by),
       new.open_to_recruits, new.open_to_service, new.requires_qualification_id, new.places, new.minimum_attending);
  exception when others then
    raise warning 'Next week''s event was not drafted: %', sqlerrm;
  end;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create trigger event_units_audit after insert or update or delete on public.event_units
  for each row execute function app.audit();
create trigger event_key_posts_audit after insert or update or delete on public.event_key_posts
  for each row execute function app.audit();
create trigger event_posts_audit after insert or update or delete on public.event_posts
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant all on public.event_units, public.event_key_posts, public.event_posts to service_role;
grant select, insert, delete on public.event_units, public.event_key_posts to authenticated;
grant select, delete on public.event_posts to authenticated;
grant insert (event_id, title, role_id, must_fill, open_to_volunteers, sort_order) on public.event_posts to authenticated;
grant update (title, role_id, must_fill, open_to_volunteers, sort_order) on public.event_posts to authenticated;

grant insert (open_to_recruits, open_to_service, requires_qualification_id, places, minimum_attending)
  on public.events to authenticated;
grant update (open_to_recruits, open_to_service, requires_qualification_id, places, minimum_attending)
  on public.events to authenticated;

-- Where a member stands is the database's to say when they reply. Whoever runs
-- the event may change it afterwards, which the rule on the roll checks.
grant insert (event_post_id) on public.attendance to authenticated;
grant update (event_post_id, place) on public.attendance to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.event_units enable row level security;
alter table public.event_key_posts enable row level security;
alter table public.event_posts enable row level security;

-- Each is seen by whoever can see its event, and kept by whoever may write the
-- event's orders: whoever runs it, and its author while it is a draft.
create policy "An event's units are seen with it" on public.event_units
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_units.event_id));
create policy "Whoever runs an event names its units" on public.event_units
  for insert to authenticated with check (app.edits_event(event_id));
create policy "Whoever runs an event takes a unit out" on public.event_units
  for delete to authenticated using (app.edits_event(event_id));

create policy "An event's key posts are seen with it" on public.event_key_posts
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_key_posts.event_id));
create policy "Whoever runs an event says which posts must be filled" on public.event_key_posts
  for insert to authenticated with check (app.edits_event(event_id));
create policy "Whoever runs an event takes a key post off" on public.event_key_posts
  for delete to authenticated using (app.edits_event(event_id));

create policy "An event's extra posts are seen with it" on public.event_posts
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_posts.event_id));
create policy "Whoever runs an event adds its extra posts" on public.event_posts
  for insert to authenticated with check (app.edits_event(event_id));
create policy "Whoever runs an event changes its extra posts" on public.event_posts
  for update to authenticated
  using (app.edits_event(event_id)) with check (app.edits_event(event_id));
create policy "Whoever runs an event removes its extra posts" on public.event_posts
  for delete to authenticated using (app.edits_event(event_id));
