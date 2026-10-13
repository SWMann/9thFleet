-- The piracy report line
--
-- Anyone may tell the fleet about piracy without signing in: who they are in
-- the game, where and when it happened, who did it if they know, what
-- happened, and where to see it. A report may be marked as happening now.
--
--   Reports are read and handled by command and nobody else. They are never
--   published, and nothing on the site shows a visitor that a report exists.
--   A report holds names from the game and nothing else.
--   From a report, command may start a hostile-list entry or draft a Response
--   event. The entry and the report each keep a link to the other.
--   The line takes five reports a day from one sender, and ten an hour and
--   thirty a day from everyone together.
--
-- Nothing that identifies a sender is stored. The site works out a mark of
-- four characters from the sender's network address and the day, and sends it
-- with the report. The mark is counted here and thrown away: it is never kept
-- with the report. It cannot be turned back into an address, because about
-- sixty-five thousand addresses share each mark, and it changes every day.

create type public.piracy_report_state as enum ('new', 'handled', 'dismissed');

create table public.piracy_reports (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  -- The sender says it is happening now.
  urgent boolean not null default false,
  -- Who is reporting: their handle in the game, so that command can find them there.
  reporter_handle text not null check (reporter_handle ~ '^[A-Za-z0-9_-]{2,60}$'),
  -- Where it happened, in the sender's words. One line, with nothing in it
  -- that hides or reorders what is written.
  location text not null check (
    char_length(location) between 2 and 120 and location !~ '(^\s|\s$)'
    -- U+202A to U+202E and U+2066 to U+2069, written by number so that this file holds none of them.
    and location !~ ('[[:cntrl:]' || chr(8234) || '-' || chr(8238) || chr(8294) || '-' || chr(8297) || ']')
  ),
  happened_on date not null default ((now() at time zone 'utc')::date),
  -- Who did it, where the sender knows: a player or an organisation, by the name the game shows.
  suspect_kind public.hostile_kind,
  suspect_handle text not null default '' check (suspect_handle ~ '^([A-Za-z0-9_-]{2,60})?$'),
  -- What happened, as plain text. Its lines may break. Nothing else in it
  -- steers how it is shown: no other control characters (U+0001 to U+0009,
  -- U+000B to U+001F and U+007F to U+009F), and none of the marks that turn
  -- text right to left.
  details text not null check (
    char_length(details) <= 2000 and char_length(btrim(details)) >= 20
    and details !~ ('[' || chr(1) || '-' || chr(9) || chr(11) || '-' || chr(31) || chr(127) || '-' || chr(159) || chr(8234) || '-' || chr(8238) || chr(8294) || '-' || chr(8297) || ']')
  ),
  -- Where to see it: web addresses, one to a line.
  evidence text not null default ''
    check (char_length(evidence) <= 1000 and evidence ~ '^(https?://[^[:space:]]+(\n|$))*$'),
  -- The door a sender's mark comes through. It is counted and thrown away.
  sender text check (sender is null),
  state public.piracy_report_state not null default 'new',
  -- Who marked it handled or dismissed, and what they said.
  handled_by uuid references public.members (id) on delete set null,
  handled_at timestamptz,
  outcome_note text not null default '' check (char_length(outcome_note) <= 500),
  -- The Response event drafted from it.
  event_id uuid references public.events (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint piracy_reports_suspect_named check ((suspect_kind is null) = (suspect_handle = ''))
);
create index piracy_reports_received_idx on public.piracy_reports (received_at);
create index piracy_reports_event_idx on public.piracy_reports (event_id) where event_id is not null;
create index piracy_reports_handler_idx on public.piracy_reports (handled_by) where handled_by is not null;

-- How many reports each mark has sent on its latest day. A mark that comes
-- back on a later day starts again from one, so the table never holds more
-- than one row for each of the 65,536 marks.
create table app.piracy_senders (
  mark text primary key check (mark ~ '^[a-f0-9]{4}$'),
  day date not null,
  reports integer not null
);

-- What a sender decides and what they do not, how much the line takes, and
-- what command can do with a report.
--   A sender: the words of the report. Never its date of arrival, its state
--   or anything command writes.
--   Command: mark a report handled or dismissed, reopen it, write what came
--   of it, and link the event drafted from it.
--   Nobody: change the words of a report once it has arrived.
create function app.guard_piracy_report() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  trusted boolean := app.is_trusted_context();
  me uuid := (select auth.uid());
  today date := (now() at time zone 'utc')::date;
  sent integer;
begin
  if tg_op = 'INSERT' then
    if trusted then
      new.sender := null;
      return new;
    end if;

    new.received_at := now();
    new.state := 'new';
    new.handled_by := null;
    new.handled_at := null;
    new.outcome_note := '';
    new.event_id := null;
    new.updated_at := now();

    if new.happened_on > today + 1 or new.happened_on < today - 90 then
      raise exception 'Give a day in the last 90 days.' using errcode = '23514';
    end if;
    if new.sender is null or new.sender !~ '^[a-f0-9]{4}$' then
      raise exception 'A report is sent through the fleet''s own form.' using errcode = '23514';
    end if;

    -- The line as a whole.
    if (select count(*) from public.piracy_reports r where r.received_at > now() - interval '1 hour') >= 10
       or (select count(*) from public.piracy_reports r where r.received_at > now() - interval '1 day') >= 30 then
      raise exception 'The report line is full for now. Try again in an hour.' using errcode = '23514';
    end if;

    -- One sender.
    insert into app.piracy_senders as s (mark, day, reports) values (new.sender, today, 1)
    on conflict (mark) do update
      set reports = case when s.day = excluded.day then s.reports + 1 else 1 end,
          day = excluded.day
    returning s.reports into sent;
    if sent > 5 then
      raise exception 'You have sent five reports today. That is the most the line takes from one sender in a day.'
        using errcode = '23514';
    end if;

    new.sender := null;
    return new;
  end if;

  new.updated_at := now();
  if trusted then
    return new;
  end if;
  -- The database's own housekeeping: the event or the member a report pointed
  -- to was deleted, and the link was cleared.
  if pg_trigger_depth() > 1
     and (to_jsonb(new) - array['handled_by', 'event_id', 'updated_at']) = (to_jsonb(old) - array['handled_by', 'event_id', 'updated_at']) then
    return new;
  end if;
  if not app.has_role('command') then
    raise exception 'Command handles piracy reports.' using errcode = '42501';
  end if;

  if new.state is distinct from old.state then
    if new.state = 'new' then
      new.handled_by := null;
      new.handled_at := null;
    else
      new.handled_by := me;
      new.handled_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger piracy_reports_guard before insert or update on public.piracy_reports
  for each row execute function app.guard_piracy_report();
create trigger piracy_reports_audit after insert or update or delete on public.piracy_reports
  for each row execute function app.audit();

-- When a report is deleted its words go from the audit log too. That it
-- arrived, when, and who handled it stay.
create function app.forget_piracy_report() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.audit_log
  set old_row = old_row - array['reporter_handle', 'location', 'suspect_handle', 'details', 'evidence', 'outcome_note'],
      new_row = new_row - array['reporter_handle', 'location', 'suspect_handle', 'details', 'evidence', 'outcome_note']
  where table_name = 'piracy_reports' and coalesce(new_row ->> 'id', old_row ->> 'id') = old.id::text;
  return old;
end;
$$;

create trigger piracy_reports_forget after delete on public.piracy_reports
  for each row execute function app.forget_piracy_report();

-- ---------------------------------------------------------------------------
-- A hostile-list entry started from a report keeps a link to it
-- ---------------------------------------------------------------------------

alter table public.hostiles
  add column report_id uuid references public.piracy_reports (id) on delete set null;
create index hostiles_report_idx on public.hostiles (report_id) where report_id is not null;

-- The hostile list's rules, as they were, with two additions. Only command
-- starts an entry from a report. And when a member, or a report, that an entry
-- pointed to is deleted, clearing the link is the database's own housekeeping:
-- it is let through whatever state the entry is in.
create or replace function app.guard_hostile() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  trusted boolean := app.is_trusted_context();
  me uuid := (select auth.uid());
  command boolean := false;
begin
  -- The database's own housekeeping: a member or a report the entry pointed to
  -- was deleted, and the link was cleared. Nobody asks for this through the
  -- API, where a change is never made from inside another.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
     and (to_jsonb(new) - array['reported_by', 'decided_by', 'renewed_by', 'lifted_by', 'report_id'])
       = (to_jsonb(old) - array['reported_by', 'decided_by', 'renewed_by', 'lifted_by', 'report_id']) then
    return new;
  end if;

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
      if new.report_id is not null and not command then
        raise exception 'Only command starts an entry from a piracy report.' using errcode = '42501';
      end if;

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

-- ---------------------------------------------------------------------------
-- The report page is a public page, so its views are counted like the others
-- ---------------------------------------------------------------------------

create or replace function app.count_page_view() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  page text := lower(coalesce(new.path, ''));
  today date := (now() at time zone 'utc')::date;
begin
  -- Only the shape of an address on this site, and only its public pages.
  if char_length(page) > 120 or page !~ '^/[a-z0-9/-]*$' or page ~ '//' then
    return null;
  end if;
  if page <> '/' then
    page := rtrim(page, '/');
  end if;
  if split_part(page, '/', 2) not in ('', 'standards', 'ranks', 'joining', 'manual', 'roles', 'credits', 'privacy', 'menu', 'sign-in', 'piracy')
     or array_length(string_to_array(page, '/'), 1) > 4 then
    return null;
  end if;

  -- A day holds a few hundred pages at most. Made-up addresses past that are
  -- counted together, so nobody can fill the table with them.
  if not exists (select 1 from public.page_views where day = today and path = page)
     and (select count(*) from public.page_views where day = today) >= 400 then
    page := '(other)';
  end if;

  insert into public.page_views (day, path, views, landings)
  values (today, page, 1, case when new.landing then 1 else 0 end)
  on conflict (day, path) do update
    set views = public.page_views.views + 1,
        landings = public.page_views.landings + excluded.landings;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant all on public.piracy_reports to service_role;
grant all on app.piracy_senders to service_role;

-- A visitor sends the words of a report and nothing else, and reads nothing back.
grant insert (urgent, reporter_handle, location, happened_on, suspect_kind, suspect_handle, details, evidence, sender)
  on public.piracy_reports to anon;

grant select, delete on public.piracy_reports to authenticated;
grant update (state, outcome_note, event_id) on public.piracy_reports to authenticated;

grant insert (report_id) on public.hostiles to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.piracy_reports enable row level security;
alter table app.piracy_senders enable row level security;

-- The trigger has already set these, so this only confirms what arrives.
create policy "Anyone sends a piracy report" on public.piracy_reports
  for insert to anon with check (state = 'new' and handled_by is null and event_id is null);
create policy "Command reads piracy reports" on public.piracy_reports
  for select to authenticated using ((select app.has_role('command')));
create policy "Command handles piracy reports" on public.piracy_reports
  for update to authenticated
  using ((select app.has_role('command'))) with check ((select app.has_role('command')));
create policy "Command deletes a piracy report" on public.piracy_reports
  for delete to authenticated using ((select app.has_role('command')));
