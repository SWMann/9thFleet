-- The responsibility matrix: roles with a stage and a fallback, areas as the
-- matrix groups them, operation types extended, and the situations and tasks
--
-- The task-first workbook of 14, 15 and 20 October, built from the full-size
-- fleet downwards, comes onto the site:
--
--   Roles. Every post of the matrix is a role of the order of battle. A role
--   says the stage it exists from and which role holds its tasks until then
--   (the fallback chain), its echelon, whether it is an officer's or a
--   rating's, and, for a speciality, the role it is a speciality of. Roles
--   the site already had keep their records; where the matrix names them
--   differently they are renamed and keep their old address as a former
--   slug, so the old page forwards to the new. Fleet staff posts that
--   overlap the site's staff duties map onto the duties.
--   Areas. The areas of work follow the matrix's categories: Command posts
--   becomes Naval Command, Helm and navigation becomes Support, Ship security
--   becomes Security, Fighters becomes Pilots, Staff duties becomes Staff;
--   Intelligence and Logistics are new.
--   Operation types. The event types gain the matrix's facts: family, aim,
--   the stage each opens at, what it needs, minimum and typical force. The
--   twelve types the site lacked are added; Response becomes Quick reaction.
--   Situations. Sixteen things that can land on any night, with who calls
--   each on the net and who owns it.
--   Tasks. 169 rows: a spine every operation shares, a module per type, a
--   drill per situation. Each names who does it, who supervises (command and
--   technical), who leads, who is consulted and who is informed, as roles,
--   plus the stage it is needed from.
--
-- The serving fleet reads the situations and tasks; admins keep them under
-- Structure.

-- ---------------------------------------------------------------------------
-- Roles: a stage, a fallback, an echelon, a type, a speciality, former addresses
-- ---------------------------------------------------------------------------

alter table public.areas add column former_slugs text[] not null default '{}' check (cardinality(former_slugs) <= 10);

alter table public.fleet_roles
  add column exists_from smallint not null default 1 check (exists_from between 1 and 4),
  add column fallback_role_id uuid references public.fleet_roles (id) on delete set null,
  add column echelon text not null default '' check (echelon in ('', 'Fleet', 'Task force', 'Air group', 'Ship', 'Section', 'Individual')),
  add column post_type text not null default '' check (post_type in ('', 'officer', 'rating', 'either')),
  add column speciality_of_role_id uuid references public.fleet_roles (id) on delete set null,
  add column former_slugs text[] not null default '{}' check (cardinality(former_slugs) <= 10),
  add constraint fleet_roles_not_own_fallback check (fallback_role_id is null or fallback_role_id <> id),
  add constraint fleet_roles_not_own_speciality check (speciality_of_role_id is null or speciality_of_role_id <> id);
create index fleet_roles_fallback_idx on public.fleet_roles (fallback_role_id) where fallback_role_id is not null;
create index fleet_roles_speciality_idx on public.fleet_roles (speciality_of_role_id) where speciality_of_role_id is not null;

-- A fallback chain ends: no role falls back, through others, to itself. A
-- speciality is of a base role, not of another speciality.
create function app.guard_role_chain() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  seen uuid[] := array[new.id];
  at uuid := new.fallback_role_id;
  hops integer := 0;
begin
  while at is not null loop
    if at = any(seen) then
      raise exception 'A fallback chain cannot come back to the role it started from.' using errcode = '23514';
    end if;
    hops := hops + 1;
    if hops > 12 then
      raise exception 'A fallback chain is at most twelve roles long.' using errcode = '23514';
    end if;
    seen := seen || at;
    select r.fallback_role_id into at from public.fleet_roles r where r.id = at;
  end loop;
  if new.speciality_of_role_id is not null and exists (select 1 from public.fleet_roles b where b.id = new.speciality_of_role_id and b.speciality_of_role_id is not null) then
    raise exception 'A speciality is of a base role, not of another speciality.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger fleet_roles_chain before insert or update of fallback_role_id, speciality_of_role_id on public.fleet_roles
  for each row execute function app.guard_role_chain();

-- An address that changes goes on forwarding: the old slug is kept on the
-- record, newest last, and the site sends a reader of the old address to the
-- new one. At most ten are kept; the oldest is dropped.
create function app.keep_former_slug() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug then
    new.former_slugs := array_remove(coalesce(old.former_slugs, '{}'), new.slug) || old.slug;
    while cardinality(new.former_slugs) > 10 loop
      new.former_slugs := new.former_slugs[2:];
    end loop;
  end if;
  return new;
end;
$$;
create trigger areas_former_slug before update of slug on public.areas
  for each row execute function app.keep_former_slug();
create trigger fleet_roles_former_slug before update of slug on public.fleet_roles
  for each row execute function app.keep_former_slug();

-- ---------------------------------------------------------------------------
-- Areas as the matrix groups them
-- ---------------------------------------------------------------------------

update public.areas set slug = 'naval-command', name = 'Naval Command', former_slugs = array['command'], about = 'The commanders and their deputies, from the Fleet Commander to the commanding officer of a ship, and the staff of the fleet and the task force.' where slug = 'command';
update public.areas set slug = 'support', name = 'Support', former_slugs = array['helm'], about = 'The bridge and the ship''s support ratings: helm, navigator, sensors, the officer of the watch, the coxswain, and the boatswain with the cargo handlers.' where slug = 'helm';
update public.areas set slug = 'security', name = 'Security', former_slugs = array['ship-security'], about = 'A ship''s security section: the Master-at-Arms, security leads and their people, who repel boarders and board. From stage 5 the Marines post a ship security detachment aboard.' where slug = 'ship-security';
update public.areas set slug = 'pilots', name = 'Pilots', former_slugs = array['fighters'], about = 'The pilots of the air wing and those who command them. A full flight is 12 aircraft in three sections of four, and the flight leader flies as one of them. A speciality is a pilot with particular kit: fighter, strike, scout, dropship, medevac, transport.' where slug = 'fighters';
update public.areas set slug = 'staff', name = 'Staff', former_slugs = array['staff-duties'], about = 'The fleet''s and the task force''s staff: operations, training, and the part-time staff duties held as well as a post. A duty carries no rank.' where slug = 'staff-duties';
update public.areas set about = 'The gunners at a ship''s turrets, remote stations, point defence and tubes, their leads and the officer who directs the ship''s fire.' where slug = 'gunnery';
update public.areas set about = 'A ship''s engineers, led by the Chief Engineer under the Engineering Officer: her systems, repairs and damage control.' where slug = 'engineering';
update public.areas set about = 'The flight deck: launch and recovery, rearming and refuelling, and the air controller on the bridge.' where slug = 'flight-deck';
update public.areas set about = 'The ship''s medics and those who lead them. The medical chain is planned per operation by the Senior Medical Officer.' where slug = 'medical';
update public.areas set about = 'The signallers who run the nets and keep the log, and the officers who plan and own the fleet''s communications.' where slug = 'signals';
insert into public.areas (slug, name, domain, picture, about, planned_stage, planned_size, reading, sort_order) values
  ('intelligence', 'Intelligence', 'staff', 'areaOther', 'The fleet''s picture: the hostile list, the piracy reports, and the intelligence picture built for each operation.', 2, 'An analyst, then a task force intelligence officer', array['command/reports']::text[], 16),
  ('logistics', 'Logistics', 'support', 'areaOther', 'Fuel, ammunition, repair, spare ships and the bank: what an operation needs to sail and to carry on.', null, '', array['organisation/navy-squadron']::text[], 17);

-- ---------------------------------------------------------------------------
-- Roles the site had, as the matrix names them
-- ---------------------------------------------------------------------------

update public.fleet_roles set exists_from = 1, echelon = 'Fleet', post_type = 'officer', area_id = (select id from public.areas where slug = 'naval-command') where slug = 'fleet-commander';
update public.fleet_roles set exists_from = 1, echelon = 'Ship', post_type = 'officer', area_id = (select id from public.areas where slug = 'naval-command') where slug = 'commanding-officer';
update public.fleet_roles set exists_from = 1, echelon = 'Ship', post_type = 'officer', area_id = (select id from public.areas where slug = 'naval-command') where slug = 'executive-officer';
update public.fleet_roles set exists_from = 3, echelon = 'Ship', post_type = 'officer', area_id = (select id from public.areas where slug = 'gunnery'), slug = 'gunnery-officer', name = 'Gunnery Officer', former_slugs = array['tactical-officer'], summary = 'Directs the ship''s fire: allots targets and sectors to the gunners and answers to the Executive Officer. Second on the flagship''s succession list.' where slug = 'tactical-officer';
update public.fleet_roles set exists_from = 3, echelon = 'Ship', post_type = 'rating', area_id = (select id from public.areas where slug = 'support'), slug = 'coxswain', name = 'Coxswain', former_slugs = array['chief-of-the-boat'] where slug = 'chief-of-the-boat';
update public.fleet_roles set exists_from = 1, echelon = 'Individual', post_type = 'rating', area_id = (select id from public.areas where slug = 'signals') where slug = 'signaller';
update public.fleet_roles set exists_from = 1, echelon = 'Ship', post_type = 'rating', area_id = (select id from public.areas where slug = 'support'), slug = 'helm', name = 'Helm', former_slugs = array['helmsman'], summary = 'At the helm of a ship, on the ordered route and timings. On the flagship the helm is enlisted, and is backed up by the Navigator.' where slug = 'helmsman';
update public.fleet_roles set exists_from = 2, echelon = 'Ship', post_type = 'rating', area_id = (select id from public.areas where slug = 'support') where slug = 'navigator';
update public.fleet_roles set exists_from = 2, echelon = 'Section', post_type = 'rating', area_id = (select id from public.areas where slug = 'gunnery'), slug = 'lead-gunner', name = 'Lead Gunner', former_slugs = array['gunnery-chief'], summary = 'Leads a section of gunners: briefs them, confirms their jobs and net, and records their lessons.' where slug = 'gunnery-chief';
update public.fleet_roles set exists_from = 1, echelon = 'Individual', post_type = 'rating', area_id = (select id from public.areas where slug = 'gunnery') where slug = 'gunner';
update public.fleet_roles set exists_from = 4, echelon = 'Ship', post_type = 'rating', area_id = (select id from public.areas where slug = 'engineering') where slug = 'chief-engineer';
update public.fleet_roles set exists_from = 2, echelon = 'Section', post_type = 'rating', area_id = (select id from public.areas where slug = 'engineering'), slug = 'lead-engineer', name = 'Lead Engineer', former_slugs = array['senior-engineer'], summary = 'Leads a section of engineers through the pre-sail checks, the night and the repairs after.' where slug = 'senior-engineer';
update public.fleet_roles set exists_from = 1, echelon = 'Individual', post_type = 'rating', area_id = (select id from public.areas where slug = 'engineering') where slug = 'engineer';
update public.fleet_roles set exists_from = 1, echelon = 'Individual', post_type = 'rating', area_id = (select id from public.areas where slug = 'medical') where slug = 'medic';
update public.fleet_roles set exists_from = 3, echelon = 'Section', post_type = 'rating', area_id = (select id from public.areas where slug = 'flight-deck'), slug = 'deck-chief', name = 'Deck Chief', former_slugs = array['flight-deck-chief'], summary = 'Leads the flight deck: controls launch and recovery on the deck net.' where slug = 'flight-deck-chief';
update public.fleet_roles set exists_from = 2, echelon = 'Individual', post_type = 'rating', area_id = (select id from public.areas where slug = 'flight-deck'), slug = 'deck-crew', name = 'Deck Crew', former_slugs = array['deck-hand'], summary = 'Readies the fighters to launch and recovers them: fuel, arms, pilots in cockpits.' where slug = 'deck-hand';
update public.fleet_roles set exists_from = 4, echelon = 'Ship', post_type = 'rating', area_id = (select id from public.areas where slug = 'security') where slug = 'master-at-arms';
update public.fleet_roles set exists_from = 3, echelon = 'Section', post_type = 'officer', area_id = (select id from public.areas where slug = 'pilots'), slug = 'flight-leader', name = 'Flight Leader', former_slugs = array['flight-lead'] where slug = 'flight-lead';
update public.fleet_roles set exists_from = 2, echelon = 'Individual', post_type = 'rating', area_id = (select id from public.areas where slug = 'pilots') where slug = 'fighter-pilot';
update public.fleet_roles set exists_from = 2, echelon = 'Individual', post_type = 'either', area_id = (select id from public.areas where slug = 'staff') where slug = 'instructor';
update public.fleet_roles set exists_from = 3, echelon = 'Fleet', post_type = 'officer', area_id = (select id from public.areas where slug = 'staff') where slug = 'commandant-training-school';
update public.fleet_roles set exists_from = 4, echelon = 'Fleet', post_type = 'officer', area_id = (select id from public.areas where slug = 'staff') where slug = 'head-of-operations-and-planning';
update public.fleet_roles set exists_from = 3, echelon = 'Fleet', post_type = 'officer', area_id = (select id from public.areas where slug = 'logistics') where slug = 'head-of-logistics-and-medical';

-- ---------------------------------------------------------------------------
-- The roles the matrix adds
-- ---------------------------------------------------------------------------

insert into public.fleet_roles (slug, name, area_id, kind, summary, exists_from, echelon, post_type, sort_order) values
  ('fleet-executive-officer', 'Fleet Executive Officer', (select id from public.areas where slug = 'naval-command'), 'primary', 'The Fleet Commander''s deputy. Owns the fleet''s comms procedure until a Signals Officer exists, and stands in for every fleet staff post before it opens.', 1, 'Fleet', 'officer', 101),
  ('fleet-intelligence-officer', 'Fleet Intelligence Officer', (select id from public.areas where slug = 'intelligence'), 'primary', 'Keeps the fleet''s picture: the hostile list, the piracy reports and what bears on each operation.', 4, 'Fleet', 'officer', 102),
  ('chief-signals-officer', 'Chief Signals Officer', (select id from public.areas where slug = 'signals'), 'primary', 'The most senior signals officer of the fleet: sets the standard for every net.', 4, 'Fleet', 'officer', 103),
  ('chief-medical-officer', 'Chief Medical Officer', (select id from public.areas where slug = 'medical'), 'primary', 'The most senior medical officer of the fleet: sets the standard for the medical chain.', 4, 'Fleet', 'officer', 104),
  ('fleet-duty-officer', 'Fleet Duty Officer', (select id from public.areas where slug = 'naval-command'), 'primary', 'Covers the day for the fleet once there is more than one time zone: takes reports marked happening now, deconflicts operations, hands over the picture.', 4, 'Fleet', 'officer', 105),
  ('task-force-commander', 'Task Force Commander', (select id from public.areas where slug = 'naval-command'), 'primary', 'Runs an operation: chooses it, briefs it, orders the force underway, decides to engage, press or withdraw.', 3, 'Task force', 'officer', 106),
  ('task-force-executive-officer', 'Task Force Executive Officer', (select id from public.areas where slug = 'naval-command'), 'primary', 'The task force''s deputy: strength and muster, who steps up, the stand-down.', 4, 'Task force', 'officer', 107),
  ('task-force-operations-officer', 'Task Force Operations Officer', (select id from public.areas where slug = 'staff'), 'primary', 'Drafts the operation on the site: orders, plan, timings, the force and its tasks; writes the after-action report.', 3, 'Task force', 'officer', 108),
  ('task-force-intelligence-officer', 'Task Force Intelligence Officer', (select id from public.areas where slug = 'intelligence'), 'primary', 'Builds the operation''s intelligence picture and keeps it current underway.', 3, 'Task force', 'officer', 109),
  ('senior-signals-officer', 'Senior Signals Officer', (select id from public.areas where slug = 'signals'), 'primary', 'Plans the nets for an operation and runs the comms check across the force.', 4, 'Task force', 'officer', 110),
  ('senior-medical-officer', 'Senior Medical Officer', (select id from public.areas where slug = 'medical'), 'primary', 'Plans the medical chain for an operation and runs it across the force.', 4, 'Task force', 'officer', 111),
  ('task-force-logistics-officer', 'Task Force Logistics Officer', (select id from public.areas where slug = 'logistics'), 'primary', 'Fuel, ammunition, repair and spare ships for the night; replaces losses.', 4, 'Task force', 'officer', 112),
  ('senior-flight-commander', 'Senior Flight Commander', (select id from public.areas where slug = 'pilots'), 'primary', 'Commands the operation''s air: the launch sequence, the flights, escort and strike tasks, across every ship''s air group.', 3, 'Task force', 'officer', 113),
  ('escort-commander', 'Escort Commander', (select id from public.areas where slug = 'naval-command'), 'primary', 'Stations the escorts and screens the capital ships.', 4, 'Task force', 'officer', 114),
  ('sensor-operator', 'Sensor Operator', (select id from public.areas where slug = 'support'), 'primary', 'Watches sensors; detects and reports contacts to the bridge and the command net.', 2, 'Ship', 'rating', 115),
  ('quartermaster', 'Quartermaster', (select id from public.areas where slug = 'logistics'), 'primary', 'The ship''s stores: fuel, ammunition, components and cargo.', 3, 'Ship', 'rating', 116),
  ('chief-gunner', 'Chief Gunner', (select id from public.areas where slug = 'gunnery'), 'primary', 'The gunnery department''s chief rating: standards and training.', 4, 'Ship', 'rating', 117),
  ('engineering-officer', 'Engineering Officer', (select id from public.areas where slug = 'engineering'), 'primary', 'The ship''s engineering officer: keeps her systems running and leads damage control.', 3, 'Ship', 'officer', 118),
  ('flight-deck-officer', 'Flight Deck Officer', (select id from public.areas where slug = 'flight-deck'), 'primary', 'The ship''s flight deck officer: launch, recovery, rearming and refuelling of her aircraft.', 4, 'Ship', 'officer', 119),
  ('flight-commander', 'Flight Commander', (select id from public.areas where slug = 'pilots'), 'primary', 'Commands a ship''s air group: briefs the pilots, controls launch and recovery with the deck, fights the air battle.', 2, 'Air group', 'officer', 120),
  ('pilot', 'Pilot', (select id from public.areas where slug = 'pilots'), 'primary', 'A line pilot of the air wing. The specialities (fighter, strike, scout, dropship, medevac, transport) are pilots with particular kit.', 1, 'Individual', 'rating', 121),
  ('security-officer', 'Security Officer', (select id from public.areas where slug = 'security'), 'primary', 'The ship''s security officer: repelling boarders, boarding, prisoners.', 4, 'Ship', 'officer', 122),
  ('security-lead', 'Security Lead', (select id from public.areas where slug = 'security'), 'primary', 'Leads a security section: defends the bridge and engineering, leads a boarding.', 3, 'Section', 'rating', 123),
  ('security', 'Security', (select id from public.areas where slug = 'security'), 'primary', 'A member of a ship''s security section.', 2, 'Individual', 'rating', 124),
  ('medical-officer', 'Medical Officer', (select id from public.areas where slug = 'medical'), 'primary', 'The ship''s medical officer: the medical bay and the medics'' standards.', 3, 'Ship', 'officer', 125),
  ('chief-medic', 'Chief Medic', (select id from public.areas where slug = 'medical'), 'primary', 'The medical department''s chief rating: standards and training.', 4, 'Ship', 'rating', 126),
  ('lead-medic', 'Lead Medic', (select id from public.areas where slug = 'medical'), 'primary', 'Leads a medical section: treats casualties where they fall and moves them to the bay.', 2, 'Section', 'rating', 127),
  ('signals-officer', 'Signals Officer', (select id from public.areas where slug = 'signals'), 'primary', 'The ship''s signals officer: her nets, their procedure and the log.', 3, 'Ship', 'officer', 128),
  ('chief-of-signals', 'Chief of Signals', (select id from public.areas where slug = 'signals'), 'primary', 'The signals department''s chief rating: standards and training.', 4, 'Ship', 'rating', 129),
  ('lead-signaller', 'Lead Signaller', (select id from public.areas where slug = 'signals'), 'primary', 'Leads a signals section and runs the comms check for the ship.', 2, 'Section', 'rating', 130),
  ('officer-of-the-watch', 'Officer of the Watch', (select id from public.areas where slug = 'support'), 'primary', 'Has the bridge watch: the ship''s conduct underway when the Commanding Officer is not on the bridge.', 2, 'Ship', 'officer', 131),
  ('boatswain', 'Boatswain', (select id from public.areas where slug = 'support'), 'primary', 'Leads the cargo handlers: loading, securing and tractor-beam work.', 3, 'Section', 'rating', 132),
  ('cargo-handler', 'Cargo Handler', (select id from public.areas where slug = 'support'), 'primary', 'Loads and secures cargo and stores; tractor-beam work.', 2, 'Individual', 'rating', 133),
  ('fire-controller', 'Fire Controller', (select id from public.areas where slug = 'gunnery'), 'primary', 'Allots targets and sectors to the gunners on the Gunnery Officer''s direction.', 3, 'Section', 'rating', 134),
  ('turret-gunner', 'Turret Gunner', (select id from public.areas where slug = 'gunnery'), 'primary', 'A gunner at a manned turret.', 2, 'Individual', 'rating', 135),
  ('remote-gunner', 'Remote Gunner', (select id from public.areas where slug = 'gunnery'), 'primary', 'A gunner at a remote weapons station.', 2, 'Individual', 'rating', 136),
  ('point-defence-gunner', 'Point-Defence Gunner', (select id from public.areas where slug = 'gunnery'), 'primary', 'A gunner on point defence against missiles and fighters.', 2, 'Individual', 'rating', 137),
  ('torpedo-operator', 'Torpedo Operator', (select id from public.areas where slug = 'gunnery'), 'primary', 'A gunner who locks and fires the torpedoes.', 2, 'Individual', 'rating', 138),
  ('loader', 'Loader', (select id from public.areas where slug = 'gunnery'), 'primary', 'A gunner who loads and readies the tubes.', 2, 'Individual', 'rating', 139),
  ('air-controller', 'Air Controller', (select id from public.areas where slug = 'flight-deck'), 'primary', 'Controls the air picture from the bridge: hands contacts to the air and keeps the pilots informed.', 3, 'Ship', 'either', 140),
  ('strike-pilot', 'Strike Pilot', (select id from public.areas where slug = 'pilots'), 'primary', 'A pilot flying strike: bombs and torpedoes against ships and targets.', 3, 'Individual', 'rating', 141),
  ('scout-pilot', 'Scout Pilot', (select id from public.areas where slug = 'pilots'), 'primary', 'A pilot who scouts ahead of the force and watches without being seen.', 2, 'Individual', 'rating', 142),
  ('dropship-pilot', 'Dropship Pilot', (select id from public.areas where slug = 'pilots'), 'primary', 'A pilot who carries troops to the fight and brings them out. Opens with the Army.', 3, 'Individual', 'rating', 143),
  ('medevac-pilot', 'Medevac Pilot', (select id from public.areas where slug = 'pilots'), 'primary', 'A pilot who flies casualties to a medical bed.', 2, 'Individual', 'rating', 144),
  ('transport-pilot', 'Transport Pilot', (select id from public.areas where slug = 'pilots'), 'primary', 'A pilot who flies cargo, stores and spare ships.', 2, 'Individual', 'rating', 145),
  ('field-medic', 'Field Medic', (select id from public.areas where slug = 'medical'), 'primary', 'A medic who treats casualties where they fall, with a boarding party or on the ground.', 2, 'Individual', 'rating', 146),
  ('sar-medic', 'SAR Medic', (select id from public.areas where slug = 'medical'), 'primary', 'A medic for search and rescue: treats and moves a crew adrift.', 2, 'Individual', 'rating', 147),
  ('analyst', 'Analyst', (select id from public.areas where slug = 'intelligence'), 'primary', 'Keeps the hostile list and the piracy reports current and passes what bears on an operation.', 2, 'Individual', 'rating', 148);

-- The fallback chain and the specialities, now that every role exists.
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'head-of-operations-and-planning' and f.slug = 'fleet-executive-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'fleet-intelligence-officer' and f.slug = 'task-force-intelligence-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'chief-signals-officer' and f.slug = 'senior-signals-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'chief-medical-officer' and f.slug = 'senior-medical-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'head-of-logistics-and-medical' and f.slug = 'fleet-executive-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'fleet-duty-officer' and f.slug = 'fleet-executive-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'commandant-training-school' and f.slug = 'instructor';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'task-force-commander' and f.slug = 'fleet-commander';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'task-force-executive-officer' and f.slug = 'fleet-executive-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'task-force-operations-officer' and f.slug = 'fleet-executive-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'task-force-intelligence-officer' and f.slug = 'fleet-executive-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'senior-signals-officer' and f.slug = 'signals-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'senior-medical-officer' and f.slug = 'medical-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'task-force-logistics-officer' and f.slug = 'head-of-logistics-and-medical';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'senior-flight-commander' and f.slug = 'flight-commander';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'escort-commander' and f.slug = 'task-force-commander';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'navigator' and f.slug = 'helm';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'sensor-operator' and f.slug = 'executive-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'quartermaster' and f.slug = 'lead-engineer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'gunnery-officer' and f.slug = 'lead-gunner';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'chief-gunner' and f.slug = 'gunnery-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'lead-gunner' and f.slug = 'gunner';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'engineering-officer' and f.slug = 'lead-engineer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'lead-engineer' and f.slug = 'engineer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'flight-deck-officer' and f.slug = 'deck-chief';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'deck-chief' and f.slug = 'deck-crew';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'deck-crew' and f.slug = 'engineer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'flight-commander' and f.slug = 'commanding-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'flight-leader' and f.slug = 'flight-commander';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'security-officer' and f.slug = 'security-lead';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'security-lead' and f.slug = 'security';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'security' and f.slug = 'gunner';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'medical-officer' and f.slug = 'lead-medic';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'chief-medic' and f.slug = 'medical-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'lead-medic' and f.slug = 'medic';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'signals-officer' and f.slug = 'executive-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'chief-of-signals' and f.slug = 'signals-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'lead-signaller' and f.slug = 'signaller';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'instructor' and f.slug = 'fleet-commander';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'officer-of-the-watch' and f.slug = 'executive-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'coxswain' and f.slug = 'executive-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'boatswain' and f.slug = 'cargo-handler';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'cargo-handler' and f.slug = 'engineer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'fire-controller' and f.slug = 'lead-gunner';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'turret-gunner' and f.slug = 'gunner';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'remote-gunner' and f.slug = 'gunner';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'point-defence-gunner' and f.slug = 'gunner';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'torpedo-operator' and f.slug = 'gunner';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'loader' and f.slug = 'gunner';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'chief-engineer' and f.slug = 'engineering-officer';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'air-controller' and f.slug = 'sensor-operator';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'fighter-pilot' and f.slug = 'pilot';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'strike-pilot' and f.slug = 'pilot';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'scout-pilot' and f.slug = 'pilot';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'dropship-pilot' and f.slug = 'pilot';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'medevac-pilot' and f.slug = 'pilot';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'transport-pilot' and f.slug = 'pilot';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'master-at-arms' and f.slug = 'security-lead';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'field-medic' and f.slug = 'medic';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'sar-medic' and f.slug = 'medic';
update public.fleet_roles r set fallback_role_id = f.id from public.fleet_roles f where r.slug = 'analyst' and f.slug = 'task-force-intelligence-officer';
update public.fleet_roles r set speciality_of_role_id = b.id from public.fleet_roles b where r.slug = 'turret-gunner' and b.slug = 'gunner';
update public.fleet_roles r set speciality_of_role_id = b.id from public.fleet_roles b where r.slug = 'remote-gunner' and b.slug = 'gunner';
update public.fleet_roles r set speciality_of_role_id = b.id from public.fleet_roles b where r.slug = 'point-defence-gunner' and b.slug = 'gunner';
update public.fleet_roles r set speciality_of_role_id = b.id from public.fleet_roles b where r.slug = 'torpedo-operator' and b.slug = 'gunner';
update public.fleet_roles r set speciality_of_role_id = b.id from public.fleet_roles b where r.slug = 'loader' and b.slug = 'gunner';
update public.fleet_roles r set speciality_of_role_id = b.id from public.fleet_roles b where r.slug = 'fighter-pilot' and b.slug = 'pilot';
update public.fleet_roles r set speciality_of_role_id = b.id from public.fleet_roles b where r.slug = 'strike-pilot' and b.slug = 'pilot';
update public.fleet_roles r set speciality_of_role_id = b.id from public.fleet_roles b where r.slug = 'scout-pilot' and b.slug = 'pilot';
update public.fleet_roles r set speciality_of_role_id = b.id from public.fleet_roles b where r.slug = 'dropship-pilot' and b.slug = 'pilot';
update public.fleet_roles r set speciality_of_role_id = b.id from public.fleet_roles b where r.slug = 'medevac-pilot' and b.slug = 'pilot';
update public.fleet_roles r set speciality_of_role_id = b.id from public.fleet_roles b where r.slug = 'transport-pilot' and b.slug = 'pilot';
update public.fleet_roles r set speciality_of_role_id = b.id from public.fleet_roles b where r.slug = 'field-medic' and b.slug = 'medic';
update public.fleet_roles r set speciality_of_role_id = b.id from public.fleet_roles b where r.slug = 'sar-medic' and b.slug = 'medic';

-- ---------------------------------------------------------------------------
-- Operation types: the event types gain the matrix's facts
-- ---------------------------------------------------------------------------

alter table public.event_types
  add column family text not null default '' check (char_length(family) <= 40),
  add column aim text not null default '' check (char_length(aim) <= 200),
  add column opens_at smallint not null default 1 check (opens_at between 1 and 4),
  add column needs text not null default '' check (char_length(needs) <= 200),
  add column minimum_force text not null default '' check (char_length(minimum_force) <= 120),
  add column typical_force text not null default '' check (char_length(typical_force) <= 120),
  add column planned_or_reactive text not null default '' check (char_length(planned_or_reactive) <= 40),
  add column contact_expected text not null default '' check (char_length(contact_expected) <= 40),
  add column notes text not null default '' check (char_length(notes) <= 200);

update public.event_types set family = 'Presence and response', aim = 'Fly a route through known piracy spots and respond to what is found', opens_at = 1, needs = 'Nothing', minimum_force = 'One flight or one ship', typical_force = 'One ship and her air group', planned_or_reactive = 'Planned', contact_expected = 'Possible', notes = 'Variants: area, trade lane, picket on a jump point or station' where key = 'patrol';
update public.event_types set family = 'Presence and response', aim = 'Sortie to a piracy report marked happening now', opens_at = 1, needs = 'Someone declared at readiness', minimum_force = 'One flight', typical_force = 'One ship or a flight', planned_or_reactive = 'Reactive', contact_expected = 'Likely', notes = 'Launched by whoever is on; the report line feeds it', name = 'Quick reaction' where key = 'response';
update public.event_types set family = 'Enabling', aim = 'Teach lessons from the syllabus using any type as the scenario', opens_at = 1, needs = 'An instructor', minimum_force = 'An instructor and two', typical_force = 'A ship''s company', planned_or_reactive = 'Planned', contact_expected = 'None (scripted)', notes = 'Run by instructors, who draft training events' where key = 'training';
update public.event_types set family = 'Offensive', aim = 'Deliberate attack on a known hostile asset: a capital ship or a base', opens_at = 3, needs = 'A second ship', minimum_force = 'Two ships with air', typical_force = 'A task force', planned_or_reactive = 'Planned', contact_expected = 'Expected', notes = 'The fleet action' where key = 'strike';

-- The twelve types the site lacked. Tasked PvE stays as the site's own.
insert into public.event_types (key, name, run_by, example, sort_order, family, aim, opens_at, needs, minimum_force, typical_force, planned_or_reactive, contact_expected, notes) values
  ('sweep', 'Sweep', 'Command', 'Clear a site or region of a known hostile presence', 11, 'Offensive', 'Clear a site or region of a known hostile presence', 1, 'An intelligence picture', 'One ship with air', 'A task force', 'Planned', 'Expected', 'Often the first night of an initiative'),
  ('escort', 'Escort', 'Command', 'Take a convoy or industrial traffic safely from A to B', 12, 'Protective', 'Take a convoy or industrial traffic safely from A to B', 1, 'An escorted party', 'One ship or one flight', 'An escort group', 'Planned', 'Possible', 'Own logistics runs, or a partner org'),
  ('search_and_rescue', 'Search and rescue', 'Command', 'Find and recover downed crew, a lost ship, stranded members or civilians', 13, 'Protective', 'Find and recover downed crew, a lost ship, stranded members or civilians', 1, 'A medic', 'One flight with a medic', 'A flight, a ship with a medical bay', 'Reactive or planned', 'Possible', 'Medical-led; Specialist Medic for SAR when one exists'),
  ('interdiction', 'Interdiction', 'Command', 'Hold a chokepoint; stop, search and enforce the rules of engagement', 14, 'Offensive', 'Hold a chokepoint; stop, search and enforce the rules of engagement', 3, 'A second ship and a boarding party', 'Two ships: picket and blocker', 'A task force with a boarding party', 'Planned', 'Likely', ''),
  ('seizure', 'Seizure', 'Command', 'Board and take a ship or station as the main act', 15, 'Offensive', 'Board and take a ship or station as the main act', 3, 'A boarding party of four', 'A boarding party and a carrier', 'A ship with a security section', 'Planned', 'Expected', 'Navy Security now; Marines when they open'),
  ('show_of_force', 'Show of force', 'Command', 'Be seen at a location, in public channels too; deter and recruit', 16, 'Presence and response', 'Be seen at a location, in public channels too; deter and recruit', 2, 'Nothing', 'One ship', 'A ship and her air group', 'Planned', 'Unlikely', ''),
  ('defence', 'Defence', 'Command', 'Respond to an attack on the fleet''s own anchorage, ship or asset', 17, 'Protective', 'Respond to an attack on the fleet''s own anchorage, ship or asset', 2, 'An asset to defend', 'Whoever is on', 'A ship and her air group', 'Reactive', 'Expected', ''),
  ('reconnaissance', 'Reconnaissance', 'Command', 'Observe a location or an org without engaging; feed the hostile list', 18, 'Enabling', 'Observe a location or an org without engaging; feed the hostile list', 2, 'Nothing', 'One flight or a scout ship', 'A flight', 'Planned', 'Avoided', ''),
  ('logistics_run', 'Logistics run', 'Command', 'Resupply, salvage, mining under guard, moving hulls', 19, 'Enabling', 'Resupply, salvage, mining under guard, moving hulls', 2, 'The bank', 'One hauler and one escort', 'Haulers and an escort flight', 'Planned', 'Unlikely', 'Bank-funded'),
  ('arranged_engagement', 'Arranged engagement', 'Command', 'A battle agreed with another org', 20, 'Offensive', 'A battle agreed with another org', 3, 'An agreement with the other org', 'A task force', 'A task force', 'Planned', 'Certain', 'Competitive PvP'),
  ('ground_assault', 'Ground assault', 'Command', 'Take or hold an outpost or bunker on the ground', 21, 'Offensive', 'Take or hold an outpost or bunker on the ground', 4, 'The Army open', 'A platoon with transport', 'A company with dropships', 'Planned', 'Expected', 'Army; or earlier if the Army opens first'),
  ('landing', 'Landing', 'Command', 'Dropships put troops onto a ship, station or surface under cover', 22, 'Offensive', 'Dropships put troops onto a ship, station or surface under cover', 4, 'The Marines or Army open', 'A dropship, a boarding party and cover', 'A task force with an air wing and troops', 'Planned', 'Expected', 'Navy with Marines or Army');

-- ---------------------------------------------------------------------------
-- Situations: what can land on any night
-- ---------------------------------------------------------------------------

create table public.situations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name text not null unique check (char_length(name) between 2 and 80 and name !~ '(^\s|\s$)'),
  -- What is seen or heard that says this is happening.
  what_you_see text not null default '' check (char_length(what_you_see) <= 200),
  calls_role_id uuid references public.fleet_roles (id) on delete set null,
  owns_role_id uuid references public.fleet_roles (id) on delete set null,
  notes text not null default '' check (char_length(notes) <= 300),
  sort_order integer not null default 0
);
create trigger situations_audit after insert or update or delete on public.situations
  for each row execute function app.audit();

insert into public.situations (slug, name, what_you_see, calls_role_id, owns_role_id, notes, sort_order) values
  ('unknown-contact', 'Unknown contact', 'A ship or group not yet identified', (select id from public.fleet_roles where slug = 'sensor-operator'), (select id from public.fleet_roles where slug = 'task-force-commander'), '', 1),
  ('hostile-contact', 'Hostile contact', 'A confirmed hostile within reach, or fire taken', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), 'The engagement itself', 2),
  ('surrender', 'Surrender', 'A challenged ship complies', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), '', 3),
  ('boarders-aboard', 'Boarders aboard', 'Hostile players inside the ship', (select id from public.fleet_roles where slug = 'security-lead'), (select id from public.fleet_roles where slug = 'security-lead'), '', 4),
  ('boarding-a-hostile-ship', 'Boarding a hostile ship', 'The decision to board', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'security-lead'), 'Marines when they open', 5),
  ('casualty', 'Casualty', 'A member down', (select id from public.fleet_roles where slug = 'medic'), (select id from public.fleet_roles where slug = 'lead-medic'), 'Primarily respawn; the medical chain where present', 6),
  ('ship-lost', 'Ship lost', 'A hull destroyed', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), '', 7),
  ('crew-adrift', 'Crew adrift', 'An ejected pilot or crew in space', (select id from public.fleet_roles where slug = 'flight-commander'), (select id from public.fleet_roles where slug = 'flight-commander'), '', 8),
  ('component-failure-or-out-of-fuel-and-ammunition', 'Component failure or out of fuel and ammunition', 'A ship that cannot fight or move', (select id from public.fleet_roles where slug = 'engineering-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), '', 9),
  ('commander-drops-out', 'Commander drops out', 'A commander disconnects or leaves', (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), 'Uses the step-up chain named in planning', 10),
  ('server-crash-or-mass-disconnect', 'Server crash or mass disconnect', 'Half the force vanishes', (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), '', 11),
  ('voice-app-down', 'Voice app down', 'The nets fail', (select id from public.fleet_roles where slug = 'signals-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), 'Fallback order: Discord voice, then in-game VOIP', 12),
  ('accidental-crimestat', 'Accidental crimestat', 'A member gains a crimestat', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), '', 13),
  ('friendly-fire', 'Friendly fire', 'Fire on own force', (select id from public.fleet_roles where slug = 'gunnery-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), 'Conduct follow-up after the operation', 14),
  ('third-party', 'Third party', 'Civilians or another org arrive', (select id from public.fleet_roles where slug = 'signaller'), (select id from public.fleet_roles where slug = 'task-force-commander'), '', 15),
  ('report-during-the-operation', 'Report during the operation', 'A piracy report marked happening now', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), (select id from public.fleet_roles where slug = 'fleet-duty-officer'), 'Push notice planned on the site', 16);

-- ---------------------------------------------------------------------------
-- Tasks: the spine, the modules and the drills
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  -- A task of every operation names neither; a module's task names its type; a drill's task names its situation.
  event_type_id uuid references public.event_types (id) on delete restrict,
  situation_id uuid references public.situations (id) on delete restrict,
  phase text not null check (phase in ('planning', 'muster', 'underway', 'recovery', 'after', 'drill')),
  echelon text not null check (echelon in ('Fleet', 'Task force', 'Air group', 'Ship', 'Section')),
  wording text not null check (char_length(wording) between 3 and 200 and wording !~ '(^\s|\s$)'),
  does_role_id uuid not null references public.fleet_roles (id) on delete restrict,
  supervises_command_role_id uuid references public.fleet_roles (id) on delete set null,
  supervises_technical_role_id uuid references public.fleet_roles (id) on delete set null,
  leads_role_id uuid not null references public.fleet_roles (id) on delete restrict,
  -- The first stage the task exists at; empty for a module's task, which takes its type's.
  needed_from smallint check (needed_from between 1 and 4),
  notes text not null default '' check (char_length(notes) <= 200),
  sort_order integer not null default 0,
  constraint tasks_one_home check (event_type_id is null or situation_id is null),
  constraint tasks_drill_is_a_situation check ((phase = 'drill') = (situation_id is not null)),
  constraint tasks_module_takes_its_stage check (event_type_id is null or needed_from is null)
);
create index tasks_type_idx on public.tasks (event_type_id) where event_type_id is not null;
create index tasks_situation_idx on public.tasks (situation_id) where situation_id is not null;
create index tasks_does_idx on public.tasks (does_role_id);
create index tasks_leads_idx on public.tasks (leads_role_id);
create trigger tasks_audit after insert or update or delete on public.tasks
  for each row execute function app.audit();

-- Who is consulted and who is informed: roles, or the whole force, or the ship's company.
create table public.task_roles (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  part text not null check (part in ('consulted', 'informed')),
  role_id uuid references public.fleet_roles (id) on delete cascade,
  token text check (token in ('whole_force', 'ships_company')),
  sort_order smallint not null default 0,
  constraint task_roles_one_of check ((role_id is null) <> (token is null))
);
create index task_roles_task_idx on public.task_roles (task_id);
create index task_roles_role_idx on public.task_roles (role_id) where role_id is not null;
create unique index task_roles_once on public.task_roles (task_id, part, coalesce(role_id::text, token));
create trigger task_roles_audit after insert or update or delete on public.task_roles
  for each row execute function app.audit();

insert into public.tasks (sort_order, event_type_id, situation_id, phase, echelon, wording, does_role_id, supervises_command_role_id, supervises_technical_role_id, leads_role_id, needed_from, notes) values
  (1, null, null, 'planning', 'Fleet', 'Set the fleet''s priorities for the period: region, threats, which types of operation', (select id from public.fleet_roles where slug = 'fleet-commander'), null, null, (select id from public.fleet_roles where slug = 'fleet-commander'), 1, 'Published in routine orders from stage 2'),
  (2, null, null, 'planning', 'Fleet', 'Keep the hostile list and the piracy reports current; pass what bears on the operation', (select id from public.fleet_roles where slug = 'analyst'), (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), null, (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), 1, 'Hostile list and report line are live on the site'),
  (3, null, null, 'planning', 'Task force', 'Choose the operation''s type and aim from the priorities and the reports', (select id from public.fleet_roles where slug = 'task-force-commander'), (select id from public.fleet_roles where slug = 'fleet-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, 'The type''s module adds its own planning rows'),
  (4, null, null, 'planning', 'Task force', 'Draft the operation on the site: orders in five paragraphs, the plan, timings', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, 'Command drafts any event'),
  (5, null, null, 'planning', 'Task force', 'Build the intelligence picture for the operation', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), 1, ''),
  (6, null, null, 'planning', 'Task force', 'Choose the force against the type''s minimum and typical force', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, 'Minimum force per type is on the Operation types tab'),
  (7, null, null, 'planning', 'Ship', 'Set the ship''s crew template, and any variant, for this operation', (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, 'A captain may request slight changes'),
  (8, null, null, 'planning', 'Task force', 'Allocate unit tasks and set their access levels', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, 'Four access levels on the site'),
  (9, null, null, 'planning', 'Task force', 'Write the rules of engagement and weapons-release authority for the operation', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, 'Release sits with each ship''s CO unless the orders say otherwise'),
  (10, null, null, 'planning', 'Task force', 'Plan the nets: command net, each ship''s crew nets, air net, deck net, medical net', (select id from public.fleet_roles where slug = 'senior-signals-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'chief-signals-officer'), (select id from public.fleet_roles where slug = 'senior-signals-officer'), 1, 'Until a Signals Officer exists the XO owns the procedure'),
  (11, null, null, 'planning', 'Air group', 'Plan the air: launch sequence, flights, escort and strike tasks', (select id from public.fleet_roles where slug = 'senior-flight-commander'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'senior-flight-commander'), 2, 'One Flight Commander per air group, one senior for the operation'),
  (12, null, null, 'planning', 'Task force', 'Plan the medical chain: where casualties go, who treats, whether a medical ship sails', (select id from public.fleet_roles where slug = 'senior-medical-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'chief-medical-officer'), (select id from public.fleet_roles where slug = 'senior-medical-officer'), 2, ''),
  (13, null, null, 'planning', 'Task force', 'Logistics for the night: fuel, ammunition, repair, spare ships, a bank request if needed', (select id from public.fleet_roles where slug = 'task-force-logistics-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'head-of-logistics-and-medical'), (select id from public.fleet_roles where slug = 'task-force-logistics-officer'), 1, ''),
  (14, null, null, 'planning', 'Task force', 'Name the step-up chain: who takes over if a commander drops out', (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, 'Used by the Commander drops out drill'),
  (15, null, null, 'planning', 'Fleet', 'Approve the operation and publish it', (select id from public.fleet_roles where slug = 'fleet-commander'), null, null, (select id from public.fleet_roles where slug = 'fleet-commander'), 1, 'Approvals on the site; Discord announcement; calendar file'),
  (16, null, null, 'planning', 'Ship', 'Confirm attendance; the roll closes 24 hours before the start', (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'task-force-executive-officer'), 1, 'Members reply attending or not'),
  (17, null, null, 'planning', 'Ship', 'Fill open posts and arrange stand-ins; command appoints the key positions', (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, 'Volunteers for most posts; leaders appointed by command'),
  (18, null, null, 'planning', 'Fleet', 'Deconflict with other operations and time zones', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, (select id from public.fleet_roles where slug = 'head-of-operations-and-planning'), 4, 'Only once more than one operation runs at a time'),
  (19, null, null, 'muster', 'Ship', 'Open the voice nets and check every member is on the right net', (select id from public.fleet_roles where slug = 'signaller'), (select id from public.fleet_roles where slug = 'lead-signaller'), (select id from public.fleet_roles where slug = 'chief-of-signals'), (select id from public.fleet_roles where slug = 'signals-officer'), 1, ''),
  (20, null, null, 'muster', 'Ship', 'Take the roll against the manning; report present, absent and stand-ins', (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'executive-officer'), 1, 'Attendance returns on the site'),
  (21, null, null, 'muster', 'Ship', 'Re-man on the night: move people into empty posts', (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (22, null, null, 'muster', 'Task force', 'Report the force''s strength; decide to sail, scale down or cancel', (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, 'Check against the type''s minimum force'),
  (23, null, null, 'muster', 'Task force', 'Give the operation brief: situation, mission, execution, service support, command and signals', (select id from public.fleet_roles where slug = 'task-force-commander'), null, null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (24, null, null, 'muster', 'Ship', 'Give the ship''s brief: her task, her crew''s posts, her nets', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (25, null, null, 'muster', 'Air group', 'Give the air brief: flights, call signs, launch and recovery, rules of engagement for pilots', (select id from public.fleet_roles where slug = 'flight-commander'), (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, (select id from public.fleet_roles where slug = 'senior-flight-commander'), 2, ''),
  (26, null, null, 'muster', 'Task force', 'Rehearse: talk the force through the key moments and the what-ifs', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, 'A talk-through, not a dry run'),
  (27, null, null, 'muster', 'Section', 'Section briefs: each lead confirms their people''s jobs and net', (select id from public.fleet_roles where slug = 'lead-gunner'), (select id from public.fleet_roles where slug = 'gunnery-officer'), null, (select id from public.fleet_roles where slug = 'lead-gunner'), 1, 'One row stands for every section'),
  (28, null, null, 'muster', 'Ship', 'Pre-sail checks: fuelled, armed, repaired, components fitted, stores aboard', (select id from public.fleet_roles where slug = 'engineer'), (select id from public.fleet_roles where slug = 'lead-engineer'), (select id from public.fleet_roles where slug = 'chief-engineer'), (select id from public.fleet_roles where slug = 'engineering-officer'), 1, ''),
  (29, null, null, 'muster', 'Ship', 'Load and secure cargo and stores; tractor-beam work', (select id from public.fleet_roles where slug = 'cargo-handler'), (select id from public.fleet_roles where slug = 'boatswain'), null, (select id from public.fleet_roles where slug = 'executive-officer'), 2, ''),
  (30, null, null, 'muster', 'Ship', 'Report ready to sail up to the task force', (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (31, null, null, 'muster', 'Air group', 'Ready the fighters: fuelled, armed, pilots in cockpits; deck net up', (select id from public.fleet_roles where slug = 'deck-crew'), (select id from public.fleet_roles where slug = 'deck-chief'), (select id from public.fleet_roles where slug = 'flight-deck-officer'), (select id from public.fleet_roles where slug = 'flight-deck-officer'), 2, ''),
  (32, null, null, 'muster', 'Ship', 'Bridge watch closes up: helm, navigator, sensors, bridge signaller', (select id from public.fleet_roles where slug = 'officer-of-the-watch'), (select id from public.fleet_roles where slug = 'executive-officer'), null, (select id from public.fleet_roles where slug = 'executive-officer'), 1, 'The Officer of the Watch runs the bridge so the CO can command; the XO until one exists'),
  (33, null, null, 'muster', 'Task force', 'Comms check across every net; confirm call signs and timings', (select id from public.fleet_roles where slug = 'lead-signaller'), (select id from public.fleet_roles where slug = 'signals-officer'), (select id from public.fleet_roles where slug = 'senior-signals-officer'), (select id from public.fleet_roles where slug = 'senior-signals-officer'), 1, ''),
  (34, null, null, 'muster', 'Task force', 'Order the force underway', (select id from public.fleet_roles where slug = 'task-force-commander'), null, null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (35, null, null, 'underway', 'Ship', 'Navigate the ship on the ordered route and timings', (select id from public.fleet_roles where slug = 'helm'), (select id from public.fleet_roles where slug = 'officer-of-the-watch'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (36, null, null, 'underway', 'Task force', 'Keep the force in formation and on timings; order changes of course', (select id from public.fleet_roles where slug = 'task-force-commander'), null, null, (select id from public.fleet_roles where slug = 'task-force-commander'), 3, 'More than one ship from stage 3'),
  (37, null, null, 'underway', 'Task force', 'Station the escorts and screen the capital ships', (select id from public.fleet_roles where slug = 'escort-commander'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'escort-commander'), 3, ''),
  (38, null, null, 'underway', 'Ship', 'Watch sensors; report contacts to the bridge and the command net', (select id from public.fleet_roles where slug = 'sensor-operator'), (select id from public.fleet_roles where slug = 'officer-of-the-watch'), null, (select id from public.fleet_roles where slug = 'executive-officer'), 1, 'A contact starts the Unknown contact drill'),
  (39, null, null, 'underway', 'Air group', 'Launch and station the combat air patrol', (select id from public.fleet_roles where slug = 'fighter-pilot'), (select id from public.fleet_roles where slug = 'flight-leader'), null, (select id from public.fleet_roles where slug = 'flight-commander'), 2, ''),
  (40, null, null, 'underway', 'Ship', 'Control the air picture from the bridge: vector the patrol onto contacts, warn of threats', (select id from public.fleet_roles where slug = 'air-controller'), (select id from public.fleet_roles where slug = 'executive-officer'), null, (select id from public.fleet_roles where slug = 'executive-officer'), 2, 'The Sensor Operator''s job until an Air Controller exists'),
  (41, null, null, 'underway', 'Air group', 'Control launch and recovery on the deck net', (select id from public.fleet_roles where slug = 'deck-chief'), (select id from public.fleet_roles where slug = 'flight-deck-officer'), null, (select id from public.fleet_roles where slug = 'flight-deck-officer'), 2, 'Pilots tune to the deck net while awaiting permission'),
  (42, null, null, 'underway', 'Task force', 'Run the command net: discipline, relays, logging the key moments', (select id from public.fleet_roles where slug = 'signaller'), (select id from public.fleet_roles where slug = 'lead-signaller'), (select id from public.fleet_roles where slug = 'senior-signals-officer'), (select id from public.fleet_roles where slug = 'senior-signals-officer'), 1, ''),
  (43, null, null, 'underway', 'Ship', 'Keep the ship''s systems running: power, shields, components, repairs under way', (select id from public.fleet_roles where slug = 'engineer'), (select id from public.fleet_roles where slug = 'lead-engineer'), (select id from public.fleet_roles where slug = 'chief-engineer'), (select id from public.fleet_roles where slug = 'engineering-officer'), 1, ''),
  (44, null, null, 'underway', 'Task force', 'Update the intelligence picture as the night goes; adjust the plan', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (45, null, null, 'underway', 'Ship', 'Report the ship''s state at each phase and on request: damage, casualties, ammunition, fuel', (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (46, null, null, 'recovery', 'Task force', 'Order recovery: regroup point, order of recovery, who covers', (select id from public.fleet_roles where slug = 'task-force-commander'), null, null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (47, null, null, 'recovery', 'Air group', 'Recover the fighters: approach, land, rearm and refuel', (select id from public.fleet_roles where slug = 'deck-crew'), (select id from public.fleet_roles where slug = 'deck-chief'), (select id from public.fleet_roles where slug = 'flight-deck-officer'), (select id from public.fleet_roles where slug = 'flight-deck-officer'), 2, ''),
  (48, null, null, 'recovery', 'Ship', 'Head count and casualty state after the action', (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'executive-officer'), 1, ''),
  (49, null, null, 'recovery', 'Ship', 'Repairs under way; ammunition and fuel state for the next task', (select id from public.fleet_roles where slug = 'engineer'), (select id from public.fleet_roles where slug = 'lead-engineer'), (select id from public.fleet_roles where slug = 'chief-engineer'), (select id from public.fleet_roles where slug = 'engineering-officer'), 1, ''),
  (50, null, null, 'recovery', 'Task force', 'Replace losses: respawned crew rejoin, spare ships brought up', (select id from public.fleet_roles where slug = 'task-force-logistics-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), null, (select id from public.fleet_roles where slug = 'task-force-executive-officer'), 1, 'Primarily respawn'),
  (51, null, null, 'recovery', 'Task force', 'Decide the next task or the return to base', (select id from public.fleet_roles where slug = 'task-force-commander'), null, null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (52, null, null, 'recovery', 'Ship', 'Return transit and berthing; secure the ship', (select id from public.fleet_roles where slug = 'helm'), (select id from public.fleet_roles where slug = 'officer-of-the-watch'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (53, null, null, 'recovery', 'Task force', 'Stand the force down; close nets in order; release members', (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (54, null, null, 'after', 'Ship', 'Hot debrief on the net: what happened, what went wrong, in ten minutes', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (55, null, null, 'after', 'Ship', 'File the attendance return', (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'executive-officer'), 1, 'On the site; feeds the activity minimum'),
  (56, null, null, 'after', 'Task force', 'Write the after-action report: outcome, losses, mentions, lessons', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, 'A lessons log across events is planned'),
  (57, null, null, 'after', 'Ship', 'Ship''s own report into the task force''s: damage, losses, crew performance, notes for the template', (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 3, 'One ship until stage 3'),
  (58, null, null, 'after', 'Fleet', 'Update the hostile list and the piracy reports from what happened', (select id from public.fleet_roles where slug = 'analyst'), (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), null, (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), 1, ''),
  (59, null, null, 'after', 'Fleet', 'Review the operation at command: approve the report; decisions for routine orders', (select id from public.fleet_roles where slug = 'fleet-commander'), null, null, (select id from public.fleet_roles where slug = 'fleet-commander'), 1, 'The command board from stage 3'),
  (60, null, null, 'after', 'Section', 'Record lessons and training notes per section: who needs what practice', (select id from public.fleet_roles where slug = 'lead-gunner'), (select id from public.fleet_roles where slug = 'gunnery-officer'), (select id from public.fleet_roles where slug = 'chief-gunner'), (select id from public.fleet_roles where slug = 'gunnery-officer'), 2, 'Training records; one row stands for every section'),
  (61, null, null, 'after', 'Ship', 'Raise commendations and mentions; raise conduct concerns through the chain', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, 'Medals and a conduct panel later'),
  (62, null, null, 'after', 'Fleet', 'Pay out from the bank or replace losses where the doctrine allows', (select id from public.fleet_roles where slug = 'head-of-logistics-and-medical'), (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, (select id from public.fleet_roles where slug = 'head-of-logistics-and-medical'), 3, '10 million a week limit'),
  (63, null, null, 'after', 'Fleet', 'Hand over to the next time zone: what is live, what is pending', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, (select id from public.fleet_roles where slug = 'head-of-operations-and-planning'), 4, ''),
  (64, null, null, 'after', 'Fleet', 'Publish a sanitised dispatch for the public front page', (select id from public.fleet_roles where slug = 'fleet-executive-officer'), (select id from public.fleet_roles where slug = 'fleet-commander'), null, (select id from public.fleet_roles where slug = 'fleet-executive-officer'), 3, 'Public dispatches planned for January'),
  (65, (select id from public.event_types where key = 'patrol'), null, 'planning', 'Task force', 'Choose the route and the known spots to visit; timings per leg; what to do at each', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (66, (select id from public.event_types where key = 'patrol'), null, 'planning', 'Task force', 'Set what counts as a contact report on this patrol and how it is logged', (select id from public.fleet_roles where slug = 'senior-signals-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (67, (select id from public.event_types where key = 'patrol'), null, 'underway', 'Ship', 'Fly the route leg by leg; check each spot before moving on', (select id from public.fleet_roles where slug = 'helm'), (select id from public.fleet_roles where slug = 'officer-of-the-watch'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), null, ''),
  (68, (select id from public.event_types where key = 'patrol'), null, 'underway', 'Ship', 'Observe and report activity at each spot, hostile or not; log it for the hostile list', (select id from public.fleet_roles where slug = 'sensor-operator'), (select id from public.fleet_roles where slug = 'executive-officer'), null, (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, ''),
  (69, (select id from public.event_types where key = 'patrol'), null, 'underway', 'Task force', 'Monitor public channels and the request line on patrol; relay calls to command', (select id from public.fleet_roles where slug = 'signaller'), (select id from public.fleet_roles where slug = 'lead-signaller'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (70, (select id from public.event_types where key = 'patrol'), null, 'underway', 'Task force', 'Decide at each report: investigate, divert or carry on', (select id from public.fleet_roles where slug = 'task-force-commander'), null, null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (71, (select id from public.event_types where key = 'patrol'), null, 'after', 'Task force', 'Patrol report: spots visited, activity seen, contacts; into the intelligence picture', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (72, (select id from public.event_types where key = 'response'), null, 'planning', 'Task force', 'Declare a quick reaction force for the period: who, which ship or flight, the launch standard', (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, 'At launch, whoever is on'),
  (73, (select id from public.event_types where key = 'response'), null, 'underway', 'Fleet', 'Receive and verify the report: where, who, how many, how old', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 'The report line, marked happening now'),
  (74, (select id from public.event_types where key = 'response'), null, 'underway', 'Fleet', 'Decide to launch, and with what', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (75, (select id from public.event_types where key = 'response'), null, 'underway', 'Ship', 'Launch within the standard: short brief on the net, go', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (76, (select id from public.event_types where key = 'response'), null, 'underway', 'Ship', 'Arrive, assess, act under the rules of engagement; report back', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (77, (select id from public.event_types where key = 'response'), null, 'after', 'Fleet', 'Close the report on the site: outcome; whether the reporter was helped', (select id from public.fleet_roles where slug = 'analyst'), (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), null, (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, ''),
  (78, (select id from public.event_types where key = 'sweep'), null, 'planning', 'Task force', 'Define the area or site and what clear means', (select id from public.fleet_roles where slug = 'task-force-commander'), (select id from public.fleet_roles where slug = 'fleet-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (79, (select id from public.event_types where key = 'sweep'), null, 'planning', 'Task force', 'Pattern of search: sectors, order, who takes which', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (80, (select id from public.event_types where key = 'sweep'), null, 'underway', 'Air group', 'Scout ahead of the force; report what is at each site before the force arrives', (select id from public.fleet_roles where slug = 'scout-pilot'), (select id from public.fleet_roles where slug = 'flight-leader'), null, (select id from public.fleet_roles where slug = 'flight-commander'), null, ''),
  (81, (select id from public.event_types where key = 'sweep'), null, 'underway', 'Ship', 'Search sector by sector; call each sector clear or contact', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (82, (select id from public.event_types where key = 'sweep'), null, 'underway', 'Task force', 'Hold a cleared sector with a picket while the rest is searched', (select id from public.fleet_roles where slug = 'flight-commander'), (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, (select id from public.fleet_roles where slug = 'escort-commander'), null, ''),
  (83, (select id from public.event_types where key = 'sweep'), null, 'underway', 'Task force', 'On contact, run the hostile contact drill; return to the pattern once clear', (select id from public.fleet_roles where slug = 'task-force-commander'), null, null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, 'See Situation: Hostile contact'),
  (84, (select id from public.event_types where key = 'sweep'), null, 'after', 'Task force', 'Declare the area clear; set follow-up patrols', (select id from public.fleet_roles where slug = 'task-force-commander'), (select id from public.fleet_roles where slug = 'fleet-commander'), null, (select id from public.fleet_roles where slug = 'fleet-commander'), null, ''),
  (85, (select id from public.event_types where key = 'escort'), null, 'planning', 'Task force', 'Agree route, timings, convoy composition and the escort''s responsibility with the escorted party', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (86, (select id from public.event_types where key = 'escort'), null, 'planning', 'Task force', 'Set the screen: escort positions round the convoy; contact and jump procedure', (select id from public.fleet_roles where slug = 'escort-commander'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'escort-commander'), null, ''),
  (87, (select id from public.event_types where key = 'escort'), null, 'underway', 'Task force', 'Marshal the convoy; comms check with the escorted ships', (select id from public.fleet_roles where slug = 'signaller'), (select id from public.fleet_roles where slug = 'lead-signaller'), null, (select id from public.fleet_roles where slug = 'escort-commander'), null, ''),
  (88, (select id from public.event_types where key = 'escort'), null, 'underway', 'Ship', 'Keep station on the convoy; match speed; jump in sequence', (select id from public.fleet_roles where slug = 'helm'), (select id from public.fleet_roles where slug = 'officer-of-the-watch'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), null, ''),
  (89, (select id from public.event_types where key = 'escort'), null, 'underway', 'Task force', 'On contact: interpose, engage or detach to deal; convoy continues or holds', (select id from public.fleet_roles where slug = 'escort-commander'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (90, (select id from public.event_types where key = 'escort'), null, 'underway', 'Task force', 'Hand over at the destination; confirm the convoy''s safe arrival', (select id from public.fleet_roles where slug = 'escort-commander'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (91, (select id from public.event_types where key = 'escort'), null, 'after', 'Task force', 'Escort report; feedback to the escorted party', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (92, (select id from public.event_types where key = 'search_and_rescue'), null, 'underway', 'Fleet', 'Take the request: who is missing, last known position, time, what ship', (select id from public.fleet_roles where slug = 'signaller'), (select id from public.fleet_roles where slug = 'lead-signaller'), null, (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 'Reactive, or planned when a member is known to be stranded'),
  (93, (select id from public.event_types where key = 'search_and_rescue'), null, 'planning', 'Task force', 'Plan the search: area, pattern, who searches, a medic aboard', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (94, (select id from public.event_types where key = 'search_and_rescue'), null, 'underway', 'Air group', 'Search the pattern; report finds', (select id from public.fleet_roles where slug = 'pilot'), (select id from public.fleet_roles where slug = 'flight-leader'), null, (select id from public.fleet_roles where slug = 'flight-commander'), null, ''),
  (95, (select id from public.event_types where key = 'search_and_rescue'), null, 'underway', 'Air group', 'Recover the survivor: approach, secure the area, pick up', (select id from public.fleet_roles where slug = 'medevac-pilot'), (select id from public.fleet_roles where slug = 'flight-leader'), null, (select id from public.fleet_roles where slug = 'flight-commander'), null, ''),
  (96, (select id from public.event_types where key = 'search_and_rescue'), null, 'underway', 'Ship', 'Treat and move to a medical bed', (select id from public.fleet_roles where slug = 'sar-medic'), (select id from public.fleet_roles where slug = 'lead-medic'), (select id from public.fleet_roles where slug = 'medical-officer'), (select id from public.fleet_roles where slug = 'lead-medic'), null, ''),
  (97, (select id from public.event_types where key = 'search_and_rescue'), null, 'underway', 'Ship', 'Recover or scuttle the lost ship', (select id from public.fleet_roles where slug = 'engineer'), (select id from public.fleet_roles where slug = 'lead-engineer'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), null, ''),
  (98, (select id from public.event_types where key = 'search_and_rescue'), null, 'after', 'Task force', 'Report the rescue; close the request', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (99, (select id from public.event_types where key = 'training'), null, 'planning', 'Fleet', 'Choose the lessons to teach and the scenario type', (select id from public.fleet_roles where slug = 'instructor'), (select id from public.fleet_roles where slug = 'commandant-training-school'), null, (select id from public.fleet_roles where slug = 'commandant-training-school'), null, 'Instructors draft training events'),
  (100, (select id from public.event_types where key = 'training'), null, 'planning', 'Fleet', 'Draft the training event on the site; set the opposing force if any', (select id from public.fleet_roles where slug = 'instructor'), (select id from public.fleet_roles where slug = 'commandant-training-school'), null, (select id from public.fleet_roles where slug = 'commandant-training-school'), null, ''),
  (101, (select id from public.event_types where key = 'training'), null, 'muster', 'Task force', 'Brief the aim, the lessons, safety and how the serial runs', (select id from public.fleet_roles where slug = 'instructor'), (select id from public.fleet_roles where slug = 'commandant-training-school'), null, (select id from public.fleet_roles where slug = 'instructor'), null, ''),
  (102, (select id from public.event_types where key = 'training'), null, 'underway', 'Task force', 'Run the serial; pause, correct, run again', (select id from public.fleet_roles where slug = 'instructor'), null, (select id from public.fleet_roles where slug = 'commandant-training-school'), (select id from public.fleet_roles where slug = 'instructor'), null, ''),
  (103, (select id from public.event_types where key = 'training'), null, 'underway', 'Task force', 'Play the opposing force as scripted', (select id from public.fleet_roles where slug = 'pilot'), (select id from public.fleet_roles where slug = 'flight-leader'), null, (select id from public.fleet_roles where slug = 'instructor'), null, 'The opposing force is set on the event'),
  (104, (select id from public.event_types where key = 'training'), null, 'after', 'Fleet', 'Sign off lessons passed on the training records; note who needs more', (select id from public.fleet_roles where slug = 'instructor'), (select id from public.fleet_roles where slug = 'commandant-training-school'), null, (select id from public.fleet_roles where slug = 'commandant-training-school'), null, 'Training records are live'),
  (105, (select id from public.event_types where key = 'training'), null, 'after', 'Fleet', 'Award a qualification once every lesson is passed', (select id from public.fleet_roles where slug = 'instructor'), (select id from public.fleet_roles where slug = 'commandant-training-school'), null, (select id from public.fleet_roles where slug = 'commandant-training-school'), null, ''),
  (106, (select id from public.event_types where key = 'strike'), null, 'planning', 'Task force', 'Build the target picture: the asset, its defences, patterns, escape routes', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (107, (select id from public.event_types where key = 'strike'), null, 'planning', 'Task force', 'Plan the attack: approach, timing, fire plan, air tasks, withdrawal, abort criteria', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (108, (select id from public.event_types where key = 'strike'), null, 'muster', 'Task force', 'Rehearse the attack in detail: timings, call signs, the abort word', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (109, (select id from public.event_types where key = 'strike'), null, 'underway', 'Task force', 'Approach unseen; hold at the start line; final check and go', (select id from public.fleet_roles where slug = 'task-force-commander'), (select id from public.fleet_roles where slug = 'fleet-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (110, (select id from public.event_types where key = 'strike'), null, 'underway', 'Task force', 'Execute: coordinated fire on the target; strikes and escort as tasked', (select id from public.fleet_roles where slug = 'gunnery-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, 'Ship-level rows are in Situation: Hostile contact'),
  (111, (select id from public.event_types where key = 'strike'), null, 'underway', 'Air group', 'Strike run: torpedoes and bombs on the target as tasked', (select id from public.fleet_roles where slug = 'strike-pilot'), (select id from public.fleet_roles where slug = 'flight-leader'), null, (select id from public.fleet_roles where slug = 'flight-commander'), null, ''),
  (112, (select id from public.event_types where key = 'strike'), null, 'underway', 'Task force', 'Assess the damage; re-attack or withdraw', (select id from public.fleet_roles where slug = 'task-force-commander'), null, null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (113, (select id from public.event_types where key = 'strike'), null, 'after', 'Task force', 'Battle damage report into the hostile list and the after-action report', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (114, (select id from public.event_types where key = 'interdiction'), null, 'planning', 'Task force', 'Choose the chokepoint and the stop-and-search procedure under the rules of engagement', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (115, (select id from public.event_types where key = 'interdiction'), null, 'underway', 'Task force', 'Establish the cordon: picket, blocking ship, boarding party ready', (select id from public.fleet_roles where slug = 'escort-commander'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (116, (select id from public.event_types where key = 'interdiction'), null, 'underway', 'Ship', 'Hail, stop and identify traffic; check against the hostile list', (select id from public.fleet_roles where slug = 'signaller'), (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'signals-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, ''),
  (117, (select id from public.event_types where key = 'interdiction'), null, 'underway', 'Ship', 'Board and search suspects; release or detain', (select id from public.fleet_roles where slug = 'security'), (select id from public.fleet_roles where slug = 'security-lead'), (select id from public.fleet_roles where slug = 'security-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, 'See Situation: Boarding a hostile ship'),
  (118, (select id from public.event_types where key = 'interdiction'), null, 'underway', 'Air group', 'Pursue runners within the set limits', (select id from public.fleet_roles where slug = 'pilot'), (select id from public.fleet_roles where slug = 'flight-leader'), null, (select id from public.fleet_roles where slug = 'flight-commander'), null, ''),
  (119, (select id from public.event_types where key = 'interdiction'), null, 'after', 'Task force', 'Interdiction log: stopped, searched, detained, released', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), null, ''),
  (120, null, (select id from public.situations where slug = 'unknown-contact'), 'drill', 'Ship', 'Detect and report the contact: bearing, range, type, number', (select id from public.fleet_roles where slug = 'sensor-operator'), (select id from public.fleet_roles where slug = 'executive-officer'), null, (select id from public.fleet_roles where slug = 'executive-officer'), 1, ''),
  (121, null, (select id from public.situations where slug = 'unknown-contact'), 'drill', 'Task force', 'Identify against the hostile list and databased individuals', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (122, null, (select id from public.situations where slug = 'unknown-contact'), 'drill', 'Ship', 'Challenge: hail, order to stop and surrender', (select id from public.fleet_roles where slug = 'signaller'), (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'signals-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), 1, 'Rules of engagement'),
  (123, null, (select id from public.situations where slug = 'unknown-contact'), 'drill', 'Task force', 'Decide: hostile, suspect or neutral, and what follows', (select id from public.fleet_roles where slug = 'task-force-commander'), null, null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (124, null, (select id from public.situations where slug = 'hostile-contact'), 'drill', 'Task force', 'Decide to engage; give the force the target and the scheme of manoeuvre', (select id from public.fleet_roles where slug = 'task-force-commander'), null, null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (125, null, (select id from public.situations where slug = 'hostile-contact'), 'drill', 'Ship', 'Release weapons for the ship', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, 'The CO unless the orders say otherwise'),
  (126, null, (select id from public.situations where slug = 'hostile-contact'), 'drill', 'Ship', 'Manoeuvre the ship: bring arcs to bear, keep station', (select id from public.fleet_roles where slug = 'helm'), (select id from public.fleet_roles where slug = 'officer-of-the-watch'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (127, null, (select id from public.situations where slug = 'hostile-contact'), 'drill', 'Ship', 'Direct the ship''s fire: targets by priority, sector allocation', (select id from public.fleet_roles where slug = 'fire-controller'), (select id from public.fleet_roles where slug = 'gunnery-officer'), null, (select id from public.fleet_roles where slug = 'gunnery-officer'), 1, 'The Fire Controller sits the fire-control station; the Lead Gunner until one exists'),
  (128, null, (select id from public.situations where slug = 'hostile-contact'), 'drill', 'Section', 'Engage in the allotted sector; report hits, misses and ammunition state', (select id from public.fleet_roles where slug = 'gunner'), (select id from public.fleet_roles where slug = 'lead-gunner'), (select id from public.fleet_roles where slug = 'chief-gunner'), (select id from public.fleet_roles where slug = 'lead-gunner'), 1, ''),
  (129, null, (select id from public.situations where slug = 'hostile-contact'), 'drill', 'Ship', 'Point defence: engage fighters and missiles threatening the ship', (select id from public.fleet_roles where slug = 'point-defence-gunner'), (select id from public.fleet_roles where slug = 'lead-gunner'), null, (select id from public.fleet_roles where slug = 'fire-controller'), 2, ''),
  (130, null, (select id from public.situations where slug = 'hostile-contact'), 'drill', 'Ship', 'Torpedo and missile engagement on the CO''s order', (select id from public.fleet_roles where slug = 'torpedo-operator'), (select id from public.fleet_roles where slug = 'lead-gunner'), (select id from public.fleet_roles where slug = 'gunnery-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (131, null, (select id from public.situations where slug = 'hostile-contact'), 'drill', 'Ship', 'Load and ready the tubes; report tubes ready', (select id from public.fleet_roles where slug = 'loader'), (select id from public.fleet_roles where slug = 'torpedo-operator'), null, (select id from public.fleet_roles where slug = 'lead-gunner'), 2, ''),
  (132, null, (select id from public.situations where slug = 'hostile-contact'), 'drill', 'Air group', 'Fight the air battle: intercept, escort, strike as tasked', (select id from public.fleet_roles where slug = 'pilot'), (select id from public.fleet_roles where slug = 'flight-leader'), null, (select id from public.fleet_roles where slug = 'flight-commander'), 2, ''),
  (133, null, (select id from public.situations where slug = 'hostile-contact'), 'drill', 'Task force', 'Coordinate the force''s air across ships; hand targets between air groups', (select id from public.fleet_roles where slug = 'senior-flight-commander'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'senior-flight-commander'), 3, ''),
  (134, null, (select id from public.situations where slug = 'hostile-contact'), 'drill', 'Task force', 'Decide to press, break off or withdraw', (select id from public.fleet_roles where slug = 'task-force-commander'), null, null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (135, null, (select id from public.situations where slug = 'hostile-contact'), 'drill', 'Task force', 'Keep the log of the engagement: times, contacts, orders, losses', (select id from public.fleet_roles where slug = 'signaller'), (select id from public.fleet_roles where slug = 'lead-signaller'), (select id from public.fleet_roles where slug = 'senior-signals-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), 1, 'Feeds the after-action report'),
  (136, null, (select id from public.situations where slug = 'surrender'), 'drill', 'Ship', 'Accept the surrender: order the ship to hold and power down weapons; keep it covered', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (137, null, (select id from public.situations where slug = 'surrender'), 'drill', 'Ship', 'Board, search and take the crew into custody, or release them', (select id from public.fleet_roles where slug = 'security'), (select id from public.fleet_roles where slug = 'security-lead'), (select id from public.fleet_roles where slug = 'security-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), 2, 'See Boarding a hostile ship'),
  (138, null, (select id from public.situations where slug = 'boarders-aboard'), 'drill', 'Ship', 'Call boarders; seal bulkheads; secure the bridge and engineering', (select id from public.fleet_roles where slug = 'security'), (select id from public.fleet_roles where slug = 'security-lead'), (select id from public.fleet_roles where slug = 'security-officer'), (select id from public.fleet_roles where slug = 'security-lead'), 1, ''),
  (139, null, (select id from public.situations where slug = 'boarders-aboard'), 'drill', 'Ship', 'Fight the boarders; clear the ship compartment by compartment', (select id from public.fleet_roles where slug = 'security'), (select id from public.fleet_roles where slug = 'security-lead'), (select id from public.fleet_roles where slug = 'master-at-arms'), (select id from public.fleet_roles where slug = 'security-lead'), 1, 'Gunners double as security at launch'),
  (140, null, (select id from public.situations where slug = 'boarders-aboard'), 'drill', 'Ship', 'Keep the ship fighting while boarded: power, shields, helm', (select id from public.fleet_roles where slug = 'engineer'), (select id from public.fleet_roles where slug = 'lead-engineer'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (141, null, (select id from public.situations where slug = 'boarding-a-hostile-ship'), 'drill', 'Ship', 'Breach, clear, seize or scuttle', (select id from public.fleet_roles where slug = 'security'), (select id from public.fleet_roles where slug = 'security-lead'), (select id from public.fleet_roles where slug = 'security-officer'), (select id from public.fleet_roles where slug = 'security-lead'), 2, 'Marines when they open'),
  (142, null, (select id from public.situations where slug = 'boarding-a-hostile-ship'), 'drill', 'Ship', 'Prisoners, loot and the seized hull', (select id from public.fleet_roles where slug = 'security'), (select id from public.fleet_roles where slug = 'security-lead'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 2, ''),
  (143, null, (select id from public.situations where slug = 'boarding-a-hostile-ship'), 'drill', 'Ship', 'Treat casualties on the boarded ship and bring them back', (select id from public.fleet_roles where slug = 'field-medic'), (select id from public.fleet_roles where slug = 'lead-medic'), null, (select id from public.fleet_roles where slug = 'lead-medic'), 2, ''),
  (144, null, (select id from public.situations where slug = 'casualty'), 'drill', 'Ship', 'Treat where they fall; move to the medical bay', (select id from public.fleet_roles where slug = 'medic'), (select id from public.fleet_roles where slug = 'lead-medic'), (select id from public.fleet_roles where slug = 'chief-medic'), (select id from public.fleet_roles where slug = 'lead-medic'), 1, ''),
  (145, null, (select id from public.situations where slug = 'casualty'), 'drill', 'Task force', 'Medical chain across the force: evacuate to the medical ship or bed', (select id from public.fleet_roles where slug = 'medevac-pilot'), (select id from public.fleet_roles where slug = 'flight-leader'), (select id from public.fleet_roles where slug = 'senior-medical-officer'), (select id from public.fleet_roles where slug = 'senior-medical-officer'), 2, ''),
  (146, null, (select id from public.situations where slug = 'casualty'), 'drill', 'Ship', 'Respawn and rejoin: where to respawn, who brings them back', (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'executive-officer'), 1, 'Primarily respawn'),
  (147, null, (select id from public.situations where slug = 'ship-lost'), 'drill', 'Ship', 'Report the loss and the crew''s state to the task force', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (148, null, (select id from public.situations where slug = 'ship-lost'), 'drill', 'Task force', 'Regroup the crew at the respawn point; bring up a spare ship or redistribute them', (select id from public.fleet_roles where slug = 'task-force-logistics-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), null, (select id from public.fleet_roles where slug = 'task-force-executive-officer'), 1, ''),
  (149, null, (select id from public.situations where slug = 'ship-lost'), 'drill', 'Task force', 'Decide whether the operation continues without the ship', (select id from public.fleet_roles where slug = 'task-force-commander'), (select id from public.fleet_roles where slug = 'fleet-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (150, null, (select id from public.situations where slug = 'crew-adrift'), 'drill', 'Air group', 'Mark the position; detail a flight to recover', (select id from public.fleet_roles where slug = 'flight-commander'), (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, (select id from public.fleet_roles where slug = 'flight-commander'), 2, ''),
  (151, null, (select id from public.situations where slug = 'crew-adrift'), 'drill', 'Air group', 'Recover under cover; treat if needed', (select id from public.fleet_roles where slug = 'medevac-pilot'), (select id from public.fleet_roles where slug = 'flight-leader'), null, (select id from public.fleet_roles where slug = 'flight-commander'), 2, ''),
  (152, null, (select id from public.situations where slug = 'component-failure-or-out-of-fuel-and-ammunition'), 'drill', 'Ship', 'Damage control: reroute power, repair components, fight fires, seal breaches', (select id from public.fleet_roles where slug = 'engineer'), (select id from public.fleet_roles where slug = 'lead-engineer'), (select id from public.fleet_roles where slug = 'chief-engineer'), (select id from public.fleet_roles where slug = 'engineering-officer'), 1, ''),
  (153, null, (select id from public.situations where slug = 'component-failure-or-out-of-fuel-and-ammunition'), 'drill', 'Ship', 'Report the limitation; decide to fight on, resupply or withdraw', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (154, null, (select id from public.situations where slug = 'component-failure-or-out-of-fuel-and-ammunition'), 'drill', 'Task force', 'Resupply from a spare ship or a station; cover the resupply', (select id from public.fleet_roles where slug = 'task-force-logistics-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 2, ''),
  (155, null, (select id from public.situations where slug = 'commander-drops-out'), 'drill', 'Task force', 'The named next in the chain announces on the net that they have command', (select id from public.fleet_roles where slug = 'task-force-executive-officer'), null, null, (select id from public.fleet_roles where slug = 'task-force-executive-officer'), 1, 'Step-up chain named in planning'),
  (156, null, (select id from public.situations where slug = 'commander-drops-out'), 'drill', 'Ship', 'Fill the gap the step-up leaves, down the chain', (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (157, null, (select id from public.situations where slug = 'commander-drops-out'), 'drill', 'Fleet', 'Record the change for the after-action report and the member''s record', (select id from public.fleet_roles where slug = 'signaller'), (select id from public.fleet_roles where slug = 'lead-signaller'), null, (select id from public.fleet_roles where slug = 'task-force-executive-officer'), 1, ''),
  (158, null, (select id from public.situations where slug = 'server-crash-or-mass-disconnect'), 'drill', 'Task force', 'Call the crash on the command net; set the rally point and the regroup time', (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (159, null, (select id from public.situations where slug = 'server-crash-or-mass-disconnect'), 'drill', 'Ship', 'Regroup at the rally point; re-man and report', (select id from public.fleet_roles where slug = 'executive-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (160, null, (select id from public.situations where slug = 'server-crash-or-mass-disconnect'), 'drill', 'Task force', 'Decide to resume, shorten or call it off', (select id from public.fleet_roles where slug = 'task-force-commander'), null, null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (161, null, (select id from public.situations where slug = 'voice-app-down'), 'drill', 'Task force', 'Call the fallback: Discord voice, then in-game VOIP, in the set order', (select id from public.fleet_roles where slug = 'signals-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), (select id from public.fleet_roles where slug = 'senior-signals-officer'), (select id from public.fleet_roles where slug = 'task-force-executive-officer'), 1, 'Own voice solution is a launch requirement'),
  (162, null, (select id from public.situations where slug = 'voice-app-down'), 'drill', 'Ship', 'Re-establish the nets on the fallback; comms check', (select id from public.fleet_roles where slug = 'signaller'), (select id from public.fleet_roles where slug = 'lead-signaller'), (select id from public.fleet_roles where slug = 'signals-officer'), (select id from public.fleet_roles where slug = 'signals-officer'), 1, ''),
  (163, null, (select id from public.situations where slug = 'accidental-crimestat'), 'drill', 'Ship', 'Stop; report the crimestat and how it was gained', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (164, null, (select id from public.situations where slug = 'accidental-crimestat'), 'drill', 'Task force', 'Decide: clear it now, carry on, or withdraw that ship', (select id from public.fleet_roles where slug = 'task-force-commander'), null, null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (165, null, (select id from public.situations where slug = 'friendly-fire'), 'drill', 'Ship', 'Call cease fire on every net; confirm the target', (select id from public.fleet_roles where slug = 'gunnery-officer'), (select id from public.fleet_roles where slug = 'commanding-officer'), null, (select id from public.fleet_roles where slug = 'commanding-officer'), 1, ''),
  (166, null, (select id from public.situations where slug = 'friendly-fire'), 'drill', 'Task force', 'Report the incident; conduct follow-up after the operation', (select id from public.fleet_roles where slug = 'commanding-officer'), (select id from public.fleet_roles where slug = 'task-force-commander'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, 'Conduct panel later'),
  (167, null, (select id from public.situations where slug = 'third-party'), 'drill', 'Task force', 'Assess the intent of civilians or another org; hail them', (select id from public.fleet_roles where slug = 'signaller'), (select id from public.fleet_roles where slug = 'executive-officer'), null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (168, null, (select id from public.situations where slug = 'third-party'), 'drill', 'Task force', 'De-conflict, or engage only under the rules of engagement', (select id from public.fleet_roles where slug = 'task-force-commander'), null, null, (select id from public.fleet_roles where slug = 'task-force-commander'), 1, ''),
  (169, null, (select id from public.situations where slug = 'report-during-the-operation'), 'drill', 'Fleet', 'Take a report marked happening now; decide whether to divert the force', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, (select id from public.fleet_roles where slug = 'fleet-duty-officer'), 1, '');

insert into public.task_roles (task_id, part, role_id, token, sort_order) values
  ((select id from public.tasks where sort_order = 1), 'consulted', (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 1), 'consulted', (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), null, 2),
  ((select id from public.tasks where sort_order = 1), 'consulted', (select id from public.fleet_roles where slug = 'head-of-operations-and-planning'), null, 3),
  ((select id from public.tasks where sort_order = 1), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 1), 'informed', (select id from public.fleet_roles where slug = 'head-of-logistics-and-medical'), null, 2),
  ((select id from public.tasks where sort_order = 2), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 2), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 3), 'consulted', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), null, 1),
  ((select id from public.tasks where sort_order = 3), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 2),
  ((select id from public.tasks where sort_order = 3), 'informed', (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 4), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 4), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 4), 'informed', (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 5), 'consulted', (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 5), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 5), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 2),
  ((select id from public.tasks where sort_order = 6), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 6), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 6), 'consulted', (select id from public.fleet_roles where slug = 'task-force-logistics-officer'), null, 3),
  ((select id from public.tasks where sort_order = 6), 'informed', (select id from public.fleet_roles where slug = 'fleet-commander'), null, 1),
  ((select id from public.tasks where sort_order = 7), 'consulted', (select id from public.fleet_roles where slug = 'gunnery-officer'), null, 1),
  ((select id from public.tasks where sort_order = 7), 'consulted', (select id from public.fleet_roles where slug = 'engineering-officer'), null, 2),
  ((select id from public.tasks where sort_order = 7), 'consulted', (select id from public.fleet_roles where slug = 'flight-commander'), null, 3),
  ((select id from public.tasks where sort_order = 7), 'informed', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), null, 1),
  ((select id from public.tasks where sort_order = 8), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 8), 'informed', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 9), 'consulted', (select id from public.fleet_roles where slug = 'fleet-commander'), null, 1),
  ((select id from public.tasks where sort_order = 9), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 2),
  ((select id from public.tasks where sort_order = 9), 'informed', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 9), 'informed', (select id from public.fleet_roles where slug = 'gunnery-officer'), null, 2),
  ((select id from public.tasks where sort_order = 10), 'consulted', (select id from public.fleet_roles where slug = 'signals-officer'), null, 1),
  ((select id from public.tasks where sort_order = 10), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 10), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 10), 'informed', (select id from public.fleet_roles where slug = 'flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 11), 'consulted', (select id from public.fleet_roles where slug = 'flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 11), 'consulted', (select id from public.fleet_roles where slug = 'flight-deck-officer'), null, 2),
  ((select id from public.tasks where sort_order = 11), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 11), 'informed', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), null, 2),
  ((select id from public.tasks where sort_order = 12), 'consulted', (select id from public.fleet_roles where slug = 'medical-officer'), null, 1),
  ((select id from public.tasks where sort_order = 12), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 12), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 2),
  ((select id from public.tasks where sort_order = 13), 'consulted', (select id from public.fleet_roles where slug = 'quartermaster'), null, 1),
  ((select id from public.tasks where sort_order = 13), 'consulted', (select id from public.fleet_roles where slug = 'engineering-officer'), null, 2),
  ((select id from public.tasks where sort_order = 13), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 14), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 14), 'informed', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 15), 'consulted', (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 15), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 15), 'informed', null, 'whole_force', 2),
  ((select id from public.tasks where sort_order = 16), 'informed', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), null, 1),
  ((select id from public.tasks where sort_order = 17), 'consulted', (select id from public.fleet_roles where slug = 'coxswain'), null, 1),
  ((select id from public.tasks where sort_order = 17), 'consulted', (select id from public.fleet_roles where slug = 'gunnery-officer'), null, 2),
  ((select id from public.tasks where sort_order = 17), 'consulted', (select id from public.fleet_roles where slug = 'engineering-officer'), null, 3),
  ((select id from public.tasks where sort_order = 17), 'consulted', (select id from public.fleet_roles where slug = 'flight-commander'), null, 4),
  ((select id from public.tasks where sort_order = 17), 'consulted', (select id from public.fleet_roles where slug = 'lead-medic'), null, 5),
  ((select id from public.tasks where sort_order = 17), 'informed', (select id from public.fleet_roles where slug = 'task-force-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 18), 'consulted', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 18), 'informed', (select id from public.fleet_roles where slug = 'fleet-commander'), null, 1),
  ((select id from public.tasks where sort_order = 19), 'informed', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 20), 'consulted', (select id from public.fleet_roles where slug = 'lead-gunner'), null, 1),
  ((select id from public.tasks where sort_order = 20), 'consulted', (select id from public.fleet_roles where slug = 'lead-engineer'), null, 2),
  ((select id from public.tasks where sort_order = 20), 'consulted', (select id from public.fleet_roles where slug = 'flight-commander'), null, 3),
  ((select id from public.tasks where sort_order = 20), 'informed', (select id from public.fleet_roles where slug = 'task-force-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 21), 'consulted', (select id from public.fleet_roles where slug = 'coxswain'), null, 1),
  ((select id from public.tasks where sort_order = 21), 'consulted', (select id from public.fleet_roles where slug = 'lead-gunner'), null, 2),
  ((select id from public.tasks where sort_order = 21), 'consulted', (select id from public.fleet_roles where slug = 'lead-engineer'), null, 3),
  ((select id from public.tasks where sort_order = 21), 'consulted', (select id from public.fleet_roles where slug = 'lead-medic'), null, 4),
  ((select id from public.tasks where sort_order = 21), 'informed', (select id from public.fleet_roles where slug = 'task-force-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 22), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 22), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 22), 'informed', (select id from public.fleet_roles where slug = 'fleet-commander'), null, 1),
  ((select id from public.tasks where sort_order = 23), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 23), 'consulted', (select id from public.fleet_roles where slug = 'senior-signals-officer'), null, 2),
  ((select id from public.tasks where sort_order = 23), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 24), 'consulted', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 24), 'informed', null, 'ships_company', 1),
  ((select id from public.tasks where sort_order = 25), 'consulted', (select id from public.fleet_roles where slug = 'flight-deck-officer'), null, 1),
  ((select id from public.tasks where sort_order = 25), 'informed', (select id from public.fleet_roles where slug = 'pilot'), null, 1),
  ((select id from public.tasks where sort_order = 25), 'informed', (select id from public.fleet_roles where slug = 'flight-leader'), null, 2),
  ((select id from public.tasks where sort_order = 26), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 26), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 26), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 27), 'informed', (select id from public.fleet_roles where slug = 'gunner'), null, 1),
  ((select id from public.tasks where sort_order = 28), 'consulted', (select id from public.fleet_roles where slug = 'quartermaster'), null, 1),
  ((select id from public.tasks where sort_order = 28), 'consulted', (select id from public.fleet_roles where slug = 'boatswain'), null, 2),
  ((select id from public.tasks where sort_order = 28), 'informed', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 29), 'consulted', (select id from public.fleet_roles where slug = 'quartermaster'), null, 1),
  ((select id from public.tasks where sort_order = 29), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 30), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 31), 'consulted', (select id from public.fleet_roles where slug = 'flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 31), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 32), 'consulted', (select id from public.fleet_roles where slug = 'helm'), null, 1),
  ((select id from public.tasks where sort_order = 32), 'consulted', (select id from public.fleet_roles where slug = 'navigator'), null, 2),
  ((select id from public.tasks where sort_order = 32), 'consulted', (select id from public.fleet_roles where slug = 'sensor-operator'), null, 3),
  ((select id from public.tasks where sort_order = 32), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 33), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 33), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 2),
  ((select id from public.tasks where sort_order = 34), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 34), 'informed', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 34), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 3),
  ((select id from public.tasks where sort_order = 35), 'consulted', (select id from public.fleet_roles where slug = 'navigator'), null, 1),
  ((select id from public.tasks where sort_order = 36), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 36), 'informed', (select id from public.fleet_roles where slug = 'escort-commander'), null, 1),
  ((select id from public.tasks where sort_order = 36), 'informed', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 37), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 37), 'informed', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 38), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 38), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 2),
  ((select id from public.tasks where sort_order = 39), 'consulted', (select id from public.fleet_roles where slug = 'deck-chief'), null, 1),
  ((select id from public.tasks where sort_order = 39), 'consulted', (select id from public.fleet_roles where slug = 'air-controller'), null, 2),
  ((select id from public.tasks where sort_order = 39), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 3),
  ((select id from public.tasks where sort_order = 39), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 40), 'consulted', (select id from public.fleet_roles where slug = 'sensor-operator'), null, 1),
  ((select id from public.tasks where sort_order = 40), 'consulted', (select id from public.fleet_roles where slug = 'flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 40), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 40), 'informed', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 41), 'consulted', (select id from public.fleet_roles where slug = 'flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 41), 'informed', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 42), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 43), 'informed', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 44), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 44), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 45), 'consulted', (select id from public.fleet_roles where slug = 'engineering-officer'), null, 1),
  ((select id from public.tasks where sort_order = 45), 'consulted', (select id from public.fleet_roles where slug = 'gunnery-officer'), null, 2),
  ((select id from public.tasks where sort_order = 45), 'consulted', (select id from public.fleet_roles where slug = 'lead-medic'), null, 3),
  ((select id from public.tasks where sort_order = 45), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 46), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 46), 'consulted', (select id from public.fleet_roles where slug = 'escort-commander'), null, 2),
  ((select id from public.tasks where sort_order = 46), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 47), 'consulted', (select id from public.fleet_roles where slug = 'flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 47), 'informed', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 48), 'consulted', (select id from public.fleet_roles where slug = 'lead-medic'), null, 1),
  ((select id from public.tasks where sort_order = 48), 'consulted', (select id from public.fleet_roles where slug = 'lead-gunner'), null, 2),
  ((select id from public.tasks where sort_order = 48), 'consulted', (select id from public.fleet_roles where slug = 'lead-engineer'), null, 3),
  ((select id from public.tasks where sort_order = 48), 'informed', (select id from public.fleet_roles where slug = 'task-force-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 49), 'consulted', (select id from public.fleet_roles where slug = 'quartermaster'), null, 1),
  ((select id from public.tasks where sort_order = 49), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 50), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 50), 'consulted', (select id from public.fleet_roles where slug = 'transport-pilot'), null, 2),
  ((select id from public.tasks where sort_order = 50), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 51), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 51), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 2),
  ((select id from public.tasks where sort_order = 51), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 51), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 2),
  ((select id from public.tasks where sort_order = 52), 'consulted', (select id from public.fleet_roles where slug = 'navigator'), null, 1),
  ((select id from public.tasks where sort_order = 52), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 53), 'consulted', (select id from public.fleet_roles where slug = 'senior-signals-officer'), null, 1),
  ((select id from public.tasks where sort_order = 53), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 54), 'consulted', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 54), 'consulted', (select id from public.fleet_roles where slug = 'flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 54), 'informed', null, 'ships_company', 1),
  ((select id from public.tasks where sort_order = 55), 'informed', (select id from public.fleet_roles where slug = 'task-force-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 55), 'informed', (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, 2),
  ((select id from public.tasks where sort_order = 56), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 56), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 56), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 3),
  ((select id from public.tasks where sort_order = 56), 'informed', (select id from public.fleet_roles where slug = 'fleet-commander'), null, 1),
  ((select id from public.tasks where sort_order = 56), 'informed', (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, 2),
  ((select id from public.tasks where sort_order = 57), 'consulted', (select id from public.fleet_roles where slug = 'gunnery-officer'), null, 1),
  ((select id from public.tasks where sort_order = 57), 'consulted', (select id from public.fleet_roles where slug = 'engineering-officer'), null, 2),
  ((select id from public.tasks where sort_order = 57), 'consulted', (select id from public.fleet_roles where slug = 'lead-medic'), null, 3),
  ((select id from public.tasks where sort_order = 57), 'informed', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), null, 1),
  ((select id from public.tasks where sort_order = 58), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 58), 'informed', (select id from public.fleet_roles where slug = 'fleet-commander'), null, 1),
  ((select id from public.tasks where sort_order = 59), 'consulted', (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 59), 'consulted', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 2),
  ((select id from public.tasks where sort_order = 59), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 60), 'informed', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 60), 'informed', (select id from public.fleet_roles where slug = 'coxswain'), null, 2),
  ((select id from public.tasks where sort_order = 61), 'consulted', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 61), 'consulted', (select id from public.fleet_roles where slug = 'coxswain'), null, 2),
  ((select id from public.tasks where sort_order = 61), 'consulted', (select id from public.fleet_roles where slug = 'master-at-arms'), null, 3),
  ((select id from public.tasks where sort_order = 61), 'consulted', (select id from public.fleet_roles where slug = 'lead-gunner'), null, 4),
  ((select id from public.tasks where sort_order = 61), 'consulted', (select id from public.fleet_roles where slug = 'lead-engineer'), null, 5),
  ((select id from public.tasks where sort_order = 61), 'consulted', (select id from public.fleet_roles where slug = 'lead-medic'), null, 6),
  ((select id from public.tasks where sort_order = 61), 'informed', (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 62), 'consulted', (select id from public.fleet_roles where slug = 'task-force-logistics-officer'), null, 1),
  ((select id from public.tasks where sort_order = 62), 'informed', (select id from public.fleet_roles where slug = 'fleet-commander'), null, 1),
  ((select id from public.tasks where sort_order = 63), 'consulted', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 63), 'informed', (select id from public.fleet_roles where slug = 'fleet-commander'), null, 1),
  ((select id from public.tasks where sort_order = 64), 'consulted', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 65), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 65), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 66), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 66), 'informed', (select id from public.fleet_roles where slug = 'signaller'), null, 1),
  ((select id from public.tasks where sort_order = 67), 'consulted', (select id from public.fleet_roles where slug = 'navigator'), null, 1),
  ((select id from public.tasks where sort_order = 67), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 68), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 68), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 2),
  ((select id from public.tasks where sort_order = 69), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 69), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 1),
  ((select id from public.tasks where sort_order = 70), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 70), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 2),
  ((select id from public.tasks where sort_order = 70), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 1),
  ((select id from public.tasks where sort_order = 71), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 71), 'consulted', (select id from public.fleet_roles where slug = 'analyst'), null, 2),
  ((select id from public.tasks where sort_order = 71), 'informed', (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 72), 'consulted', (select id from public.fleet_roles where slug = 'flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 72), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 2),
  ((select id from public.tasks where sort_order = 72), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 1),
  ((select id from public.tasks where sort_order = 72), 'informed', null, 'whole_force', 2),
  ((select id from public.tasks where sort_order = 73), 'consulted', (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 73), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 74), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 74), 'consulted', (select id from public.fleet_roles where slug = 'flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 74), 'informed', (select id from public.fleet_roles where slug = 'fleet-commander'), null, 1),
  ((select id from public.tasks where sort_order = 75), 'consulted', (select id from public.fleet_roles where slug = 'flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 75), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 1),
  ((select id from public.tasks where sort_order = 76), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 76), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 1),
  ((select id from public.tasks where sort_order = 77), 'consulted', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 77), 'informed', (select id from public.fleet_roles where slug = 'fleet-commander'), null, 1),
  ((select id from public.tasks where sort_order = 78), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 78), 'consulted', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), null, 2),
  ((select id from public.tasks where sort_order = 78), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 79), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 79), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 79), 'informed', (select id from public.fleet_roles where slug = 'escort-commander'), null, 1),
  ((select id from public.tasks where sort_order = 80), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 80), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 81), 'consulted', (select id from public.fleet_roles where slug = 'sensor-operator'), null, 1),
  ((select id from public.tasks where sort_order = 81), 'consulted', (select id from public.fleet_roles where slug = 'flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 81), 'informed', (select id from public.fleet_roles where slug = 'escort-commander'), null, 1),
  ((select id from public.tasks where sort_order = 82), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 82), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 83), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 83), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 83), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 84), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 84), 'informed', (select id from public.fleet_roles where slug = 'head-of-operations-and-planning'), null, 1),
  ((select id from public.tasks where sort_order = 84), 'informed', null, 'whole_force', 2),
  ((select id from public.tasks where sort_order = 85), 'consulted', (select id from public.fleet_roles where slug = 'task-force-logistics-officer'), null, 1),
  ((select id from public.tasks where sort_order = 85), 'consulted', (select id from public.fleet_roles where slug = 'escort-commander'), null, 2),
  ((select id from public.tasks where sort_order = 85), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 86), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 86), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 2),
  ((select id from public.tasks where sort_order = 86), 'informed', (select id from public.fleet_roles where slug = 'flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 87), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 88), 'consulted', (select id from public.fleet_roles where slug = 'navigator'), null, 1),
  ((select id from public.tasks where sort_order = 88), 'informed', (select id from public.fleet_roles where slug = 'escort-commander'), null, 1),
  ((select id from public.tasks where sort_order = 89), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 89), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 89), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 90), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 1),
  ((select id from public.tasks where sort_order = 90), 'informed', (select id from public.fleet_roles where slug = 'task-force-logistics-officer'), null, 2),
  ((select id from public.tasks where sort_order = 91), 'consulted', (select id from public.fleet_roles where slug = 'escort-commander'), null, 1),
  ((select id from public.tasks where sort_order = 91), 'informed', (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 92), 'consulted', (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 92), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 93), 'consulted', (select id from public.fleet_roles where slug = 'senior-medical-officer'), null, 1),
  ((select id from public.tasks where sort_order = 93), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 93), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 94), 'consulted', (select id from public.fleet_roles where slug = 'sensor-operator'), null, 1),
  ((select id from public.tasks where sort_order = 94), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 95), 'consulted', (select id from public.fleet_roles where slug = 'sar-medic'), null, 1),
  ((select id from public.tasks where sort_order = 95), 'consulted', (select id from public.fleet_roles where slug = 'security-lead'), null, 2),
  ((select id from public.tasks where sort_order = 95), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 96), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 97), 'consulted', (select id from public.fleet_roles where slug = 'quartermaster'), null, 1),
  ((select id from public.tasks where sort_order = 97), 'consulted', (select id from public.fleet_roles where slug = 'boatswain'), null, 2),
  ((select id from public.tasks where sort_order = 97), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 98), 'consulted', (select id from public.fleet_roles where slug = 'lead-medic'), null, 1),
  ((select id from public.tasks where sort_order = 98), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 1),
  ((select id from public.tasks where sort_order = 99), 'consulted', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), null, 1),
  ((select id from public.tasks where sort_order = 99), 'informed', (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 100), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 101), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 102), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 104), 'informed', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 105), 'informed', (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 105), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 2),
  ((select id from public.tasks where sort_order = 106), 'consulted', (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 106), 'informed', (select id from public.fleet_roles where slug = 'task-force-operations-officer'), null, 1),
  ((select id from public.tasks where sort_order = 107), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 107), 'consulted', (select id from public.fleet_roles where slug = 'escort-commander'), null, 2),
  ((select id from public.tasks where sort_order = 107), 'consulted', (select id from public.fleet_roles where slug = 'gunnery-officer'), null, 3),
  ((select id from public.tasks where sort_order = 107), 'informed', (select id from public.fleet_roles where slug = 'fleet-commander'), null, 1),
  ((select id from public.tasks where sort_order = 108), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 108), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 108), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 109), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 109), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 109), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 1),
  ((select id from public.tasks where sort_order = 110), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 110), 'consulted', (select id from public.fleet_roles where slug = 'escort-commander'), null, 2),
  ((select id from public.tasks where sort_order = 110), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 111), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 111), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 112), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 112), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 112), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 1),
  ((select id from public.tasks where sort_order = 113), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 113), 'informed', (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 114), 'consulted', (select id from public.fleet_roles where slug = 'fleet-commander'), null, 1),
  ((select id from public.tasks where sort_order = 114), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 2),
  ((select id from public.tasks where sort_order = 114), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 115), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 115), 'consulted', (select id from public.fleet_roles where slug = 'security-lead'), null, 2),
  ((select id from public.tasks where sort_order = 115), 'informed', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 116), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 116), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 117), 'consulted', (select id from public.fleet_roles where slug = 'field-medic'), null, 1),
  ((select id from public.tasks where sort_order = 117), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 118), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 118), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 119), 'consulted', (select id from public.fleet_roles where slug = 'signaller'), null, 1),
  ((select id from public.tasks where sort_order = 119), 'informed', (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 120), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 120), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 2),
  ((select id from public.tasks where sort_order = 121), 'consulted', (select id from public.fleet_roles where slug = 'signaller'), null, 1),
  ((select id from public.tasks where sort_order = 121), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 122), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 122), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 123), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 123), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 2),
  ((select id from public.tasks where sort_order = 123), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 123), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 2),
  ((select id from public.tasks where sort_order = 124), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 124), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 124), 'consulted', (select id from public.fleet_roles where slug = 'escort-commander'), null, 3),
  ((select id from public.tasks where sort_order = 124), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 124), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 2),
  ((select id from public.tasks where sort_order = 125), 'consulted', (select id from public.fleet_roles where slug = 'gunnery-officer'), null, 1),
  ((select id from public.tasks where sort_order = 125), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 126), 'consulted', (select id from public.fleet_roles where slug = 'gunnery-officer'), null, 1),
  ((select id from public.tasks where sort_order = 126), 'consulted', (select id from public.fleet_roles where slug = 'navigator'), null, 2),
  ((select id from public.tasks where sort_order = 126), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 127), 'consulted', (select id from public.fleet_roles where slug = 'sensor-operator'), null, 1),
  ((select id from public.tasks where sort_order = 127), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 128), 'informed', (select id from public.fleet_roles where slug = 'gunnery-officer'), null, 1),
  ((select id from public.tasks where sort_order = 129), 'informed', (select id from public.fleet_roles where slug = 'gunnery-officer'), null, 1),
  ((select id from public.tasks where sort_order = 130), 'consulted', (select id from public.fleet_roles where slug = 'fire-controller'), null, 1),
  ((select id from public.tasks where sort_order = 130), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 131), 'informed', (select id from public.fleet_roles where slug = 'fire-controller'), null, 1),
  ((select id from public.tasks where sort_order = 132), 'consulted', (select id from public.fleet_roles where slug = 'air-controller'), null, 1),
  ((select id from public.tasks where sort_order = 132), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 132), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 132), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 2),
  ((select id from public.tasks where sort_order = 133), 'consulted', (select id from public.fleet_roles where slug = 'flight-commander'), null, 1),
  ((select id from public.tasks where sort_order = 133), 'informed', (select id from public.fleet_roles where slug = 'escort-commander'), null, 1),
  ((select id from public.tasks where sort_order = 134), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 134), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 134), 'consulted', (select id from public.fleet_roles where slug = 'escort-commander'), null, 3),
  ((select id from public.tasks where sort_order = 134), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 134), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 2),
  ((select id from public.tasks where sort_order = 135), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 136), 'consulted', (select id from public.fleet_roles where slug = 'gunnery-officer'), null, 1),
  ((select id from public.tasks where sort_order = 136), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 137), 'consulted', (select id from public.fleet_roles where slug = 'field-medic'), null, 1),
  ((select id from public.tasks where sort_order = 137), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 2),
  ((select id from public.tasks where sort_order = 137), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 138), 'consulted', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 138), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 139), 'consulted', (select id from public.fleet_roles where slug = 'lead-gunner'), null, 1),
  ((select id from public.tasks where sort_order = 139), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 140), 'consulted', (select id from public.fleet_roles where slug = 'helm'), null, 1),
  ((select id from public.tasks where sort_order = 140), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 141), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 141), 'consulted', (select id from public.fleet_roles where slug = 'medic'), null, 2),
  ((select id from public.tasks where sort_order = 141), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 142), 'consulted', (select id from public.fleet_roles where slug = 'quartermaster'), null, 1),
  ((select id from public.tasks where sort_order = 142), 'consulted', (select id from public.fleet_roles where slug = 'boatswain'), null, 2),
  ((select id from public.tasks where sort_order = 142), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 3),
  ((select id from public.tasks where sort_order = 142), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 143), 'consulted', (select id from public.fleet_roles where slug = 'security-lead'), null, 1),
  ((select id from public.tasks where sort_order = 143), 'informed', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 144), 'informed', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 145), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 145), 'consulted', (select id from public.fleet_roles where slug = 'lead-medic'), null, 2),
  ((select id from public.tasks where sort_order = 145), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 146), 'consulted', (select id from public.fleet_roles where slug = 'task-force-logistics-officer'), null, 1),
  ((select id from public.tasks where sort_order = 146), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 147), 'consulted', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 147), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 147), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 2),
  ((select id from public.tasks where sort_order = 148), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 148), 'consulted', (select id from public.fleet_roles where slug = 'quartermaster'), null, 2),
  ((select id from public.tasks where sort_order = 148), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 149), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 149), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 149), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 150), 'consulted', (select id from public.fleet_roles where slug = 'lead-medic'), null, 1),
  ((select id from public.tasks where sort_order = 150), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 151), 'consulted', (select id from public.fleet_roles where slug = 'sar-medic'), null, 1),
  ((select id from public.tasks where sort_order = 151), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 152), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 153), 'consulted', (select id from public.fleet_roles where slug = 'engineering-officer'), null, 1),
  ((select id from public.tasks where sort_order = 153), 'consulted', (select id from public.fleet_roles where slug = 'task-force-logistics-officer'), null, 2),
  ((select id from public.tasks where sort_order = 153), 'informed', (select id from public.fleet_roles where slug = 'escort-commander'), null, 1),
  ((select id from public.tasks where sort_order = 154), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 154), 'consulted', (select id from public.fleet_roles where slug = 'escort-commander'), null, 2),
  ((select id from public.tasks where sort_order = 154), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 1),
  ((select id from public.tasks where sort_order = 155), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 155), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 2),
  ((select id from public.tasks where sort_order = 156), 'consulted', (select id from public.fleet_roles where slug = 'coxswain'), null, 1),
  ((select id from public.tasks where sort_order = 156), 'consulted', (select id from public.fleet_roles where slug = 'lead-gunner'), null, 2),
  ((select id from public.tasks where sort_order = 156), 'consulted', (select id from public.fleet_roles where slug = 'lead-engineer'), null, 3),
  ((select id from public.tasks where sort_order = 156), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 157), 'informed', (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 158), 'consulted', (select id from public.fleet_roles where slug = 'signals-officer'), null, 1),
  ((select id from public.tasks where sort_order = 158), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 159), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 160), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 160), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 160), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 160), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 2),
  ((select id from public.tasks where sort_order = 161), 'consulted', (select id from public.fleet_roles where slug = 'senior-signals-officer'), null, 1),
  ((select id from public.tasks where sort_order = 161), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 162), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 163), 'consulted', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 163), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 164), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 164), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 2),
  ((select id from public.tasks where sort_order = 164), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 1),
  ((select id from public.tasks where sort_order = 165), 'consulted', (select id from public.fleet_roles where slug = 'sensor-operator'), null, 1),
  ((select id from public.tasks where sort_order = 165), 'informed', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 166), 'consulted', (select id from public.fleet_roles where slug = 'executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 166), 'consulted', (select id from public.fleet_roles where slug = 'master-at-arms'), null, 2),
  ((select id from public.tasks where sort_order = 166), 'informed', (select id from public.fleet_roles where slug = 'fleet-executive-officer'), null, 1),
  ((select id from public.tasks where sort_order = 167), 'consulted', (select id from public.fleet_roles where slug = 'task-force-intelligence-officer'), null, 1),
  ((select id from public.tasks where sort_order = 167), 'informed', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 168), 'consulted', (select id from public.fleet_roles where slug = 'commanding-officer'), null, 1),
  ((select id from public.tasks where sort_order = 168), 'consulted', (select id from public.fleet_roles where slug = 'senior-flight-commander'), null, 2),
  ((select id from public.tasks where sort_order = 168), 'informed', null, 'whole_force', 1),
  ((select id from public.tasks where sort_order = 168), 'informed', (select id from public.fleet_roles where slug = 'fleet-duty-officer'), null, 2),
  ((select id from public.tasks where sort_order = 169), 'consulted', (select id from public.fleet_roles where slug = 'task-force-commander'), null, 1),
  ((select id from public.tasks where sort_order = 169), 'consulted', (select id from public.fleet_roles where slug = 'fleet-intelligence-officer'), null, 2),
  ((select id from public.tasks where sort_order = 169), 'informed', (select id from public.fleet_roles where slug = 'fleet-commander'), null, 1);

-- Every task found its roles: a slug that matched nothing would have left a null behind.
do $$
begin
  if exists (select 1 from public.tasks where does_role_id is null or leads_role_id is null) then
    raise exception 'A task names a role that does not exist.';
  end if;
  if (select count(*) from public.tasks) <> 169 or (select count(*) from public.task_roles) <> 428 then
    raise exception 'The tasks did not all arrive.';
  end if;
  if exists (select 1 from public.fleet_roles r where r.fallback_role_id is null and r.exists_from > 1) then
    raise exception 'A role that opens later has no fallback.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant all on public.situations, public.tasks, public.task_roles to service_role;

grant select on public.situations, public.tasks, public.task_roles to authenticated;
grant insert (slug, name, what_you_see, calls_role_id, owns_role_id, notes, sort_order) on public.situations to authenticated;
grant update (slug, name, what_you_see, calls_role_id, owns_role_id, notes, sort_order) on public.situations to authenticated;
grant delete on public.situations to authenticated;
grant insert (event_type_id, situation_id, phase, echelon, wording, does_role_id, supervises_command_role_id, supervises_technical_role_id, leads_role_id, needed_from, notes, sort_order) on public.tasks to authenticated;
grant update (event_type_id, situation_id, phase, echelon, wording, does_role_id, supervises_command_role_id, supervises_technical_role_id, leads_role_id, needed_from, notes, sort_order) on public.tasks to authenticated;
grant delete on public.tasks to authenticated;
grant insert (task_id, part, role_id, token, sort_order) on public.task_roles to authenticated;
grant update (part, role_id, token, sort_order) on public.task_roles to authenticated;
grant delete on public.task_roles to authenticated;

-- The roles' and the areas' new columns are read by everyone, as the roles pages are, and written by admins as the rest of the row is.
grant select (exists_from, fallback_role_id, echelon, post_type, speciality_of_role_id, former_slugs) on public.fleet_roles to anon, authenticated;
grant insert (exists_from, fallback_role_id, echelon, post_type, speciality_of_role_id) on public.fleet_roles to authenticated;
grant update (exists_from, fallback_role_id, echelon, post_type, speciality_of_role_id) on public.fleet_roles to authenticated;
grant select (former_slugs) on public.areas to anon, authenticated;
grant select (family, aim, opens_at, needs, minimum_force, typical_force, planned_or_reactive, contact_expected, notes) on public.event_types to authenticated;
grant insert (family, aim, opens_at, needs, minimum_force, typical_force, planned_or_reactive, contact_expected, notes) on public.event_types to authenticated;
grant update (family, aim, opens_at, needs, minimum_force, typical_force, planned_or_reactive, contact_expected, notes) on public.event_types to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.situations enable row level security;
alter table public.tasks enable row level security;
alter table public.task_roles enable row level security;

create policy "The fleet reads the situations" on public.situations
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Admins add situations" on public.situations
  for insert to authenticated with check ((select app.has_role('admin')));
create policy "Admins change situations" on public.situations
  for update to authenticated using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
create policy "Admins remove situations" on public.situations
  for delete to authenticated using ((select app.has_role('admin')));

create policy "The fleet reads the tasks" on public.tasks
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Admins add tasks" on public.tasks
  for insert to authenticated with check ((select app.has_role('admin')));
create policy "Admins change tasks" on public.tasks
  for update to authenticated using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
create policy "Admins remove tasks" on public.tasks
  for delete to authenticated using ((select app.has_role('admin')));

create policy "The fleet reads who each task consults and informs" on public.task_roles
  for select to authenticated using ((select app.is_serving()) or (select app.is_staff()));
create policy "Admins add to a task's consulted and informed" on public.task_roles
  for insert to authenticated with check ((select app.has_role('admin')));
create policy "Admins change a task's consulted and informed" on public.task_roles
  for update to authenticated using ((select app.has_role('admin'))) with check ((select app.has_role('admin')));
create policy "Admins remove from a task's consulted and informed" on public.task_roles
  for delete to authenticated using ((select app.has_role('admin')));
