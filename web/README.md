# 9th Fleet website

The fleet's site. The public pages say what the fleet is, what it expects, and how joining works.
Members and applicants sign in with Discord and see their own record. It is a
[Next.js](https://nextjs.org) app deployed on Vercel.

## Run it

You need [Node.js](https://nodejs.org) 22 or newer.

```
cd web
npm install
npm run dev
```

Then open http://localhost:3000.

## Check it

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | Types |
| `npm run lint` | Code style and common mistakes |
| `npm run build` | That every page builds |
| `npm run e2e` | The whole site in a real browser: signing in, the member pages, applying and the staff pages. Run `npm run build` first |

GitHub runs all four on every push that touches `web/` or the database migrations.

The browser tests do not touch Discord or the live database. They need a browser:
`npx playwright-core install chromium`. There are two, and they use different stand-ins for Supabase:

| Test | Stand-in | What it is for |
| --- | --- | --- |
| `e2e/sign-in.mjs` | `e2e/mock-supabase.mjs`, which answers from memory | Sign-in, cookies, redirects, the member's record, the order of battle and what is sent to be counted |
| `e2e/recruiting.mjs` | `e2e/supabase-with-database.mjs`, which runs the real migrations in an in-memory PostgreSQL | The ranks, roles and manual pages, applying, the staff pages, operations, the admin pages and the logs, against the database's real rules |

Write new tests the second way. A refusal in that test is the database's own refusal, so the test
fails if the site and the rules ever disagree. The stand-in understands only the kinds of query the
site makes today and refuses anything else, so a new kind of query shows up as a failed test.

## Sign-in

| Address | What it does |
| --- | --- |
| `/sign-in` | The button that sends you to Discord |
| `/auth/discord` | Where the button posts. It answers with a redirect to Discord |
| `/auth/callback` | Where Discord sends you back. It turns Discord's one-time code into a session |
| `/profile` | Your record: status, service, rank, post, and your names |
| `/order-of-battle` | Every unit and post, who holds each, what is vacant and what opens later. For the serving fleet |
| `/operations` | Training and operation nights: the orders, the roll, stand-ins, the attendance return and the after-action report. For the serving fleet. Command drafts events, and instructors draft the types open to them. An event can be copied, and can repeat weekly |
| `/apply` | The application form, and the state of your application once it is sent |
| `/staff/applications` | For staff: the applications, their answers, interview notes and the decision. An admin opens and closes recruitment here |
| `/admin` | For the people who run the fleet: its figures. See Admin pages below |
| `/ranks` | Every grade and its rank name in each service, read from the database. Open to everyone |
| `/roles` | The areas of work, the roles in each, and a page for each role: what it is, what it does, what it needs, where it leads and the ships it is found on. Read from the database, where an admin keeps them. Open to everyone. It never shows who holds a post |
| `/manual` | The fleet manual: the doctrine volumes that have been reviewed, section by section. Open to everyone |
| `/credits` | Who took each picture on the site, and its licence |
| `/privacy` | What the site records about visitors and members, who can read it and how to have it removed. Change it whenever the logging or the sign-in changes |
| `/visit` | Not a page. A public page posts its address here once it has been read, to be counted |
| `/menu` | The menu as a page, for a browser that is not running scripts |

How it is kept safe:

- **The database decides.** The site holds no secret key. It acts as the signed-in person, and the
  database's own rules decide what they can see and change. See [`supabase/`](../supabase/README.md).
- **The session is in cookies that scripts cannot read.** Only the server talks to the database.
- **Every page and action checks the session again.** `proxy.ts` sends signed-out visitors to
  sign-in, but that is a convenience, not the lock.
- **Two more cookies hold no secret, and scripts can read them.** `nf_signed_in` tells the menu to
  offer "Your record" instead of "Sign in". `nf_tier` tells it whether to offer the admin pages. It
  lasts ten minutes, so a new role shows in the menu within ten minutes. Both are hints. Neither
  opens anything.
- **Leaving the site is done with a plain form and a plain redirect.** A Server Action that
  redirects to another site leaves the page's router pointing there, and in Safari the button then
  stops working after Back. Use a route handler for anything that sends the visitor elsewhere.

The site finds the database through two settings, which the Supabase integration on Vercel provides:
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Both are public values. To
run against the database on your own computer, copy `.env.example` to `.env.local` and fill them in.

Two things are set in the Supabase dashboard, under Authentication:

1. **Sign In / Providers.** Discord is switched on, with the Discord application's Client ID and
   Client Secret. The secret is typed in there and nowhere else.
2. **URL Configuration.** The Site URL is this site's address, and the same address followed by
   `/auth/callback` is in the list of Redirect URLs. Supabase refuses to send anyone back to an
   address that is not listed.

## Admin pages

The figures of the fleet, for the people who run it. A role decides which pages the site offers:

| Page | Who it is for | What it shows |
| --- | --- | --- |
| `/admin` | Staff, command and admins | Active strength against the stage, posts filled, and a list of what needs attention |
| `/admin/people` | Staff, command and admins | Everyone on the books, by status, service and grade, with qualifications. Command also sees attendance |
| `/admin/recruiting` | Staff, command and admins | How far applications get, how long decisions take, and which are still open |
| `/admin/operations` | Command and admins | Every event, turnout, late reports, and attendance member by member |
| `/admin/structure` | Admins | The editors: areas, roles, units, posts, qualifications, event types, and ranks and grades. See Editors below |
| `/admin/logs` | Admins | Everything that has happened: changes to records, sign-ins and sign-outs, anything refused or failed, and how often each public page is read |

An admin holds every role, so sees all of them. A role only counts while its holder is serving.

- **The tiers are in `lib/admin.ts`,** with every figure. The pages only lay the figures out.
- **The tiers are what the site offers, not the lock.** Every figure is read as the signed-in
  person, so the database's rules decide which rows come back.
- **The figures are counted from whole tables.** That suits a fleet of hundreds. Supabase returns at
  most a thousand rows to one request, so past that the counting moves into the database.
- **The charts are plain HTML,** in `components/admin/Charts.tsx`. Each is a table or a list, so it
  reads the same without its bars. Every bar of a chart is one blue, because gold is for things to
  press and green, amber and red are for states. The colours were checked for contrast and for
  colour-blind readers against the site's dark panels. Check any new colour the same way.

## Editors

An admin keeps the fleet's structure on the site, at `/admin/structure`. Nothing about a role, an
area, a unit or a post is written in the code.

| Editor | What it keeps |
| --- | --- |
| Areas | The areas of work on the roles pages: name, address, group, picture, description and what to read |
| Roles | What each kind of work is: its summary, what it does, what it needs, what to read and the role it leads to |
| Units | The formations, ships and departments, each under the one above |
| Posts | The places in each unit: title, role, grades, whether a new member can be given it, and what it needs on top of its role |
| Qualifications | What members earn in training |
| Event types | The kinds of night the fleet runs: who may draft each, its usual length and weapons state, and its own names for the five sections of its orders |
| Ranks and grades | What each service calls a grade, and what a member at that grade usually does |

- **A role is a record of its own.** Gunner is one role, on every ship. A post is one place for that
  work and has a role, so the role's page lists the ships it is found on.
- **Each editor is a sheet in `lib/structure.ts`:** a table and a list of fields. One editor,
  `app/admin/structure/Editor.tsx`, draws every sheet from its list. To make another column
  editable, add a field to its sheet. To make another kind of record editable, add a sheet, and a
  migration for its table, its rules and its `app.audit()` trigger.
- **Only the fields that changed are sent,** so the log shows what changed and a save that changes
  nothing writes no line.
- **The database has the last word.** Only an admin's changes get through. A post takes its kind
  from its role. A role keeps its kind while it has posts, and its steps cannot run in a circle. A
  post that someone has held cannot be removed, and neither can a type of event that has events. The
  18 grades, their codes and their order are fixed.
- **A picture is chosen from the ones the site has.** A new picture still has to be added to
  `lib/pictures.ts` with its credit.

## Logging

Everything that goes into the site is written down, and admins read it on one page, `/admin/logs`.
It is drawn from three places in the database:

| What | Where it is kept | Who writes it |
| --- | --- | --- |
| Every change to a record, with the row before and after | `audit_log` | The database, from a trigger on each table |
| Sign-ins, sign-outs, and anything refused or failed | `activity_log` | The site, as the person it is about. See `lib/activity.ts` |
| How many times each public page was read each day | `page_views` | The database, each time a page posts to `/visit` |

When you add something:

- **A new table** gets the `app.audit()` trigger in its migration, and its words in `describeChange`
  in `lib/logs.ts`. Until it has words it still shows, plainly.
- **A new action** needs nothing for the changes it makes. For the times it is turned down, give it a
  name in `attemptNames` in `lib/activity.ts`, then use `turnedDown` when the database answers with
  an error and `refused` when a change matched no row. A form that only needs correcting, such as a
  missing answer, is not logged.
- **A new page for a role** that no link offers to anyone else logs whoever reaches it anyway. The
  admin pages do this in `gate` in `lib/admin.ts`.
- **A new public page** is counted once its first part is in the list in `lib/visits.ts` and in
  `app.count_page_view` in the database. Keep the two in step. Member pages are never counted.

What is deliberately not kept: a visitor's address or browser, any cookie for counting, and which
pages a member reads. Page counts leave out robots that say what they are and browsers that ask not
to be tracked.

## Change the words

| To change | Edit |
| --- | --- |
| The fleet's name, flagship or the date recruitment opens | `lib/site.ts` |
| The front page | `app/page.tsx` |
| The standards page | `app/standards/page.tsx` |
| The ranks page | `app/ranks/`, and what it reads in `lib/ranks.ts`. The rank names themselves are in the database: change them at `/admin/structure/ranks` |
| A role's or an area's words, what a role needs and where it leads | On the site, at `/admin/structure` |
| How the roles pages are laid out | `app/roles/`, and what they read in `lib/roles.ts` |
| The groups the areas are filtered by, and what every member reads | `lib/areas.ts` |
| What an admin can edit, and each field's label and hint | `lib/structure.ts` |
| The fleet manual's words | The Markdown files in `content/manual/`. See Fleet manual below |
| The list of volumes, their state and the latest changes | `lib/manual.ts` |
| The joining page | `app/joining/page.tsx` |
| The sign-in page | `app/sign-in/page.tsx` |
| The order of battle page | `app/order-of-battle/page.tsx`, and what it reads in `lib/order-of-battle.ts` |
| The operations pages | `app/operations/`, and what they read in `lib/operations.ts` |
| The types of event | Nowhere in the code. An admin keeps them at `/admin/structure/event-types` |
| The weapons states, Volume 2's names for the order's five sections, and the event cycle | `lib/operations-form.ts` |
| The questions on the application form | `lib/application-form.ts` |
| The application page and the staff pages | `app/apply/` and `app/staff/applications/` |
| The member's record | `app/profile/page.tsx` |
| The admin pages | `app/admin/`, and the figures in `lib/admin.ts` |
| Which role opens which admin page | `lib/admin.ts` and the list of tabs in `components/admin/AdminHead.tsx` |
| How a line in the logs reads | `lib/logs.ts`, and the names of things people try in `lib/activity.ts` |
| What the site says it records | `app/privacy/page.tsx` |
| The menu | `lib/menu.ts` |
| The pictures | `lib/pictures.ts`. See Pictures below |
| Colours and type | `app/globals.css` |

## Fleet manual

The manual is the doctrine, published volume by volume. Each published volume is one Markdown file
in `content/manual/`: a `#` title, an opening paragraph, then a `##` heading for each section and
`###` headings inside a section. Each section becomes a page, and its first sentence is shown as its
summary.

To publish a volume once the Fleet Commander has reviewed it:

1. Put its Markdown in `content/manual/`. Leave out the review notes, the byline and anything
   addressed to the reviewer: the manual speaks to every member.
2. In `lib/manual.ts`, set the volume's `state` to `reviewed`, set `dated`, and name the file.
3. Add a line to `changes` in the same file.

A volume marked `draft` gets a page that names it and shows none of its text. A `planned` volume has
no page. Links into the manual from elsewhere go through `sectionLink`, which stops the build if a
section has been renamed.

The roles pages group posts into areas with `lib/areas.ts`. A post that no rule there places lands
in "Other posts", so nothing is left off the site.

## Search engines

The site tells search engines to stay out until launch. On launch day, set the environment
variable `SITE_INDEXABLE` to `1` in the Vercel project and redeploy. The sign-in and member pages
stay closed to search engines after that.

## Design

A dark Navy page with gold for the things that matter, led by pictures: a picture across the top of
every page, with the words over it or beside it. The typeface is Titillium Web. The crest and the IX
roundel are drawn as outlines in `components/Crest.tsx`, so they need no font.

## Pictures

The pictures come from two places, and `lib/pictures.ts` lists every one with its source, its author
and its licence, and says which picture fills which place. `/credits` lists them all.

**Players' screenshots.** Star Citizen screenshots whose authors published them on Flickr under a
Creative Commons licence. The author is named in the corner of each picture, as the licences ask.
These can be cropped and sit behind a dark tint, so they are used for banners, tiles and the menu.

**The fan kit.** Wallpapers and the "Made by the Community" logo from Cloud Imperium's
[fan kit](https://robertsspaceindustries.com/en/fankit), used under its Fankit Agreement, which the
Fleet Commander accepted when he downloaded it. Its rules are stricter, and the site keeps them like
this:

- **A wallpaper is shown whole and as supplied.** It keeps its Star Citizen watermark, and is not
  cropped, tinted, faded, recoloured or flipped. Only its size changes. `Picture` and the style sheet
  do this for any picture whose `source` is `fankit`.
- **So a wallpaper only goes in a plain frame**, never behind words. The plain frames are `intro`,
  `work`, `route`, `officers` and `duty`.
- **The logo is in the footer of every page**, as supplied.
- **The agreement's notice is in the footer, word for word.** Do not reword it.
- **If the site's address changes, Cloud Imperium must be told**, at the address in the agreement.

To add or change a picture:

1. Put the file in `pictures/`, no wider than 1920 pixels.
2. Add it to `shots` in `lib/pictures.ts`: `shot(...)` for a player's screenshot with its author,
   title, page and licence, or `wallpaper(...)` for one from the fan kit.
3. Point a place in `pictures` at it. The credits page picks it up by itself.

Three rules for every picture, which are Cloud Imperium's for fan sites and the licences' for the
screenshots:

- **Only use a picture you may use.** That means your own screenshots, the fan kit under its
  agreement, or a picture whose licence allows it. Do not copy pictures from the RSI website or from
  other players without a licence.
- **No commercial use.** The licences bar it, and so does Cloud Imperium.
- **Keep both notices in the footer and the link to the official site.** The wording is Cloud
  Imperium's own.
