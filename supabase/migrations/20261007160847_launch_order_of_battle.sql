-- UEE 9th Fleet: the launch order of battle.
--
-- The units and positions that Task Force Jericho opens in stages 1 to 3, from
-- Volume 1. Every position exists now and can be filled only once the fleet
-- reaches the stage it opens at. Later stages are added when they come near.
--
-- Grade bands follow Volume 1: an entry position runs from E2 to E4, and any
-- other runs from one grade below its nominal grade to one above. Enlisted
-- bands stop at E7 and officer bands start at O1.

-- ---------------------------------------------------------------------------
-- Units
-- ---------------------------------------------------------------------------

insert into public.units (parent_id, name, kind, service, opens_at_stage, sort_order)
values (null, 'UEE 9th Fleet', 'fleet', null, 1, 0);

insert into public.units (parent_id, name, kind, service, opens_at_stage, sort_order)
select parent.id, v.name, v.kind, v.service::public.service, v.stage, v.sort
from (values
  ('UEE 9th Fleet', 'Fleet Command',      'command',    null,   1, 1),
  ('UEE 9th Fleet', 'Fleet Staff',        'staff',      null,   1, 2),
  ('UEE 9th Fleet', 'Task Force Jericho', 'task force', 'navy', 1, 3)
) as v (parent, name, kind, service, stage, sort)
join public.units parent on parent.name = v.parent;

insert into public.units (parent_id, name, kind, service, opens_at_stage, sort_order)
select parent.id, v.name, v.kind, 'navy', v.stage, v.sort
from (values
  ('Task Force Jericho', 'Training Ship', 'ship',   1, 1),
  ('Task Force Jericho', 'UEES Nexus',    'ship',   2, 2),
  ('Task Force Jericho', 'A Flight',      'flight', 3, 3),
  ('Task Force Jericho', 'Escort One',    'ship',   3, 4)
) as v (parent, name, kind, stage, sort)
join public.units parent on parent.name = v.parent;

insert into public.units (parent_id, name, kind, service, opens_at_stage, sort_order)
select parent.id, v.name, 'department', 'navy', v.stage, v.sort
from (values
  ('UEES Nexus', 'Bridge',      2, 1),
  ('UEES Nexus', 'Gunnery',     2, 2),
  ('UEES Nexus', 'Engineering', 2, 3),
  ('UEES Nexus', 'Medical',     2, 4),
  ('UEES Nexus', 'Flight Deck', 3, 5),
  ('UEES Nexus', 'Security',    3, 6)
) as v (parent, name, stage, sort)
join public.units parent on parent.name = v.parent;

-- ---------------------------------------------------------------------------
-- Primary positions
-- ---------------------------------------------------------------------------

-- The Fleet Commander wears the rank of the largest formation open, so this
-- one band runs from Lieutenant Commander to Admiral.
insert into public.positions
  (unit_id, title, kind, nominal_grade, min_grade, max_grade, is_entry, opens_at_stage, sort_order)
select u.id, v.title, 'primary', v.nominal, v.low, v.high, v.entry, v.stage, v.sort
from (values
  ('Fleet Command', 'Fleet Commander', 'O10', 'O4', 'O10', false, 1, 1),

  -- Stage 1 sails a smaller ship. The Fleet Commander commands it, and its
  -- six positions are all entry positions.
  ('Training Ship', 'Helmsman', 'E2', 'E2', 'E4', true, 1, 1),
  ('Training Ship', 'Engineer', 'E2', 'E2', 'E4', true, 1, 2),
  ('Training Ship', 'Gunner 1', 'E2', 'E2', 'E4', true, 1, 3),
  ('Training Ship', 'Gunner 2', 'E2', 'E2', 'E4', true, 1, 4),
  ('Training Ship', 'Gunner 3', 'E2', 'E2', 'E4', true, 1, 5),
  ('Training Ship', 'Gunner 4', 'E2', 'E2', 'E4', true, 1, 6),

  -- UEES Nexus: the 25 positions of the flagship crew template. The Fleet
  -- Commander commands her until stage 5, when the position is handed on.
  ('Bridge', 'Commanding Officer', 'O4', 'O3', 'O5', false, 5, 1),
  ('Bridge', 'Executive Officer',  'O3', 'O2', 'O4', false, 2, 2),
  ('Bridge', 'Tactical Officer',   'O2', 'O1', 'O3', false, 2, 3),
  ('Bridge', 'Chief of the Boat',  'E6', 'E5', 'E7', false, 3, 4),
  ('Bridge', 'Helmsman',           'E5', 'E4', 'E6', false, 2, 5),
  ('Bridge', 'Navigator',          'E4', 'E3', 'E5', false, 3, 6),
  ('Bridge', 'Signaller',          'E4', 'E3', 'E5', false, 2, 7),

  ('Gunnery', 'Gunnery Chief',             'E5', 'E4', 'E6', false, 2, 1),
  ('Gunnery', 'Turret Gunner 1',           'E2', 'E2', 'E4', true,  2, 2),
  ('Gunnery', 'Turret Gunner 2',           'E2', 'E2', 'E4', true,  2, 3),
  ('Gunnery', 'Turret Gunner 3',           'E2', 'E2', 'E4', true,  2, 4),
  ('Gunnery', 'Turret Gunner 4',           'E2', 'E2', 'E4', true,  2, 5),
  ('Gunnery', 'Turret Gunner 5',           'E2', 'E2', 'E4', true,  2, 6),
  ('Gunnery', 'Turret Gunner 6',           'E2', 'E2', 'E4', true,  2, 7),
  ('Gunnery', 'Turret Gunner 7',           'E2', 'E2', 'E4', true,  2, 8),
  ('Gunnery', 'Remote Weapons Operator 1', 'E2', 'E2', 'E4', true,  3, 9),
  ('Gunnery', 'Remote Weapons Operator 2', 'E2', 'E2', 'E4', true,  3, 10),

  ('Engineering', 'Chief Engineer',  'E6', 'E5', 'E7', false, 2, 1),
  ('Engineering', 'Senior Engineer', 'E4', 'E3', 'E5', false, 3, 2),
  ('Engineering', 'Engineer 1',      'E2', 'E2', 'E4', true,  2, 3),
  ('Engineering', 'Engineer 2',      'E2', 'E2', 'E4', true,  3, 4),

  ('Medical', 'Medic', 'E4', 'E3', 'E5', false, 2, 1),

  ('Flight Deck', 'Flight Deck Chief', 'E5', 'E4', 'E6', false, 3, 1),
  ('Flight Deck', 'Deck Hand',         'E2', 'E2', 'E4', true,  3, 2),

  ('Security', 'Master-at-Arms', 'E5', 'E4', 'E6', false, 3, 1),

  -- The first section of A Flight. The flight lead flies as one of the four.
  -- Line pilots are ratings, and their band runs from E3 to E6.
  ('A Flight', 'Flight Lead', 'O2', 'O1', 'O3', false, 3, 1),
  ('A Flight', 'Pilot 2',     'E4', 'E3', 'E6', false, 3, 2),
  ('A Flight', 'Pilot 3',     'E4', 'E3', 'E6', false, 3, 3),
  ('A Flight', 'Pilot 4',     'E4', 'E3', 'E6', false, 3, 4),

  -- One gunship escort with a crew of five.
  ('Escort One', 'Commanding Officer', 'O2', 'O1', 'O3', false, 3, 1),
  ('Escort One', 'Engineer',           'E4', 'E3', 'E5', false, 3, 2),
  ('Escort One', 'Gunner 1',           'E2', 'E2', 'E4', true,  3, 3),
  ('Escort One', 'Gunner 2',           'E2', 'E2', 'E4', true,  3, 4),
  ('Escort One', 'Gunner 3',           'E2', 'E2', 'E4', true,  3, 5)
) as v (unit, title, nominal, low, high, entry, stage, sort)
join public.units u on u.name = v.unit;

-- ---------------------------------------------------------------------------
-- Secondary duties
-- ---------------------------------------------------------------------------

-- A duty is held by a pool of people alongside their primary position. The
-- grade is the lowest a member needs to take it on, from Volume 1. The section
-- heads are duties from stage 3 and become primary positions at stage 8.
insert into public.positions (unit_id, title, kind, min_grade, opens_at_stage, sort_order)
select u.id, v.title, 'duty', v.low, v.stage, v.sort
from (values
  ('Recruiter',                        'E4', 1, 1),
  ('Instructor',                       null, 1, 2),
  ('Head of Personnel and Recruiting', null, 3, 3),
  ('Commandant, Training School',      null, 3, 4),
  ('Head of Operations and Planning',  null, 3, 5),
  ('Head of Logistics and Medical',    null, 3, 6),
  ('Staff Clerk',                      'E3', 3, 7),
  ('Conduct Panel Member',             'E6', 3, 8),
  ('Planner',                          'E5', 4, 9),
  ('Head of Systems',                  null, 6, 10),
  ('Developer',                        null, 6, 11)
) as v (title, low, stage, sort)
join public.units u on u.name = 'Fleet Staff';

-- ---------------------------------------------------------------------------
-- What each position requires
-- ---------------------------------------------------------------------------

-- Every entry position needs the recruit route finished.
insert into public.position_qualifications (position_id, qualification_id)
select p.id, q.id
from public.positions p
cross join public.qualifications q
where p.is_entry and q.code in ('radio-user', 'navy-crew');

-- An officer position needs a commission. An acting holder is let off, which
-- is how these positions are filled until the first cadet course graduates.
-- The Fleet Commander is the exception: the founder holds that from day one.
insert into public.position_qualifications (position_id, qualification_id, waived_when_acting)
select p.id, q.id, true
from public.positions p
join public.grades g on g.code = p.nominal_grade
cross join public.qualifications q
where p.kind = 'primary' and g.band = 'officer' and p.title <> 'Fleet Commander'
  and q.code = 'commission';

insert into public.position_qualifications (position_id, qualification_id)
select p.id, q.id
from public.positions p
cross join public.qualifications q
where (p.title = 'Signaller' and q.code = 'net-controller')
   or (p.title = 'Instructor' and q.code = 'instructor');

-- ---------------------------------------------------------------------------
-- The founder takes the Fleet Commander position
-- ---------------------------------------------------------------------------

-- With no grade given the appointment lands on the bottom of the band, which
-- is Lieutenant Commander. This runs while the founder is signing in, so if the
-- appointment cannot be made it is skipped instead of stopping the sign-in.
create or replace function app.promote_founder(target uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.members
  set status = 'member', service = coalesce(service, 'navy')
  where id = target;

  insert into public.member_roles (member_id, role)
  select target, r from unnest(enum_range(null::public.app_role)) as r
  on conflict do nothing;

  begin
    insert into public.assignments (member_id, position_id, kind)
    select target, p.id, 'primary'
    from public.positions p
    join public.units u on u.id = p.unit_id
    where u.name = 'Fleet Command' and p.title = 'Fleet Commander'
      and not exists (
        select 1 from public.assignments a
        where a.kind = 'primary' and a.ended_on is null
          and (a.member_id = target or a.position_id = p.id)
      );
  exception when others then
    raise warning 'The founder was not appointed Fleet Commander: %', sqlerrm;
  end;
end;
$$;

revoke all on function app.promote_founder(uuid) from public, anon, authenticated, service_role;
