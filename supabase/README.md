# 9th Fleet database

The fleet's records and the rules about who may see and change them. It is a PostgreSQL database
hosted on [Supabase](https://supabase.com). The website and the voice app both read from it.

The rules are enforced by the database itself, so a mistake in the website cannot expose a record
or let someone promote themselves.

## What is here

| File | What it holds |
| --- | --- |
| `migrations/…_core_schema.sql` | Members, the order of battle, qualifications, recruiting, the audit log and every access rule |
| `migrations/…_reference_data.sql` | The 18 grades, the rank names for each service and the first six qualifications |
| `migrations/…_launch_order_of_battle.sql` | The units and positions that open in stages 1 to 3, from Volume 1 |
| `migrations/…_public_structure.sql` | Lets anyone read the units, the positions and what each requires, for the site's roles pages |
| `migrations/…_operations.sql` | Events, their orders, the roll with its stand-ins, the attendance return and after-action reports |
| `migrations/…_logging.sql` | The activity log for sign-ins, sign-outs and anything refused or failed, and the page counts for public pages |
| `migrations/…_fleet_roles.sql` | Areas and fleet roles as records an admin keeps, a role for every position, and the rules that let an admin rename ranks |
| `tests/` | Tests that sign in as each kind of person and check what they can and cannot do |

The link to the voice app is not here yet.

## Words

A **position** is a member's standing place in a unit, such as Turret Gunner 3 on UEES Nexus.
Doctrine calls it a post and members call it a slot. Nobody picks one per event: you hold it until
you are moved.

A **duty** is a part-time staff job, such as Recruiter, held as well as a position.

A **fleet role** is a kind of work, such as Gunner. Every position has one, and a role belongs to an
**area** of work, such as Gunnery. The role says what the work is, what it needs and where it leads.
It is not a member's role on the site (instructor, staff, command or admin), which is kept in
`member_roles`.

## The rules

Staff look after people, command makes appointments, and the admin owns the structure.

| Who | Can see | Can do |
| --- | --- | --- |
| Visitor, not signed in | Whether recruitment is open, the grades and the rank names, and the structure: areas, roles, units, positions and the qualifications each requires. Never who holds one | Nothing |
| Applicant | The same, and their own record and their own application | Set a character name and an RSI handle, apply while recruitment is open, withdraw |
| Recruit, auxiliary, member, reservist | The serving fleet, the order of battle, who holds which position and qualification, and every announced event with its orders, roll and report | Change their RSI handle. Reply to an event until its roll closes. Stand in for an empty entry position if they hold none. A full member can apply for the cadet course |
| Instructor | The same | Award a qualification to someone else, in their own name. Draft a training event |
| Staff | Everyone, every application and the interview notes | Move applications through their stages. Move a member between recruit, auxiliary, member and reserve. Set a member's service |
| Command | The same as staff | Appoint members to positions, promote within a band, discharge and reinstate. Draft and run any event |
| Admin | Everything, including the audit log, the activity log and the page counts | Keep the order of battle, the areas and roles, the qualifications and the rank names. Grant roles on the site, open recruitment, open a service, move the fleet to a new stage |

Roles add up: an admin holds every role. Things the database decides for itself:

- **Rank is never stored.** It is read from the member's position, grade and service. Leave a
  position and the grade is kept for 30 days, then drops to the bottom of the band.
- **An appointment has to fit.** The position and its unit must be open at the fleet's current
  stage. The member must be a full member of the right service, hold the qualifications the
  position asks for, and take a grade inside its band.
- **A position has a role and takes its kind from it.** A primary position has a primary role, and a
  duty has a duty's role. A role keeps its kind while it has positions.
- **What a role needs, every position of that role needs.** An appointment checks the role's
  qualifications and then the position's own.
- **A role says where it leads.** The steps from role to role cannot run in a circle.
- **Officer positions need a commission**, unless the appointment is acting. An acting rank ends
  with the appointment.
- **Signing in creates an applicant.** Accepting their application makes them a recruit.
- **Nobody decides anything about themselves:** not their application, their qualification, their
  appointment, their promotion or their status. The admin is the one exception, so the fleet can
  start.
- **Dates and signatures belong to the database.** Nobody can backdate an appointment, an award
  or an application, or sign one in someone else's name.
- **Staff and command cannot change an admin's record or appointments,** and the last admin cannot
  be removed.
- **An event is run by its operation commander, its second-in-command, or command.** Whoever runs it
  writes its orders, places stand-ins, makes the attendance return and files the report. A draft is
  seen only by the people working on it.
- **The roll closes 24 hours before the start**, or at the start if the event was announced with less
  than a day to go. After that a reply cannot change.
- **A stand-in fills a position that is empty on the night.** An attending member who holds no
  position may take an empty entry position. Leadership and key positions are filled by whoever runs
  the event, who may also move a holder up for the night.
- **The attendance return is not for the whole fleet.** Whoever ran the event makes it once the event
  has started. A member sees their own line, and staff and whoever ran the event see them all.
- **A finished event is fixed.** Its details and orders cannot change, and it is cancelled, never
  deleted, once it has been announced.
- **The grades are fixed.** Their codes, bands and order cannot be changed through the website. An
  admin can change what each service calls a grade and what a member at that grade usually does.
- **Names are unique inside the fleet.** Someone outside it cannot find out which are taken.
- **Every change is logged** with who made it. Nobody can write to the log.
- **What changes no record is logged too.** Sign-ins, sign-outs and anything refused or failed go in
  the activity log. The site writes each line as the person it is about. The database says whose
  line it is and when, so nobody can write one in another name or date it. Past thirty lines in a
  minute from one person, the rest are dropped.
- **Public pages are counted, not readers.** A view adds one to that page's total for the day. No
  row is kept for the view itself, and a total holds nothing about who read the page. Member pages
  and made-up addresses are not counted.
- **Only admins read the logs and the counts.**
- **Deleting an account** removes the member's records and their lines in the activity log, and
  blanks what the audit log held about them.

## Run the tests

You need [Node.js](https://nodejs.org) 22 or newer. Nothing else: the tests run a real PostgreSQL
in memory, apply the migrations to it and act as each kind of user.

```
cd supabase
npm install
npm test
```

GitHub runs them on every push that touches `supabase/`.

`tests/supabase-shim.sql` stands in for the parts Supabase provides: the API roles, the sign-in
tables and Supabase's own default privileges. It is only for the tests.

## The live database

The migrations are applied to the fleet's Supabase project, `9thFleet`, in London. The live
database is compared with the tested copy after each one is applied: its functions, rules, columns,
grants, triggers, constraints and views. It matched after the latest, `fleet_roles`.

Each file name starts with the version number Supabase recorded when it was applied, so this folder
and the database's own migration history agree.

Three settings live in the Supabase dashboard, not in these files:

1. **Sign-in.** Under Authentication, the Discord provider is on and sign-ups by email are off. The
   database ignores accounts that did not come from Discord, so this is a second lock.
2. **The API.** The exposed schemas stay as they are. The `app` schema must never be added.
3. **The founder.** One line, run once in the SQL editor with the founder's Discord user ID:

   ```sql
   update app.bootstrap set founder_discord_id = '123456789012345678';
   ```

   That account becomes Fleet Commander with every role, whether it signs in before or after this
   is run. A Discord user ID is not a secret. It works once: as soon as the fleet has an admin,
   the ID carries no power.

## Change it safely

The admin changes the order of battle through the website, at `/admin/structure`: areas, roles,
units, positions and qualifications. Use a migration only to change the shape of the data, such as
a new table or a new rule.

When you add a migration:

- **A new table is locked to everyone** until the migration grants access and adds its rules.
- **A new function cannot be run by anyone** until the migration grants it. Keep functions in the
  `app` schema, where the API cannot reach them.
- **Grant inserts and updates column by column** wherever the database fills in a date or a name.
- **Run migrations as the `postgres` role,** which is what the Supabase CLI and SQL editor do. The
  locked-by-default settings belong to that role.
- **Name the file after the version Supabase records** once the migration is applied, so the folder
  and the database keep agreeing.
- **Add a test for every rule.** `tests/structure.test.mjs` fails if a table or function is left
  open by accident.
