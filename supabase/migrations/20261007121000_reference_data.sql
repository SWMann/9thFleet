-- UEE 9th Fleet: grades, ranks and qualifications.
--
-- The grade scale and rank names are the ones in the roadmap. Rank names come
-- from CIG's lore, with the departures the roadmap lists: Gunnery Sergeant
-- covers E5 and E6 in the Marines, and the Army's two general ranks cover O7
-- to O10.

insert into public.grades (code, sort_order, band, typical_position) values
  ('E1',  1,  'enlisted', 'Recruit or auxiliary'),
  ('E2',  2,  'enlisted', 'Qualified crew member'),
  ('E3',  3,  'enlisted', 'Experienced hand, specialist'),
  ('E4',  4,  'nco',      'Team leader'),
  ('E5',  5,  'nco',      'Section or department lead'),
  ('E6',  6,  'nco',      'Senior enlisted of a ship or platoon'),
  ('E7',  7,  'nco',      'Senior enlisted of the service'),
  ('OC',  8,  'cadet',    'Cadet in training'),
  ('O1',  9,  'officer',  'Junior officer'),
  ('O2',  10, 'officer',  'Watch or flight lead'),
  ('O3',  11, 'officer',  'Department head, platoon commander'),
  ('O4',  12, 'officer',  'Frigate CO'),
  ('O5',  13, 'officer',  'Group CO'),
  ('O6',  14, 'officer',  'Task force commander'),
  ('O7',  15, 'officer',  'Squadron commander'),
  ('O8',  16, 'officer',  'Battle group commander'),
  ('O9',  17, 'officer',  'Deputy fleet commander'),
  ('O10', 18, 'officer',  'Fleet commander');

insert into public.ranks (service, grade_code, name) values
  ('navy', 'E1',  'Starman Recruit'),
  ('navy', 'E2',  'Starman'),
  ('navy', 'E3',  'Leading Starman'),
  ('navy', 'E4',  'Jr. Petty Officer'),
  ('navy', 'E5',  'Petty Officer'),
  ('navy', 'E6',  'Chief Petty Officer'),
  ('navy', 'E7',  'Master Chief Petty Officer'),
  ('navy', 'OC',  'Cadet'),
  ('navy', 'O1',  'Ensign'),
  ('navy', 'O2',  'Lieutenant Junior Grade'),
  ('navy', 'O3',  'Lieutenant'),
  ('navy', 'O4',  'Lt. Commander'),
  ('navy', 'O5',  'Commander'),
  ('navy', 'O6',  'Captain'),
  ('navy', 'O7',  'Commodore'),
  ('navy', 'O8',  'Rear Admiral'),
  ('navy', 'O9',  'Vice Admiral'),
  ('navy', 'O10', 'Admiral'),

  ('army', 'E1',  'Private'),
  ('army', 'E2',  'Private First Class'),
  ('army', 'E3',  'Specialist'),
  ('army', 'E4',  'Corporal'),
  ('army', 'E5',  'Sergeant'),
  ('army', 'E6',  'Master Sergeant'),
  ('army', 'E7',  'Sergeant Major'),
  ('army', 'OC',  'Officer Cadet'),
  ('army', 'O1',  '2nd Lieutenant'),
  ('army', 'O2',  'Lieutenant'),
  ('army', 'O3',  'Captain'),
  ('army', 'O4',  'Major'),
  ('army', 'O5',  'Lieutenant Colonel'),
  ('army', 'O6',  'Colonel'),
  ('army', 'O7',  'Brigadier General'),
  ('army', 'O8',  'Brigadier General'),
  ('army', 'O9',  'General'),
  ('army', 'O10', 'General'),

  ('marines', 'E1',  'Trooper'),
  ('marines', 'E2',  'Trooper First Class'),
  ('marines', 'E3',  'Lance Corporal'),
  ('marines', 'E4',  'Corporal'),
  ('marines', 'E5',  'Gunnery Sergeant'),
  ('marines', 'E6',  'Gunnery Sergeant'),
  ('marines', 'E7',  'Sergeant Major'),
  ('marines', 'OC',  'Cadet'),
  ('marines', 'O1',  '2nd Lieutenant'),
  ('marines', 'O2',  'Lieutenant'),
  ('marines', 'O3',  'Captain'),
  ('marines', 'O4',  'Major'),
  ('marines', 'O5',  'Lieutenant Colonel'),
  ('marines', 'O6',  'Colonel'),
  ('marines', 'O7',  'Brigadier General'),
  ('marines', 'O8',  'Major General'),
  ('marines', 'O9',  'Lieutenant General'),
  ('marines', 'O10', 'General');

-- The qualifications the launch order of battle needs. The first three are the
-- recruit route in the roadmap. Radio user and Net controller are defined in
-- Volume 3. Staff add more as the training volumes are written.
insert into public.qualifications (code, name, description) values
  ('induction',      'General induction', 'Values, conduct, how operations run, the voice app set up and a radio check.'),
  ('radio-user',     'Radio user',        'Common training passed, ending with an assessed radio exchange.'),
  ('navy-crew',      'Navy crew',         'Navy branch training: ship stations, emergency drills, turret and damage-control basics.'),
  ('net-controller', 'Net controller',    'Cleared to control a net as Zero and to keep its log.'),
  ('instructor',     'Instructor',        'Cleared to run training and to sign off qualifications.'),
  ('commission',     'Commission',        'Passed the cadet course and the commissioning board.');
