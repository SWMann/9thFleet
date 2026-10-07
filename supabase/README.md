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
| `tests/` | Tests that sign in as each kind of person and check what they can and cannot do |

Events, attendance and the link to the voice app are not here yet.

## Words

A **position** is a member's standing place in a unit, such as Turret Gunner 3 on UEES Nexus.
Doctrine calls it a post and members call it a slot. Nobody picks one per event: you hold it until
you are moved.

A **duty** is a part-time staff job, such as Recruiter, held as well as a position.

## The rules

Staff look after people, command makes appointments, and the admin owns the structure.

| Who | Can see | Can do |
| --- | --- | --- |
| Visitor, not signed in | Whether recruitment is open, the grades and the rank names | Nothing |
| Applicant | Their own record and their own application | Set a character name and an RSI handle, apply while recruitment is open, withdraw |
| Recruit, auxiliary, member, reservist | The serving fleet, the order of battle, and who holds which position and qualification | Change their RSI handle. A full member can apply for the cadet course |
| Instructor | The same | Award a qualification to someone else, in their own name |
| Staff | Everyone, every application and the interview notes | Move applications through their stages. Move a member between recruit, auxiliary, member and reserve. Set a member's service |
| Command | The same as staff | Appoint members to positions, promote within a band, discharge and reinstate |
| Admin | Everything, including the audit log | Keep the order of battle, grant roles, open recruitment, open a service, move the fleet to a new stage |

Roles add up: an admin holds every role. Things the database decides for itself:

- **Rank is never stored.** It is read from the member's position, grade and service. Leave a
  position and the grade is kept for 30 days, then drops to the bottom of the band.
- **An appointment has to fit.** The position and its unit must be open at the fleet's current
  stage. The member must be a full member of the right service, hold the qualifications the
  position asks for, and take a grade inside its band.
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
- **Names are unique inside the fleet.** Someone outside it cannot find out which are taken.
- **Every change is logged** with who made it. Nobody can write to the log.
- **Deleting an account** removes the member's records and blanks what the log held about them.

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

## Put it on Supabase

Do this once the Supabase project exists.

1. Apply the three migrations in order. With the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
   that is `supabase link` and then `supabase db push`, run from the root of this repository.
2. In Supabase, under Authentication, switch on the Discord provider and switch off sign-ups by
   email. The database ignores accounts that did not come from Discord, so this is a second lock.
3. Leave the API's exposed schemas as they are. The `app` schema must never be added to that list.
4. Name the founder. In the SQL editor, with your own Discord user ID in place of the number:

   ```sql
   update app.bootstrap set founder_discord_id = '123456789012345678';
   ```

   That account becomes Fleet Commander with every role, whether it signs in before or after this
   is run. A Discord user ID is not a secret. It works once: as soon as the fleet has an admin,
   the ID carries no power.

## Change it safely

The admin will change the order of battle through the website. Until that page exists, add a
migration. Copy the pattern in the launch order of battle: a unit, its positions with a grade band
and the stage they open at, and any qualifications they require.

When you add a migration:

- **A new table is locked to everyone** until the migration grants access and adds its rules.
- **A new function cannot be run by anyone** until the migration grants it. Keep functions in the
  `app` schema, where the API cannot reach them.
- **Grant inserts and updates column by column** wherever the database fills in a date or a name.
- **Run migrations as the `postgres` role,** which is what the Supabase CLI and SQL editor do. The
  locked-by-default settings belong to that role.
- **Add a test for every rule.** `tests/structure.test.mjs` fails if a table or function is left
  open by accident.
