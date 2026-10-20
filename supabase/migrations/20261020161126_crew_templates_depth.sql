-- Crew templates in depth
--
-- A crew template was a list of roles with counts. It becomes a crew as a
-- captain would brief it:
--
--   Groups. Named, ordered departments of command's own choosing, per
--   template: Command, Bridge, Gunnery, whatever fits the hull. A station
--   belongs to one group, or to none.
--   Stations. Each keeps its role and count and gains a name of its own
--   where the role alone is vague (Turret gunner and Remote weapons operator
--   are both Gunner stations), how many of it are needed to sail (the
--   minimum watch bill, as Volume 1 has the Idris's eight), a line on what
--   the station does aboard this model, and a stand-in: another station of
--   the same template that covers it when empty.
--   A source line per template: where the crew comes from (Volume 1,
--   Organisation: Flagship crew), or who approved a variant.
--
-- The Idris templates are grouped and marked as Volume 1 sets them out, as
-- a worked example; the rest wait for command.

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------

create table public.crew_template_groups (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.crew_templates (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60 and name !~ '(^\s|\s$)'),
  sort_order smallint not null default 0,
  unique (template_id, name)
);
create index crew_template_groups_template_idx on public.crew_template_groups (template_id);
create trigger crew_template_groups_audit after insert or update or delete on public.crew_template_groups
  for each row execute function app.audit();

-- A group stays with its template.
create function app.guard_group() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.template_id is distinct from old.template_id then
    raise exception 'A group cannot be moved to another template.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger crew_template_groups_guard before update on public.crew_template_groups
  for each row execute function app.guard_group();

-- ---------------------------------------------------------------------------
-- Templates and stations
-- ---------------------------------------------------------------------------

alter table public.crew_templates add column source text not null default '' check (char_length(source) <= 300 and source !~ '(^\s|\s$)');

alter table public.crew_template_stations
  add column name text not null default '' check (char_length(name) <= 60 and name !~ '(^\s|\s$)'),
  add column group_id uuid references public.crew_template_groups (id) on delete set null,
  add column minimum smallint not null default 0,
  add column brief text not null default '' check (char_length(brief) <= 300 and brief !~ '(^\s|\s$)'),
  add column stand_in_id uuid references public.crew_template_stations (id) on delete set null,
  add constraint crew_template_stations_minimum_within_count check (minimum between 0 and count),
  add constraint crew_template_stations_not_own_stand_in check (stand_in_id is null or stand_in_id <> id);
create index crew_template_stations_group_idx on public.crew_template_stations (group_id) where group_id is not null;
create index crew_template_stations_stand_in_idx on public.crew_template_stations (stand_in_id) where stand_in_id is not null;

-- A role may now hold two stations of a template, told apart by name.
alter table public.crew_template_stations drop constraint crew_template_stations_template_id_role_id_key;
alter table public.crew_template_stations add constraint crew_template_stations_template_id_role_id_name_key unique (template_id, role_id, name);

-- A station stays with its template, and its group and its stand-in are of
-- the same template. The stated function keeps its search path.
create or replace function app.guard_station() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.template_id is distinct from old.template_id then
    raise exception 'A station cannot be moved to another template.' using errcode = '42501';
  end if;
  if new.group_id is not null and not exists (select 1 from public.crew_template_groups g where g.id = new.group_id and g.template_id = new.template_id) then
    raise exception 'A station is grouped within its own template.' using errcode = '23514';
  end if;
  if new.stand_in_id is not null and not exists (select 1 from public.crew_template_stations s where s.id = new.stand_in_id and s.template_id = new.template_id) then
    raise exception 'A stand-in is another station of the same template.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create or replace trigger crew_template_stations_guard before insert or update on public.crew_template_stations
  for each row execute function app.guard_station();

-- ---------------------------------------------------------------------------
-- The Idris, as Volume 1 sets it out
-- ---------------------------------------------------------------------------

update public.crew_templates t set source = 'Volume 1, Organisation: Flagship crew'
from public.ship_models m where m.id = t.model_id and m.slug in ('idris-m', 'idris-p') and t.is_default;
-- The escorts' crews are Volume 1's too; the single-seat fighters' pilot is the register's own.
update public.crew_templates t set source = 'Volume 1, Organisation: The rest of the squadron'
from public.ship_models m where m.id = t.model_id and m.kind in ('corvette', 'gunship') and t.is_default
  and exists (select 1 from public.crew_template_stations s where s.template_id = t.id);

insert into public.crew_template_groups (template_id, name, sort_order)
select t.id, g.name, g.n
from public.crew_templates t
join public.ship_models m on m.id = t.model_id and m.slug in ('idris-m', 'idris-p') and t.is_default
cross join (values ('Command', 1), ('Bridge', 2), ('Gunnery', 3), ('Engineering', 4), ('Flight deck', 5), ('Security', 6), ('Medical', 7)) as g (name, n);

update public.crew_template_stations s
set group_id = g.id,
    minimum = case r.slug when 'commanding-officer' then 1 when 'helmsman' then 1 when 'tactical-officer' then 1 when 'engineer' then 1 when 'gunner' then 4 else 0 end
from public.crew_templates t
join public.ship_models m on m.id = t.model_id and m.slug in ('idris-m', 'idris-p') and t.is_default
join public.fleet_roles r on true
join public.crew_template_groups g on g.template_id = t.id and g.name = case r.slug
  when 'commanding-officer' then 'Command' when 'executive-officer' then 'Command' when 'tactical-officer' then 'Command' when 'chief-of-the-boat' then 'Command'
  when 'helmsman' then 'Bridge' when 'navigator' then 'Bridge' when 'signaller' then 'Bridge'
  when 'gunnery-chief' then 'Gunnery' when 'gunner' then 'Gunnery'
  when 'chief-engineer' then 'Engineering' when 'senior-engineer' then 'Engineering' when 'engineer' then 'Engineering'
  when 'flight-deck-chief' then 'Flight deck' when 'deck-hand' then 'Flight deck'
  when 'master-at-arms' then 'Security'
  when 'medic' then 'Medical'
  end
where s.template_id = t.id and s.role_id = r.id;

-- The Navigator is the backup helm.
update public.crew_template_stations helm
set stand_in_id = nav.id
from public.crew_templates t
join public.ship_models m on m.id = t.model_id and m.slug in ('idris-m', 'idris-p') and t.is_default
join public.fleet_roles rh on rh.slug = 'helmsman'
join public.fleet_roles rn on rn.slug = 'navigator'
join public.crew_template_stations nav on nav.template_id = t.id and nav.role_id = rn.id
where helm.template_id = t.id and helm.role_id = rh.id;

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant all on public.crew_template_groups to service_role;

grant select on public.crew_template_groups to authenticated;
grant insert (template_id, name, sort_order) on public.crew_template_groups to authenticated;
grant update (name, sort_order) on public.crew_template_groups to authenticated;
grant delete on public.crew_template_groups to authenticated;

grant insert (source) on public.crew_templates to authenticated;
grant update (source) on public.crew_templates to authenticated;
grant insert (name, group_id, minimum, brief, stand_in_id) on public.crew_template_stations to authenticated;
grant update (name, group_id, minimum, brief, stand_in_id) on public.crew_template_stations to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.crew_template_groups enable row level security;

create policy "The fleet reads the groups of each template" on public.crew_template_groups
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Command adds groups" on public.crew_template_groups
  for insert to authenticated with check ((select app.has_role('command')));
create policy "Command changes groups" on public.crew_template_groups
  for update to authenticated using ((select app.has_role('command'))) with check ((select app.has_role('command')));
create policy "Command removes groups" on public.crew_template_groups
  for delete to authenticated using ((select app.has_role('command')));
