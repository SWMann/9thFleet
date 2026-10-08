-- Training sign-off, and a fuller after-action report.
--
-- An event can say which qualification it teaches. Once it has started, an
-- instructor signs off who passed, and each pass is an award in the
-- instructor's own name that points back at the event.
--
-- The after-action report can now also say, each as its own record:
--   how each objective turned out;
--   what was lost;
--   who is mentioned, and for what. A mention is shown on the event's report
--   and on the member's own record, to the serving fleet.

-- ---------------------------------------------------------------------------
-- Training
-- ---------------------------------------------------------------------------

alter table public.events
  add column teaches_qualification_id uuid references public.qualifications (id) on delete set null;

-- The event an award was signed off at, if it was signed off at one.
alter table public.qualification_awards
  add column event_id uuid references public.events (id) on delete set null;
create index qualification_awards_event_idx on public.qualification_awards (event_id) where event_id is not null;

-- An award that names an event is checked against it: the event teaches that
-- qualification, it has started, and the member was there. Who may award at
-- all is the rule already on the table: an instructor, in their own name, and
-- never to themselves.
create function app.guard_award_at_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  event public.events%rowtype;
  mark public.attendance_return;
begin
  if new.event_id is null or app.is_trusted_context() then
    return new;
  end if;
  select * into event from public.events where id = new.event_id;
  if event.id is null or event.teaches_qualification_id is distinct from new.qualification_id then
    raise exception 'That event does not teach this qualification.' using errcode = '23514';
  end if;
  if event.state not in ('announced', 'done') or now() < event.starts_at then
    raise exception 'A pass is signed off once the event has started.' using errcode = '23514';
  end if;
  -- The attendance return has the last word on who was there. Until it is made, the roll does.
  select r.returned into mark from public.attendance_returns r
  where r.event_id = new.event_id and r.member_id = new.member_id;
  if mark is not null then
    if mark <> 'present' then
      raise exception 'That member was marked absent from the event.' using errcode = '23514';
    end if;
  elsif not exists (
    select 1 from public.attendance t
    where t.event_id = new.event_id and t.member_id = new.member_id and t.place = 'in'
  ) then
    raise exception 'That member was not at the event.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger qualification_awards_at_event before insert on public.qualification_awards
  for each row execute function app.guard_award_at_event();

-- ---------------------------------------------------------------------------
-- The report's records
-- ---------------------------------------------------------------------------

create type public.objective_outcome as enum ('achieved', 'partly', 'not_achieved');

-- How an objective turned out. Kept apart from the objective, which is fixed
-- with the event when it closes, because the report is written afterwards.
create table public.event_objective_outcomes (
  objective_id uuid primary key references public.event_objectives (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  outcome public.objective_outcome not null,
  note text not null default '' check (char_length(note) <= 300),
  set_by uuid references public.members (id) on delete set null,
  set_at timestamptz not null default now()
);
create index event_objective_outcomes_event_idx on public.event_objective_outcomes (event_id);

create table public.event_losses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  item text not null check (char_length(item) between 2 and 120),
  quantity smallint not null default 1 check (quantity between 1 and 999),
  note text not null default '' check (char_length(note) <= 200),
  recorded_by uuid references public.members (id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint event_losses_item_tidy check (item !~ '(^\s|\s$)')
);
create index event_losses_event_idx on public.event_losses (event_id);

-- A member named in the report for something they did. One for each member for each event.
create table public.event_mentions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  citation text not null check (char_length(citation) between 1 and 300),
  mentioned_by uuid references public.members (id) on delete set null,
  mentioned_at timestamptz not null default now(),
  unique (event_id, member_id)
);
create index event_mentions_member_idx on public.event_mentions (member_id);

-- These are written by whoever ran the event, once it has started, and can be
-- put right afterwards, like the report itself. Each is stamped with who wrote
-- it and when. Nobody writes a mention of themselves.
create function app.guard_report_part() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  target uuid := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  event public.events%rowtype;
  me uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' and new.event_id is distinct from old.event_id then
    raise exception 'This cannot be moved to another event.' using errcode = '42501';
  end if;
  -- What goes with an event, an objective or a member that is removed is the database's own doing.
  if app.is_trusted_context() or pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if not app.runs_event(target) then
    raise exception 'Only whoever ran the event writes its report.' using errcode = '42501';
  end if;
  select * into event from public.events where id = target;
  if event.state not in ('announced', 'done') then
    raise exception 'A report is filed for an event that took place.' using errcode = '23514';
  end if;
  if now() < event.starts_at then
    raise exception 'A report is filed once the event has started.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_table_name = 'event_objective_outcomes' then
    if tg_op = 'UPDATE' and new.objective_id is distinct from old.objective_id then
      raise exception 'An outcome cannot be moved to another objective.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.event_objectives o where o.id = new.objective_id and o.event_id = new.event_id) then
      raise exception 'That objective is not one of this event''s.' using errcode = '23514';
    end if;
    new.set_by := me;
    new.set_at := now();
  elsif tg_table_name = 'event_losses' then
    if tg_op = 'INSERT' then
      new.recorded_by := me;
      new.recorded_at := now();
    else
      new.recorded_by := old.recorded_by;
      new.recorded_at := old.recorded_at;
    end if;
  elsif tg_table_name = 'event_mentions' then
    if tg_op = 'UPDATE' and new.member_id is distinct from old.member_id then
      raise exception 'A mention cannot be moved to another member.' using errcode = '42501';
    end if;
    if new.member_id = me then
      raise exception 'A mention is written by someone else.' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' then
      if not app.is_serving_member(new.member_id) then
        raise exception 'A mention is for a serving member.' using errcode = '23514';
      end if;
      new.mentioned_by := me;
      new.mentioned_at := now();
    else
      new.mentioned_by := old.mentioned_by;
      new.mentioned_at := old.mentioned_at;
    end if;
  end if;
  return new;
end;
$$;

create trigger event_objective_outcomes_guard before insert or update or delete on public.event_objective_outcomes
  for each row execute function app.guard_report_part();
create trigger event_losses_guard before insert or update or delete on public.event_losses
  for each row execute function app.guard_report_part();
create trigger event_mentions_guard before insert or update or delete on public.event_mentions
  for each row execute function app.guard_report_part();

-- ---------------------------------------------------------------------------
-- Next week's event also teaches what this one did
-- ---------------------------------------------------------------------------

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
       muster_at, area, reading, teaches_qualification_id)
    values
      (new.kind, app.next_title(new.title), new.summary, next_start, new.duration_minutes,
       case when app.is_serving_member(new.commander_id) then new.commander_id else closer end,
       case when app.is_serving_member(new.second_id) then new.second_id end,
       case when app.is_serving_member(new.observer_id) then new.observer_id end,
       new.weapons_state, new.pve_fallback, true, new.id, coalesce(closer, new.created_by),
       new.open_to_recruits, new.open_to_service, new.requires_qualification_id, new.places, new.minimum_attending,
       new.muster_at, new.area, new.reading, new.teaches_qualification_id);
  exception when others then
    raise warning 'Next week''s event was not drafted: %', sqlerrm;
  end;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

create trigger event_objective_outcomes_audit after insert or update or delete on public.event_objective_outcomes
  for each row execute function app.audit();
create trigger event_losses_audit after insert or update or delete on public.event_losses
  for each row execute function app.audit();
create trigger event_mentions_audit after insert or update or delete on public.event_mentions
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant insert (teaches_qualification_id) on public.events to authenticated;
grant update (teaches_qualification_id) on public.events to authenticated;
grant insert (event_id) on public.qualification_awards to authenticated;

grant all on public.event_objective_outcomes, public.event_losses, public.event_mentions to service_role;
grant select, delete on public.event_objective_outcomes, public.event_losses, public.event_mentions to authenticated;
grant insert (objective_id, event_id, outcome, note) on public.event_objective_outcomes to authenticated;
grant update (outcome, note) on public.event_objective_outcomes to authenticated;
grant insert (event_id, item, quantity, note) on public.event_losses to authenticated;
grant update (item, quantity, note) on public.event_losses to authenticated;
grant insert (event_id, member_id, citation) on public.event_mentions to authenticated;
grant update (citation) on public.event_mentions to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.event_objective_outcomes enable row level security;
alter table public.event_losses enable row level security;
alter table public.event_mentions enable row level security;

-- Each is read by whoever can see the event, which is the serving fleet once
-- it is announced, and written by whoever ran it.
create policy "An objective's outcome is seen with its event" on public.event_objective_outcomes
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_objective_outcomes.event_id));
create policy "Whoever ran an event says how an objective turned out" on public.event_objective_outcomes
  for insert to authenticated with check (app.runs_event(event_id));
create policy "Whoever ran an event corrects an outcome" on public.event_objective_outcomes
  for update to authenticated using (app.runs_event(event_id)) with check (app.runs_event(event_id));
create policy "Whoever ran an event takes an outcome back" on public.event_objective_outcomes
  for delete to authenticated using (app.runs_event(event_id));

create policy "An event's losses are seen with it" on public.event_losses
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_losses.event_id));
create policy "Whoever ran an event records its losses" on public.event_losses
  for insert to authenticated with check (app.runs_event(event_id));
create policy "Whoever ran an event corrects its losses" on public.event_losses
  for update to authenticated using (app.runs_event(event_id)) with check (app.runs_event(event_id));
create policy "Whoever ran an event removes a loss" on public.event_losses
  for delete to authenticated using (app.runs_event(event_id));

create policy "An event's mentions are seen with it" on public.event_mentions
  for select to authenticated
  using ((select app.is_serving()) and exists (select 1 from public.events e where e.id = event_mentions.event_id));
create policy "Whoever ran an event mentions a member" on public.event_mentions
  for insert to authenticated with check (app.runs_event(event_id));
create policy "Whoever ran an event corrects a mention" on public.event_mentions
  for update to authenticated using (app.runs_event(event_id)) with check (app.runs_event(event_id));
create policy "Whoever ran an event withdraws a mention" on public.event_mentions
  for delete to authenticated using (app.runs_event(event_id));
