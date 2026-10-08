-- Logging: what the history of the data cannot show.
--
-- The audit log already records every change to the fleet's records, with who
-- made it and the row before and after. Three things never change a record, so
-- it cannot see them:
--
--   1. Someone signing in or out.
--   2. Something refused or failed. A refused change is undone, so it leaves
--      no row behind.
--   3. Someone reading a page.
--
-- This migration adds a place for each, and puts grades and ranks under the
-- audit log so that nothing on the site can change without a line.
--
-- Nothing here is a function the API can call. Everything arrives as an
-- ordinary insert, and a trigger decides what is kept.

-- ---------------------------------------------------------------------------
-- Activity: sign-ins, sign-outs, and what was refused or failed
-- ---------------------------------------------------------------------------

create type public.activity_kind as enum ('sign_in', 'sign_out', 'refused', 'failed');

create table public.activity_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- Deleting a member's record removes their lines here with it.
  actor uuid not null references public.members (id) on delete cascade,
  kind public.activity_kind not null,
  -- What was being tried, as a short name the site turns into words.
  action text,
  -- What the person was told.
  shown text,
  -- What the database said, where that differs from what was shown.
  cause text
);
create index activity_log_actor_idx on public.activity_log (actor);

-- A line is written by the site as the person it is about. They cannot write
-- one in anyone else's name or date it themselves, and a fault or a script
-- cannot fill the log: past thirty lines in a minute the rest are dropped.
create function app.stamp_activity() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.is_trusted_context() then
    new.actor := (select auth.uid());
    new.at := now();
  end if;
  new.action := left(new.action, 60);
  new.shown := left(new.shown, 500);
  new.cause := left(new.cause, 500);

  if (select count(*) from public.activity_log
      where actor = new.actor and at > now() - interval '1 minute') >= 30 then
    return null;
  end if;
  return new;
end;
$$;

create trigger activity_log_stamp before insert on public.activity_log
  for each row execute function app.stamp_activity();

-- ---------------------------------------------------------------------------
-- Page views: how many times each public page was read each day
-- ---------------------------------------------------------------------------

-- Daily totals and nothing else. No address, no browser, no person, no time of
-- day. A landing is a view that began a visit, so landings count visits.
create table public.page_views (
  day date not null,
  path text not null,
  views integer not null default 0,
  landings integer not null default 0,
  primary key (day, path)
);

-- The door the site knocks on. Nothing is ever stored here: the trigger adds
-- one to the day's total and throws the row away.
create table public.page_view_ticks (
  path text not null,
  landing boolean not null default false
);

create function app.count_page_view() returns trigger
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
  if split_part(page, '/', 2) not in ('', 'standards', 'ranks', 'joining', 'manual', 'roles', 'credits', 'privacy', 'menu', 'sign-in')
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

create trigger page_view_ticks_count before insert on public.page_view_ticks
  for each row execute function app.count_page_view();

-- The totals as the Logs page reads them. The adding up is done here, so the
-- page asks for a few dozen rows however many pages have been read.
create view public.page_views_by_day with (security_invoker = true) as
select day, sum(views)::integer as views, sum(landings)::integer as landings
from public.page_views
group by day;

create view public.page_views_by_page with (security_invoker = true) as
select path, sum(views)::integer as views, sum(landings)::integer as landings
from public.page_views
where day > (now() at time zone 'utc')::date - 30
group by path;

-- ---------------------------------------------------------------------------
-- Audit log: the last two tables that could change without a line
-- ---------------------------------------------------------------------------

create trigger grades_audit after insert or update or delete on public.grades
  for each row execute function app.audit();
create trigger ranks_audit after insert or update or delete on public.ranks
  for each row execute function app.audit();

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant all on
  public.activity_log, public.page_views, public.page_view_ticks, public.page_views_by_day, public.page_views_by_page
to service_role;

grant select on
  public.activity_log, public.page_views, public.page_views_by_day, public.page_views_by_page
to authenticated;

-- Who it is about and when are the database's, so they cannot be sent.
grant insert (kind, action, shown, cause) on public.activity_log to authenticated;

grant insert (path, landing) on public.page_view_ticks to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.activity_log enable row level security;
alter table public.page_views enable row level security;
alter table public.page_view_ticks enable row level security;

create policy "Admins read the activity log" on public.activity_log
  for select to authenticated using ((select app.has_role('admin')));
-- The trigger has already set whose line it is, so this only confirms it.
create policy "Anyone signed in adds a line about themselves" on public.activity_log
  for insert to authenticated with check (actor = (select auth.uid()));

create policy "Admins read the page views" on public.page_views
  for select to authenticated using ((select app.has_role('admin')));

-- Anyone may knock. The trigger decides what counts and keeps no row.
create policy "Anyone can count a page view" on public.page_view_ticks
  for insert to anon, authenticated with check (char_length(path) <= 2000);
