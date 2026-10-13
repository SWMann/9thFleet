-- Routine orders
--
-- The fleet's own notice, issued by command: numbered, dated, and read by the
-- serving fleet. Volume 2 has them weekly from stage 2, with the command
-- board's decisions published in the next issue.
--
--   Command drafts an issue. The site fills the draft with the record of the
--   time since the last issue: appointments, promotions, qualifications, who
--   joined and left, operations held and ahead, the hostile list, strength.
--   Command edits it, then issues it. Only then is it numbered, and only then
--   is it sent to the fleet.
--   One draft at a time. An issue, once issued, keeps its number, its date and
--   the period of record it covers. Command may still correct its words.
--   Each serving member marks an issue as read, for themselves. Command sees
--   who has.
--
-- Routine orders name members, so they are never sent to a visitor.

create type public.routine_order_state as enum ('draft', 'issued');

create table public.routine_orders (
  id uuid primary key default gen_random_uuid(),
  -- Given when the issue is issued, in order. A draft has none.
  number integer unique check (number >= 1),
  title text not null default '' check (char_length(title) <= 80 and title !~ '(^\s|\s$)'),
  -- The time the issue's record runs from and to: from the end of the last
  -- issue, or the day the fleet's record began, to the moment it was drafted.
  covers_from timestamptz not null,
  covers_to timestamptz not null,
  -- The orders themselves, as formatted text.
  body text not null default '' check (char_length(body) <= 12000),
  state public.routine_order_state not null default 'draft',
  drafted_by uuid references public.members (id) on delete set null,
  drafted_at timestamptz not null default now(),
  issued_by uuid references public.members (id) on delete set null,
  issued_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint routine_orders_period check (covers_to >= covers_from),
  constraint routine_orders_numbered_when_issued check ((state = 'issued') = (number is not null and issued_at is not null))
);
create unique index routine_orders_one_draft on public.routine_orders (state) where state = 'draft';
create index routine_orders_issued_idx on public.routine_orders (issued_at) where state = 'issued';
create index routine_orders_drafter_idx on public.routine_orders (drafted_by) where drafted_by is not null;
create index routine_orders_issuer_idx on public.routine_orders (issued_by) where issued_by is not null;

-- Who has read each issue. A member's own line, written once.
create table public.routine_order_reads (
  order_id uuid not null references public.routine_orders (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (order_id, member_id)
);
create index routine_order_reads_member_idx on public.routine_order_reads (member_id);

-- What command decides and what the database keeps for itself.
--   Command: draft an issue, write its title and words, issue it, correct it
--   after, and delete a draft.
--   The database: the number, who drafted and issued it and when, and the
--   period of record. An issue is never taken back.
create function app.guard_routine_order() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  trusted boolean := app.is_trusted_context();
  me uuid := (select auth.uid());
begin
  -- The database's own housekeeping: a member named on the issue was deleted,
  -- and their name was cleared.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
     and (to_jsonb(new) - array['drafted_by', 'issued_by', 'updated_at']) = (to_jsonb(old) - array['drafted_by', 'issued_by', 'updated_at']) then
    return new;
  end if;

  if not trusted and not app.has_role('command') then
    raise exception 'Command issues routine orders.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if not trusted then
      new.state := 'draft';
      new.number := null;
      new.issued_by := null;
      new.issued_at := null;
      new.drafted_by := me;
      new.drafted_at := now();
      new.updated_at := now();
      -- The record runs on from the last issue, or from the day the fleet's record began.
      new.covers_from := coalesce(
        (select max(o.covers_to) from public.routine_orders o where o.state = 'issued'),
        (select min(m.joined_on)::timestamptz from public.members m),
        now()
      );
      new.covers_to := now();
    end if;
    return new;
  end if;

  new.updated_at := now();
  if trusted then
    return new;
  end if;

  -- What the database set stays as it was.
  new.covers_from := old.covers_from;
  new.covers_to := old.covers_to;
  new.drafted_by := old.drafted_by;
  new.drafted_at := old.drafted_at;
  new.number := old.number;
  new.issued_by := old.issued_by;
  new.issued_at := old.issued_at;

  if new.state is distinct from old.state then
    if old.state = 'draft' and new.state = 'issued' then
      if char_length(btrim(new.body)) < 20 then
        raise exception 'Write the orders before issuing them.' using errcode = '23514';
      end if;
      new.number := coalesce((select max(o.number) from public.routine_orders o), 0) + 1;
      new.issued_by := me;
      new.issued_at := now();
    else
      raise exception 'An issue, once issued, stands. Correct its words, or put a correction in the next issue.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger routine_orders_guard before insert or update on public.routine_orders
  for each row execute function app.guard_routine_order();
create trigger routine_orders_audit after insert or update or delete on public.routine_orders
  for each row execute function app.audit();

-- A member marks an issue as read, for themselves, once it has been issued.
create function app.guard_routine_order_read() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if app.is_trusted_context() then
    return new;
  end if;
  if not app.is_serving() then
    raise exception 'Routine orders are for the serving fleet.' using errcode = '42501';
  end if;
  if new.member_id <> (select auth.uid()) then
    raise exception 'A member marks an issue as read for themselves.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.routine_orders o where o.id = new.order_id and o.state = 'issued') then
    raise exception 'That issue has not been issued.' using errcode = '23514';
  end if;
  new.read_at := now();
  return new;
end;
$$;

create trigger routine_order_reads_guard before insert on public.routine_order_reads
  for each row execute function app.guard_routine_order_read();

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant all on public.routine_orders, public.routine_order_reads to service_role;

grant select on public.routine_orders to authenticated;
grant insert (title, body) on public.routine_orders to authenticated;
grant update (title, body, state) on public.routine_orders to authenticated;
grant delete on public.routine_orders to authenticated;

grant select on public.routine_order_reads to authenticated;
grant insert (order_id, member_id) on public.routine_order_reads to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.routine_orders enable row level security;
alter table public.routine_order_reads enable row level security;

create policy "The fleet reads issued orders, command the draft too" on public.routine_orders
  for select to authenticated
  using ((select app.is_serving()) and (state = 'issued' or (select app.has_role('command'))));
create policy "Command drafts routine orders" on public.routine_orders
  for insert to authenticated with check ((select app.has_role('command')));
create policy "Command writes and issues routine orders" on public.routine_orders
  for update to authenticated
  using ((select app.has_role('command'))) with check ((select app.has_role('command')));
create policy "Command deletes a draft" on public.routine_orders
  for delete to authenticated using ((select app.has_role('command')) and state = 'draft');

create policy "See your own reading, or everyone's as command" on public.routine_order_reads
  for select to authenticated
  using ((select app.is_serving()) and (member_id = (select auth.uid()) or (select app.has_role('command'))));
create policy "Mark an issue as read for yourself" on public.routine_order_reads
  for insert to authenticated
  with check ((select app.is_serving()) and member_id = (select auth.uid()));
