-- The hostile list
--
-- The rules of engagement name two kinds of player who may be engaged:
-- organisations command has declared hostile, and individuals who are on the
-- database with evidence. This is that list.
--
--   Any serving member puts a name forward, with what happened and where to
--   see it. Nothing is on the list until command says so. A member has five
--   names waiting at most, and a name command declined waits 30 days before
--   anyone but command can put it forward again.
--   Command lists a name as hostile, or puts it on watch: report on contact,
--   do not engage. Command renews an entry and lifts it.
--   A declared hostile organisation stays until command lifts it. An
--   individual, and anything on watch, lapses after 90 days unless renewed.
--
-- The list is for the serving fleet. It is never sent to a visitor.
--
-- It holds names from the game and nothing else: a player's handle or an
-- organisation's ID, what they did in the game, and links to a picture or a
-- clip of it. Nothing about a person outside the game belongs here, and a
-- serving member of the fleet cannot be listed.

create type public.hostile_kind as enum ('organisation', 'individual');
create type public.hostile_level as enum ('hostile', 'watch');
create type public.hostile_state as enum ('proposed', 'listed', 'declined', 'lifted');

create table public.hostiles (
  id uuid primary key default gen_random_uuid(),
  kind public.hostile_kind not null,
  -- A player's handle or an organisation's ID, as the game shows it.
  handle text not null check (handle ~ '^[A-Za-z0-9_-]{2,60}$'),
  -- An organisation's full name, or what a player is known as in the game.
  -- One line, with nothing in it that hides or reorders what is written: no
  -- control characters, and none of the marks that turn text right to left.
  name text not null default ''
    check (
      char_length(name) <= 80 and name !~ '(^\s|\s$)'
      -- U+202A to U+202E and U+2066 to U+2069, written by number so that this file holds none of them.
      and name !~ ('[[:cntrl:]' || chr(8234) || '-' || chr(8238) || chr(8294) || '-' || chr(8297) || ']')
    ),
  level public.hostile_level not null default 'hostile',
  state public.hostile_state not null default 'proposed',
  -- What they did, in the game.
  reason text not null check (char_length(reason) <= 2000 and char_length(btrim(reason)) >= 10),
  -- Where to see it: web addresses, one to a line.
  evidence text not null default ''
    check (char_length(evidence) <= 1000 and evidence ~ '^(https?://[^[:space:]]+(\n|$))*$'),
  reported_by uuid references public.members (id) on delete set null,
  reported_at timestamptz not null default now(),
  -- Who listed or declined it, or last moved it between hostile and watch.
  decided_by uuid references public.members (id) on delete set null,
  decided_at timestamptz,
  -- What command said when it listed or declined the entry.
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  -- The last day the entry stands. Empty for one that stands until it is lifted.
  expires_on date,
  renewed_by uuid references public.members (id) on delete set null,
  renewed_at timestamptz,
  lifted_by uuid references public.members (id) on delete set null,
  lifted_at timestamptz,
  -- What command said when it lifted the entry.
  lift_note text not null default '' check (char_length(lift_note) <= 500),
  updated_at timestamptz not null default now()
);
-- A name waits once, and is listed once. A name whose entry has lapsed can be
-- put forward again, and listing the new entry closes the lapsed one.
create unique index hostiles_one_waiting on public.hostiles (kind, lower(handle)) where state = 'proposed';
create unique index hostiles_one_listed on public.hostiles (kind, lower(handle)) where state = 'listed';
create index hostiles_state_idx on public.hostiles (state);
create index hostiles_reporter_idx on public.hostiles (reported_by) where state = 'proposed';

-- The last day a listed entry stands. A declared hostile organisation has none.
create function app.hostile_expiry(of_kind public.hostile_kind, at_level public.hostile_level) returns date
language sql stable set search_path = ''
as $$
  select case
    when of_kind = 'organisation' and at_level = 'hostile' then null
    else (now() at time zone 'utc')::date + 90
  end;
$$;

-- Whether an entry is on the list today.
create function app.hostile_stands(entry public.hostiles) returns boolean
language sql stable set search_path = ''
as $$
  select entry.state = 'listed'
    and (entry.expires_on is null or entry.expires_on >= (now() at time zone 'utc')::date);
$$;

-- What can be put forward, and what command can do with it.
--   A serving member: put a name forward, five waiting at most, and take
--   their own back while it waits.
--   Command: list a name outright, list or decline one put forward, rewrite a
--   listed entry, move it between hostile and watch, renew it and lift it.
--   Nobody: change whose name an entry is about, rewrite a name that waits,
--   reopen one that was declined or lifted, or choose the day an entry lapses.
create function app.guard_hostile() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  trusted boolean := app.is_trusted_context();
  me uuid := (select auth.uid());
  command boolean := false;
begin
  -- Who is asking comes first, so that nothing below tells an outsider anything.
  if not trusted then
    if not app.is_serving() then
      raise exception 'Only a serving member puts a name forward.' using errcode = '42501';
    end if;
    command := app.has_role('command');
    if tg_op = 'UPDATE' and not command then
      raise exception 'Command keeps the hostile list.' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' and (new.kind is distinct from old.kind or new.handle is distinct from old.handle) then
    raise exception 'An entry is about one name. Put the other name forward as its own entry.' using errcode = '23514';
  end if;

  -- The fleet's own are never listed, as a player or as an organisation.
  -- Conduct inside the fleet is dealt with inside it. This is checked whenever
  -- an entry is put forward, listed, rewritten, moved or renewed, so that an
  -- entry for someone who has since joined can only be declined or lifted.
  if new.state in ('proposed', 'listed') and exists (
    select 1 from public.members m
    where lower(m.rsi_handle) = lower(new.handle)
      and m.status in ('recruit', 'auxiliary', 'member', 'reserve')
  ) then
    raise exception '% serves in this fleet. The hostile list is for players outside it.', new.handle
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if not trusted then
      if new.state <> 'proposed' and not (new.state = 'listed' and command) then
        raise exception 'A name is put forward first. Command decides whether it is listed.' using errcode = '42501';
      end if;
      new.reported_by := me;
      new.reported_at := now();
      new.decided_by := null;
      new.decided_at := null;
      new.decision_note := '';
      new.renewed_by := null;
      new.renewed_at := null;
      new.lifted_by := null;
      new.lifted_at := null;
      new.lift_note := '';

      if not command then
        if (select count(*) from public.hostiles h where h.reported_by = me and h.state = 'proposed') >= 5 then
          raise exception 'You have five names waiting with command. Wait for an answer, or take one back.'
            using errcode = '23514';
        end if;
        if exists (
          select 1 from public.hostiles h
          where h.kind = new.kind and lower(h.handle) = lower(new.handle)
            and h.state = 'declined' and h.decided_at > now() - interval '30 days'
        ) then
          raise exception 'Command declined % in the last 30 days. Only command can put it forward again so soon.', new.handle
            using errcode = '23514';
        end if;
      end if;
    end if;

    -- A name that is on the list today is there for everyone serving to see.
    if exists (
      select 1 from public.hostiles h
      where h.kind = new.kind and lower(h.handle) = lower(new.handle) and app.hostile_stands(h)
    ) then
      raise exception '% is already on the list.', new.handle using errcode = '23514';
    end if;

    if new.state = 'listed' then
      if not trusted then
        new.decided_by := me;
        new.decided_at := now();
      end if;
      new.expires_on := app.hostile_expiry(new.kind, new.level);
    elsif not trusted then
      new.expires_on := null;
    end if;
  else
    new.updated_at := now();
    if trusted then
      return new;
    end if;

    if old.state in ('declined', 'lifted') then
      raise exception 'This entry is closed. Put the name forward again to reopen it.' using errcode = '23514';
    end if;
    if old.state = 'proposed'
       and (new.name is distinct from old.name or new.reason is distinct from old.reason or new.evidence is distinct from old.evidence) then
      raise exception 'A name that waits stays as it was put forward. List it, then rewrite it.' using errcode = '23514';
    end if;

    if new.state is distinct from old.state then
      if old.state = 'proposed' and new.state in ('listed', 'declined') then
        new.decided_by := me;
        new.decided_at := now();
      elsif old.state = 'listed' and new.state = 'lifted' then
        new.lifted_by := me;
        new.lifted_at := now();
      else
        raise exception 'A name is put forward, then listed or declined. A listed entry is lifted.' using errcode = '23514';
      end if;
    end if;

    if new.state = 'listed' then
      if old.state <> 'listed' then
        -- Listed today: its time runs from today.
        new.expires_on := app.hostile_expiry(new.kind, new.level);
      elsif new.level is distinct from old.level then
        -- Moved between hostile and watch. That is a decision, signed like one, and its time runs from today.
        new.expires_on := app.hostile_expiry(new.kind, new.level);
        new.decided_by := me;
        new.decided_at := now();
      elsif new.expires_on is distinct from old.expires_on then
        -- A renewal. It runs 90 days from today, whatever day was sent. An entry with no last day has nothing to renew.
        new.expires_on := app.hostile_expiry(new.kind, new.level);
        if new.expires_on is not null then
          new.renewed_by := me;
          new.renewed_at := now();
        end if;
      end if;
    elsif new.state = 'lifted' then
      new.expires_on := old.expires_on;
    else
      new.expires_on := null;
    end if;
  end if;

  -- Listing a name closes an entry for the same name that has lapsed, so that
  -- the name is listed once.
  if new.state = 'listed' and (tg_op = 'INSERT' or old.state <> 'listed') then
    update public.hostiles h
    set state = 'lifted', lift_note = 'Lapsed, and listed again as a new entry.'
    where h.kind = new.kind and lower(h.handle) = lower(new.handle)
      and h.state = 'listed' and h.id <> new.id and not app.hostile_stands(h);
  end if;
  return new;
end;
$$;

create trigger hostiles_guard before insert or update on public.hostiles
  for each row execute function app.guard_hostile();
create trigger hostiles_audit after insert or update or delete on public.hostiles
  for each row execute function app.audit();

-- When an entry is deleted, to put right a mistake or to take out something
-- that should never have been written, its words go from the audit log too.
-- That it existed, who it named and who did what stay.
create function app.forget_hostile() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.audit_log
  set old_row = old_row - array['name', 'reason', 'evidence', 'decision_note', 'lift_note'],
      new_row = new_row - array['name', 'reason', 'evidence', 'decision_note', 'lift_note']
  where table_name = 'hostiles' and coalesce(new_row ->> 'id', old_row ->> 'id') = old.id::text;
  return old;
end;
$$;

create trigger hostiles_forget after delete on public.hostiles
  for each row execute function app.forget_hostile();

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant execute on function app.hostile_stands(public.hostiles) to authenticated, service_role;

grant all on public.hostiles to service_role;
grant select on public.hostiles to authenticated;
grant insert (kind, handle, name, level, state, reason, evidence) on public.hostiles to authenticated;
grant update (name, level, state, reason, evidence, decision_note, lift_note, expires_on) on public.hostiles to authenticated;
grant delete on public.hostiles to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.hostiles enable row level security;

-- The list as it stands today is for everyone serving. A name that waits, was
-- declined, was lifted or has lapsed is for whoever put it forward and for
-- command.
create policy "The fleet reads the list, command and the reporter the rest" on public.hostiles
  for select to authenticated
  using (
    (select app.is_serving())
    and (
      app.hostile_stands(hostiles)
      or reported_by = (select auth.uid())
      or (select app.has_role('command'))
    )
  );
create policy "A serving member puts a name forward" on public.hostiles
  for insert to authenticated with check ((select app.is_serving()));
create policy "Command keeps the hostile list" on public.hostiles
  for update to authenticated
  using ((select app.has_role('command'))) with check ((select app.has_role('command')));
create policy "A name is taken back by whoever put it forward, while it waits" on public.hostiles
  for delete to authenticated
  using (
    (state = 'proposed' and reported_by = (select auth.uid()) and (select app.is_serving()))
    or (select app.has_role('admin'))
  );
