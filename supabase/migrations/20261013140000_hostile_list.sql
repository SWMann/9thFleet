-- The hostile list
--
-- The rules of engagement name two kinds of player who may be engaged:
-- organisations command has declared hostile, and individuals who are on the
-- database with evidence. This is that list.
--
--   Any serving member puts a name forward, with what happened and where to
--   see it. Nothing is on the list until command says so.
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
  -- An organisation's full name, or what a player is known as.
  name text not null default '' check (char_length(name) <= 80),
  level public.hostile_level not null default 'hostile',
  state public.hostile_state not null default 'proposed',
  -- What they did, in the game.
  reason text not null check (char_length(reason) between 10 and 2000),
  -- Where to see it: web addresses, one to a line.
  evidence text not null default ''
    check (char_length(evidence) <= 1000 and evidence ~ '^(https?://[^[:space:]]+(\n|$))*$'),
  reported_by uuid references public.members (id) on delete set null,
  reported_at timestamptz not null default now(),
  decided_by uuid references public.members (id) on delete set null,
  decided_at timestamptz,
  -- What command said when it listed, declined or lifted the entry.
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  -- The last day the entry stands. Empty for one that stands until it is lifted.
  expires_on date,
  renewed_by uuid references public.members (id) on delete set null,
  renewed_at timestamptz,
  lifted_by uuid references public.members (id) on delete set null,
  lifted_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint hostiles_name_tidy check (name !~ '(^\s|\s$)')
);
-- One open entry for a name: put forward or listed, not both and not twice.
create unique index hostiles_one_open_entry on public.hostiles (kind, lower(handle))
  where state in ('proposed', 'listed');
create index hostiles_state_idx on public.hostiles (state);

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
--   A serving member: put a name forward, and take their own back while it
--   waits.
--   Command: list a name outright, list or decline one put forward, change a
--   listed entry's words and its level, renew it and lift it.
--   Nobody: change whose name an entry is about, reopen one that was declined
--   or lifted, or choose the day an entry lapses.
create function app.guard_hostile() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  trusted boolean := app.is_trusted_context();
  me uuid := (select auth.uid());
begin
  -- The fleet's own are never listed. Conduct inside the fleet is dealt with inside it.
  if new.kind = 'individual' and new.state in ('proposed', 'listed')
     and (tg_op = 'INSERT' or new.state is distinct from old.state)
     and exists (
       select 1 from public.members m
       where lower(m.rsi_handle) = lower(new.handle)
         and m.status in ('recruit', 'auxiliary', 'member', 'reserve')
     ) then
    raise exception '% serves in this fleet. The hostile list is for players outside it.', new.handle
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if not trusted then
      if not app.is_serving() then
        raise exception 'Only a serving member puts a name forward.' using errcode = '42501';
      end if;
      if new.state <> 'proposed' and not (new.state = 'listed' and app.has_role('command')) then
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
    return new;
  end if;

  if new.kind is distinct from old.kind or new.handle is distinct from old.handle then
    raise exception 'An entry is about one name. Put the other name forward as its own entry.' using errcode = '23514';
  end if;
  new.updated_at := now();
  if trusted then
    return new;
  end if;

  if not app.has_role('command') then
    raise exception 'Command keeps the hostile list.' using errcode = '42501';
  end if;
  if old.state in ('declined', 'lifted') then
    raise exception 'This entry is closed. Put the name forward again to reopen it.' using errcode = '23514';
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
    if old.state <> 'listed' or new.level is distinct from old.level then
      -- Listed today, or moved between hostile and watch today: its time runs from today.
      new.expires_on := app.hostile_expiry(new.kind, new.level);
    elsif new.expires_on is distinct from old.expires_on then
      -- A renewal. It runs 90 days from today, whatever day was sent.
      new.expires_on := app.hostile_expiry(new.kind, new.level);
      new.renewed_by := me;
      new.renewed_at := now();
    end if;
  elsif new.state = 'lifted' then
    new.expires_on := old.expires_on;
  else
    new.expires_on := null;
  end if;
  return new;
end;
$$;

create trigger hostiles_guard before insert or update on public.hostiles
  for each row execute function app.guard_hostile();
create trigger hostiles_audit after insert or update or delete on public.hostiles
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant execute on function app.hostile_stands(public.hostiles) to authenticated, service_role;

grant all on public.hostiles to service_role;
grant select on public.hostiles to authenticated;
grant insert (kind, handle, name, level, state, reason, evidence) on public.hostiles to authenticated;
grant update (name, level, state, reason, evidence, decision_note, expires_on) on public.hostiles to authenticated;
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
