-- The fleet board: ship roles, and a hull in claim
--
-- The register becomes a board of the fleet's holdings by model. Two things
-- the board needs that the register did not have:
--
--   Ship roles. A kind says what a hull is; a role says what it does for the
--   fleet, and a model may do more than one thing. The roles are a sheet an
--   admin keeps with the rest of the structure; command gives each model its
--   roles, one of them primary. The board and the models index narrow by role.
--   A hull in claim. A third mark beside ready and not ready: the hull was
--   lost and its claim is pending. It counts as not ready everywhere, and is
--   withdrawn from events as a hull marked not ready is. Nothing clears it by
--   itself: a ready mark ends it, and the site's "not ready" mark sends both
--   columns, so the three marks are one choice. A statement that changes only
--   `ready` to false leaves the claim standing, which is what a change to the
--   hull's details does.

-- ---------------------------------------------------------------------------
-- Ship roles
-- ---------------------------------------------------------------------------

create table public.ship_roles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name text not null unique check (char_length(name) between 2 and 60 and name !~ '(^\s|\s$)'),
  description text not null default '' check (char_length(description) <= 300),
  sort_order smallint not null default 0
);
create trigger ship_roles_audit after insert or update or delete on public.ship_roles
  for each row execute function app.audit();

-- Which roles each model fills. One of them is the primary: the one the
-- model is listed under where one role is needed.
create table public.ship_model_roles (
  model_id uuid not null references public.ship_models (id) on delete cascade,
  role_id uuid not null references public.ship_roles (id) on delete restrict,
  is_primary boolean not null default false,
  primary key (model_id, role_id)
);
create index ship_model_roles_role_idx on public.ship_model_roles (role_id);
create unique index ship_model_roles_one_primary on public.ship_model_roles (model_id) where is_primary;
create trigger ship_model_roles_audit after insert or update or delete on public.ship_model_roles
  for each row execute function app.audit();

-- A model with any role has exactly one primary. The first role given is
-- the primary; making another the primary steps the old one down; taking
-- the primary away hands it to the first of the rest.
create function app.keep_primary_role() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  next_role uuid;
begin
  -- The database's own housekeeping: the hand-over below, or a model going.
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.is_primary then
      select r.role_id into next_role
      from public.ship_model_roles r join public.ship_roles s on s.id = r.role_id
      where r.model_id = old.model_id and r.role_id <> old.role_id
      order by s.sort_order, s.name limit 1;
      if next_role is not null then
        update public.ship_model_roles set is_primary = true where model_id = old.model_id and role_id = next_role;
      end if;
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.model_id is distinct from old.model_id or new.role_id is distinct from old.role_id) then
    raise exception 'A role is given to a model or taken away, not moved.' using errcode = '42501';
  end if;
  if new.is_primary then
    if tg_op = 'INSERT' or not old.is_primary then
      update public.ship_model_roles set is_primary = false where model_id = new.model_id and role_id <> new.role_id and is_primary;
    end if;
  elsif tg_op = 'INSERT' then
    if not exists (select 1 from public.ship_model_roles where model_id = new.model_id and is_primary) then
      new.is_primary := true;
    end if;
  elsif old.is_primary then
    -- The primary steps down only when another steps up, which the branch above does.
    raise exception 'Make another role the primary instead.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger ship_model_roles_guard before insert or update on public.ship_model_roles
  for each row execute function app.keep_primary_role();
create trigger ship_model_roles_handover after delete on public.ship_model_roles
  for each row execute function app.keep_primary_role();

-- ---------------------------------------------------------------------------
-- A hull in claim
-- ---------------------------------------------------------------------------

alter table public.ships add column in_claim boolean not null default false;
alter table public.ships add constraint ships_not_ready_in_claim check (not (ready and in_claim));

-- As before, with the claim: marking a hull in claim marks it not ready, and
-- marking it ready ends the claim. Two more things put right while it is
-- restated. The database's own housekeeping passes, as it does in the other
-- guards: a member's discharge stands their ships down from a trigger, which
-- used to be refused because the owner was no longer serving. And the owner
-- is checked against the serving fleet only when the owner changes. The
-- stated function keeps its search path.
create or replace function app.guard_ship() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  command boolean;
begin
  if tg_op = 'UPDATE' then
    if new.in_claim and not old.in_claim then
      new.ready := false;
    elsif new.ready and not old.ready then
      new.in_claim := false;
    end if;
  end if;
  if app.is_trusted_context() or pg_trigger_depth() > 1 then
    if tg_op = 'UPDATE' then
      new.updated_at := now();
      if new.ready is distinct from old.ready or new.in_claim is distinct from old.in_claim then
        new.ready_as_of := now();
      end if;
    end if;
    return new;
  end if;
  if not app.is_serving() then
    raise exception 'The register is for the serving fleet.' using errcode = '42501';
  end if;
  command := app.has_role('command');
  if tg_op = 'INSERT' then
    if not command then
      new.owner_id := me;
    elsif new.owner_id is not null and not app.is_serving_member(new.owner_id) then
      raise exception 'A ship is registered to a serving member, or to the fleet.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.ship_models m where m.id = new.model_id and m.flyable) then
      raise exception 'That model cannot be flown yet.' using errcode = '23514';
    end if;
    new.in_claim := false;
    new.registered_by := me;
    new.registered_at := now();
    new.ready_as_of := now();
    new.updated_at := now();
    return new;
  end if;
  -- An owner changes a ship's name and its mark. Command changes anything else.
  new.registered_by := old.registered_by;
  new.registered_at := old.registered_at;
  if not command then
    if old.owner_id is distinct from me then
      raise exception 'Only the owner or command changes a ship.' using errcode = '42501';
    end if;
    new.owner_id := old.owner_id;
    new.model_id := old.model_id;
  elsif new.owner_id is distinct from old.owner_id and new.owner_id is not null and not app.is_serving_member(new.owner_id) then
    raise exception 'A ship is registered to a serving member, or to the fleet.' using errcode = '23514';
  end if;
  new.ready_as_of := case when new.ready is distinct from old.ready or new.in_claim is distinct from old.in_claim then now() else old.ready_as_of end;
  new.updated_at := now();
  return new;
end;
$$;

-- A hull marked in claim is withdrawn as one marked not ready is. The guard
-- above clears ready when the claim is set, so the withdrawal sees a hull
-- going from ready to not; the trigger has to fire on the claim column too,
-- so it is restated with the claim in its list.
create or replace trigger ships_withdraw_offers after update of ready, owner_id, in_claim on public.ships
  for each row execute function app.withdraw_offers();

-- ---------------------------------------------------------------------------
-- The roles, and a first classification of the models for command to correct
-- ---------------------------------------------------------------------------

insert into public.ship_roles (slug, name, description, sort_order) values
  ('command', 'Command', 'Leads a formation: the flagship, the command post, the net control.', 10),
  ('escort', 'Escort', 'Protects a formation from fighters.', 20),
  ('strike', 'Strike', 'Attacks ships and targets with heavy weapons, torpedoes or bombs.', 30),
  ('fire-support', 'Fire support', 'Brings guns to bear for others: a gunship or a corvette on station.', 40),
  ('assault-transport', 'Assault transport', 'Carries troops to the fight and brings them out.', 50),
  ('reconnaissance', 'Reconnaissance', 'Finds, scans and watches, and sees without being seen.', 60),
  ('logistics', 'Logistics', 'Carries cargo, fuel and supplies to where they are needed.', 70),
  ('medical', 'Medical', 'Treats and evacuates the wounded.', 80),
  ('recovery', 'Recovery', 'Brings back hulls, crews and wrecks: salvage, repair and retrieval.', 90),
  ('industry', 'Industry', 'Earns for the fleet: mining and salvage for the bank.', 100),
  ('training', 'Training', 'Teaches: the hulls the training ship flies and a recruit starts in.', 110);

-- The first role named for each model is its primary.
insert into public.ship_model_roles (model_id, role_id, is_primary)
select m.id, r.id, v.n = 1
from (values
  ('idris-m', 'command', 1), ('idris-m', 'fire-support', 2),
  ('idris-p', 'command', 1), ('idris-p', 'fire-support', 2),
  ('polaris', 'command', 1), ('polaris', 'strike', 2), ('polaris', 'fire-support', 3),
  ('hammerhead', 'fire-support', 1), ('hammerhead', 'escort', 2),
  ('890-jump', 'command', 1), ('890-jump', 'medical', 2),
  ('redeemer', 'fire-support', 1), ('redeemer', 'assault-transport', 2),
  ('cutlass-blue', 'fire-support', 1), ('cutlass-blue', 'assault-transport', 2),
  ('constellation-andromeda', 'fire-support', 1), ('constellation-andromeda', 'logistics', 2),
  ('valkyrie', 'assault-transport', 1), ('valkyrie', 'fire-support', 2),
  ('cutlass-black', 'assault-transport', 1), ('cutlass-black', 'logistics', 2),
  ('cutlass-red', 'medical', 1), ('cutlass-red', 'assault-transport', 2),
  ('pisces-c8r', 'medical', 1),
  ('gladius', 'escort', 1), ('gladius', 'training', 2),
  ('arrow', 'escort', 1), ('arrow', 'reconnaissance', 2),
  ('f7c-hornet-mk-ii', 'escort', 1), ('f7c-hornet-mk-ii', 'strike', 2),
  ('f7a-hornet-mk-ii', 'escort', 1), ('f7a-hornet-mk-ii', 'strike', 2),
  ('f8c-lightning', 'strike', 1), ('f8c-lightning', 'escort', 2),
  ('sabre', 'escort', 1), ('sabre', 'reconnaissance', 2),
  ('hurricane', 'escort', 1), ('hurricane', 'strike', 2),
  ('scorpius', 'escort', 1), ('scorpius', 'strike', 2),
  ('vanguard-warden', 'escort', 1), ('vanguard-warden', 'strike', 2),
  ('vanguard-sentinel', 'reconnaissance', 1), ('vanguard-sentinel', 'escort', 2),
  ('vanguard-harbinger', 'strike', 1),
  ('ares-inferno', 'strike', 1), ('ares-inferno', 'fire-support', 2),
  ('ares-ion', 'strike', 1), ('ares-ion', 'fire-support', 2),
  ('buccaneer', 'escort', 1),
  ('avenger-titan', 'training', 1), ('avenger-titan', 'logistics', 2),
  ('aurora-mk-ii', 'training', 1),
  ('mustang-alpha', 'training', 1),
  ('fury', 'escort', 1),
  ('guardian', 'escort', 1),
  ('eclipse', 'strike', 1), ('eclipse', 'reconnaissance', 2),
  ('gladiator', 'strike', 1),
  ('retaliator', 'strike', 1),
  ('a2-hercules', 'strike', 1), ('a2-hercules', 'logistics', 2),
  ('constellation-taurus', 'logistics', 1),
  ('freelancer', 'logistics', 1),
  ('freelancer-max', 'logistics', 1),
  ('starlancer-max', 'logistics', 1),
  ('caterpillar', 'logistics', 1), ('caterpillar', 'recovery', 2),
  ('c2-hercules', 'logistics', 1),
  ('m2-hercules', 'logistics', 1), ('m2-hercules', 'assault-transport', 2),
  ('mercury-star-runner', 'reconnaissance', 1), ('mercury-star-runner', 'logistics', 2),
  ('spirit-c1', 'logistics', 1), ('spirit-c1', 'assault-transport', 2),
  ('zeus-mk-ii-cl', 'logistics', 1),
  ('zeus-mk-ii-es', 'reconnaissance', 1),
  ('constellation-aquila', 'reconnaissance', 1), ('constellation-aquila', 'logistics', 2),
  ('corsair', 'reconnaissance', 1), ('corsair', 'fire-support', 2),
  ('carrack', 'command', 1), ('carrack', 'reconnaissance', 2), ('carrack', 'medical', 3),
  ('600i', 'reconnaissance', 1), ('600i', 'command', 2),
  ('400i', 'reconnaissance', 1),
  ('terrapin', 'reconnaissance', 1),
  ('starfarer', 'logistics', 1),
  ('starfarer-gemini', 'logistics', 1),
  ('reclaimer', 'recovery', 1), ('reclaimer', 'industry', 2),
  ('vulture', 'recovery', 1), ('vulture', 'industry', 2),
  ('prospector', 'industry', 1),
  ('mole', 'industry', 1),
  ('pisces-c8x', 'assault-transport', 1), ('pisces-c8x', 'training', 2),
  ('cutter', 'training', 1), ('cutter', 'logistics', 2),
  ('nomad', 'logistics', 1),
  ('intrepid', 'training', 1), ('intrepid', 'logistics', 2)
) as v (model, role, n)
join public.ship_models m on m.slug = v.model
join public.ship_roles r on r.slug = v.role
order by v.n;

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant all on public.ship_roles, public.ship_model_roles to service_role;

grant select, insert, update, delete on public.ship_roles to authenticated;
grant select on public.ship_model_roles to authenticated;
grant insert (model_id, role_id, is_primary) on public.ship_model_roles to authenticated;
grant update (is_primary) on public.ship_model_roles to authenticated;
grant delete on public.ship_model_roles to authenticated;
grant update (in_claim) on public.ships to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.ship_roles enable row level security;
alter table public.ship_model_roles enable row level security;

create policy "The fleet reads the ship roles" on public.ship_roles
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Admins add ship roles" on public.ship_roles
  for insert to authenticated with check ((select app.has_role('admin')));
create policy "Admins change ship roles" on public.ship_roles
  for update to authenticated using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
create policy "Admins remove ship roles" on public.ship_roles
  for delete to authenticated using ((select app.has_role('admin')));

create policy "The fleet reads each model's roles" on public.ship_model_roles
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Command gives a model a role" on public.ship_model_roles
  for insert to authenticated with check ((select app.has_role('command')));
create policy "Command changes a model's primary role" on public.ship_model_roles
  for update to authenticated using ((select app.has_role('command'))) with check ((select app.has_role('command')));
create policy "Command takes a role off a model" on public.ship_model_roles
  for delete to authenticated using ((select app.has_role('command')));
