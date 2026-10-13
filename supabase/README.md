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
| `migrations/…_event_types.sql` | The types of event as records an admin keeps, copying an event into a new draft, and the weekly repeat |
| `migrations/…_event_manning.sql` | Who takes part in an event: the units, extra posts for the night, posts that must be filled, who it is open to, and places with a reserve list |
| `migrations/…_event_plan.sql` | Fuller orders: objectives, elements and their tasks, the timeline, ships, nets, where to muster, what to read, and amendments with their acknowledgement |
| `migrations/…_event_report.sql` | Signing off a qualification at the event that teaches it, and the report's records: how each objective turned out, losses and mentions |
| `migrations/…_event_opfor.sql` | Command's approval for the types of event that need it, and the opposing force: its plan and who is on it, kept from the side being exercised |
| `migrations/…_event_unit_tasks.sql` | A task for each unit of an event and who reads it, and which post commands each unit and which posts lead |
| `migrations/…_unit_brings.sql` | What each unit brings to an event, a short list an admin keeps, and a picture for it |
| `migrations/…_service_record.sql` | A member's history: each change of status and of grade, kept as it happens, and who may read a member's past posts |
| `migrations/…_record_notes.sql` | The note on an appointment and on an award, kept for staff and out of the member's own view |
| `migrations/…_hostile_list.sql` | The hostile list: names put forward by members, listed, declined, renewed and lifted by command |
| `migrations/…_piracy_reports.sql` | The public piracy report line: what a visitor may send, how much the line takes, and what command does with a report |
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
| Visitor, not signed in | Whether recruitment is open, the grades and the rank names, and the structure: areas, roles, units, positions and the qualifications each requires. Never who holds one | Send a piracy report, and read nothing back |
| Applicant | The same, and their own record and their own application | Set a character name and an RSI handle, apply while recruitment is open, withdraw |
| Recruit, auxiliary, member, reservist | The serving fleet, the order of battle, who holds which position now and which qualification, every announced event with its orders, roll and report, their own service record, and the hostile list as it stands today | Change their RSI handle. Reply to an event until its roll closes. Stand in for an empty entry position if they hold none. A full member can apply for the cadet course |
| Instructor | The same | Award a qualification to someone else, in their own name. Draft an event of a type that is open to instructors, which at the start is training |
| Staff | Everyone, every application and the interview notes, and any member's service record | Move applications through their stages. Move a member between recruit, auxiliary, member and reserve. Set a member's service |
| Command | The same as staff, every entry of the hostile list: waiting, declined, lifted and lapsed, and the piracy reports | Appoint members to positions, promote within a band, discharge and reinstate. Draft and run any event. Keep the hostile list. Handle and delete piracy reports |
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
- **A member's history is their service record.** The database writes down the day a member's
  status changes, and the day their grade changes while they hold a position: a promotion, a
  reduction, or an acting grade given or confirmed. The days are days in UTC. Nobody writes or
  changes those lines through the API. A member reads their own history: the positions they have
  left, those days, and their attendance. Staff read anyone's. Everyone else serving reads only who
  holds a position now.
- **A grade put right after a position was left is a correction.** Only the database's owner can
  change a position that has ended. Doing so changes its last line and adds none, so the record
  does not show a promotion made today.
- **The hostile list is command's to keep.** Any serving member puts a name forward, in their own
  name, and may take it back while it waits. A member has five names waiting at most, and a name
  command declined waits 30 days before anyone but command puts it forward again. Only command
  lists a name, as hostile or on watch, declines it, rewrites a listed entry, moves it, renews it
  and lifts it. A name that waits stays as it was put forward. A name waits once and is listed
  once, an entry stays about the name it was made for, and one that was declined or lifted is
  closed. Listing a name closes an entry for the same name that has lapsed.
- **Someone outside the fleet learns nothing from the hostile list,** not even by trying a name:
  the refusal is the same whatever they send. The check of who is asking comes before every other.
- **An entry lapses by the calendar, not by a job.** A declared hostile organisation stands until
  it is lifted. An individual, and anything on watch, stands for 90 days from the day it was listed,
  moved between hostile and watch, or renewed. The database sets that day. Nothing runs to take a
  lapsed entry off: the rule that sends the list to the fleet leaves it out from the next day.
- **The list holds names from the game.** A player's handle or an organisation's ID, what they did
  in the game, and web addresses of a picture or a clip. A serving member of the fleet cannot be
  put forward, listed, moved or renewed, as a player or as an organisation: an entry for someone
  who has since joined can only be declined or lifted. The list is never sent to a visitor or to
  someone who has not joined. What an entry says is still for command to read before listing it:
  the database checks its shape, not whether it is fair.
- **Anyone sends a piracy report, and only command reads one.** A visitor sends the words of a
  report and nothing else: the database dates it, files it as new, and gives nothing back, not
  even the report as it was sent. Command marks it handled or dismissed, in their own name, reopens
  it and deletes it. Nobody changes its words. Staff and members are sent none of it.
- **The line has limits.** Five reports a day from one sender, and ten an hour and thirty a day
  from everyone together. One sender is known by a mark of four characters that the site works out
  from their network address and the day. The mark comes in with the report through the `sender`
  column, is counted in `app.piracy_senders`, and is thrown away: a rule on the column keeps it
  empty, so the mark is never stored with a report or written to the audit log. Someone who sends
  to the database directly can choose their own mark, so only the limit on everyone holds them.
- **A report holds plain words and names from the game.** Handles have the game's shape. Where it
  happened is one line. What happened is text whose lines may break and which holds no other
  control character and none of the marks that turn text right to left. Evidence is web addresses.
- **A report and what comes of it are linked.** Only command starts a hostile-list entry from a
  report, and the entry keeps the report's id. A report keeps the id of the Response event drafted
  from it. Deleting a report, an event or a member clears the link and changes nothing else, even
  on an entry that is closed.
- **Deleting a report or a hostile-list entry takes its words out of the audit log.** That it
  existed, when, and who did what stay.
- **Deleting an entry takes its words out of the audit log.** An admin deletes an entry to put
  right a mistake, or to take out something that should not have been written. The log keeps that
  the entry existed, who it named and who did what, and loses what it said.
- **A note on a member is for staff.** What command writes on an appointment is kept on the
  appointment, where the API cannot read it, and copied to its own table, which only staff are
  sent. What an instructor writes on an award is kept and sent to nobody. A page that asks for
  every column of an appointment or an award is refused, so name the columns.
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
- **The types of event are records.** An admin adds, renames and removes them. Each says whether
  instructors may draft it, how long it usually runs, its usual weapons state, and what it calls
  the five sections of its orders. A type that has events cannot be removed.
- **An event can be copied** into a new draft, which starts with the same orders. Only someone who
  can read an event can copy it, and what an event was copied from cannot be changed.
- **An event says who takes part.** Whoever runs it names the units, and then only their positions
  are on its roll. It can have positions of its own for the night, each with a role, filled the way
  any other is. It can mark positions that must be filled and set how many must attend. The
  database keeps those numbers. Whether the event goes ahead is the operation commander's decision.
- **An event can be closed to some.** It can be closed to recruits, kept to one service, or need a
  qualification. Anyone it is not open to can still say they are not attending. Whoever is named to
  run it or to observe is always welcome.
- **Places are given in the order replies arrive.** Past the number of places, a reply goes on the
  reserve list. When someone with a place drops out, the first on the list takes it. Whoever runs
  the event can move anyone on or off the list, and is always given a place themselves.
- **The plan is kept as records.** Objectives, the elements with their tasks and callsigns, the
  timeline, the ships and the nets each have a table. Whoever may write an event's orders writes
  them, and they are fixed with the event when it closes. A timing is kept as minutes before or
  after the start, so the timeline moves when the event does.
- **An amendment is never rewritten.** Whoever runs an announced event issues one. The database
  numbers it, dates it and signs it. A member who is attending acknowledges the latest, for
  themselves. Who has acknowledged is for whoever runs the event, and each member for their own line.
- **A pass is signed off at the event that teaches it.** An event can name the qualification it
  teaches. Once it has started, an instructor awards it to someone who was there, in their own name,
  and the award points back at the event. The attendance return has the last word on who was there.
  Who may award at all has not changed: an instructor, and never to themselves.
- **The report keeps records as well as words.** Whoever ran an event says how each objective turned
  out, what was lost, and who is mentioned. A mention is written about someone else, one for each
  member for each event, and is read by the serving fleet with the event and on the member's record.
- **A type of event can need command's approval.** An admin says so on the type. A draft of that
  type by anyone but command cannot be announced until command approves it. The database records
  who approved it and when, and takes the approval back if the draft's type is changed afterwards.
  Command's own drafts never wait.
- **The opposing force is kept from the side it is set against.** Command names who is on it, and
  who leads it. Its plan and its members can be read by command and by those members, and by nobody
  else, which includes the event's own commander, second-in-command and author. Whoever leads it
  can write its plan. A member named to it comes off the event's roll and cannot reply to it. They
  read the event's orders like anyone else. A copy brings the opposing force with it only when
  command makes the copy.
- **Each unit has a task, and a level says who reads it.** Everyone, the unit, the unit's leaders, or
  its commander alone. The commanders of the units above always read it, and so do command and
  whoever writes the event's orders. Everyone else who can read the event is shown that the unit has
  a task, and none of its words. A new task starts as the unit's own.
- **A task's words are kept apart from the task.** The task's own table cannot be asked for them.
  They are copied to a second table, which returns a row only to someone the level allows.
- **A unit's commander passes a task down, and does nothing else to it.** From the commander to the
  leaders or the unit, and from the leaders to the unit. Never beyond the unit, and never back up.
- **Standing in counts.** Someone standing in for a post reads what its holder would, for that event.
  A member of the event's opposing force reads only what everyone reads, whatever post they hold.
- **Every task opens when the event closes.** A copy brings only the tasks the person copying may read.
- **The order of battle says who commands and who leads.** A unit names the post that commands it,
  which may sit in a unit under it. A post can be marked as a leader's. An admin keeps both.
- **A weekly event drafts the next one.** When it is closed, or cancelled after it was announced,
  the database drafts next week's with the same details and orders, in the name of whoever closed
  it. A number at the end of the title goes up by one. The draft is never announced by itself.
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
grants, triggers, constraints and views. It matched after the latest, `hostile_list`.

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
