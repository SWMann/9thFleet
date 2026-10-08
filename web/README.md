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
| `e2e/sign-in.mjs` | `e2e/mock-supabase.mjs`, which answers from memory | Sign-in, cookies, redirects, the member's record and the order of battle |
| `e2e/recruiting.mjs` | `e2e/supabase-with-database.mjs`, which runs the real migrations in an in-memory PostgreSQL | The ranks, roles and manual pages, applying and the staff pages, against the database's real rules |

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
| `/apply` | The application form, and the state of your application once it is sent |
| `/staff/applications` | For staff: the applications, their answers, interview notes and the decision. An admin opens and closes recruitment here |
| `/ranks` | Every grade and its rank name in each service, read from the database. Open to everyone |
| `/roles` | The areas of work, the posts in each and a card for each kind of post, read from the database. Open to everyone. It never shows who holds a post |
| `/manual` | The fleet manual: the doctrine volumes that have been reviewed, section by section. Open to everyone |
| `/credits` | Who took each picture on the site, and its licence |
| `/menu` | The menu as a page, for a browser that is not running scripts |

How it is kept safe:

- **The database decides.** The site holds no secret key. It acts as the signed-in person, and the
  database's own rules decide what they can see and change. See [`supabase/`](../supabase/README.md).
- **The session is in cookies that scripts cannot read.** Only the server talks to the database.
- **Every page and action checks the session again.** `proxy.ts` sends signed-out visitors to
  sign-in, but that is a convenience, not the lock.
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

## Change the words

| To change | Edit |
| --- | --- |
| The fleet's name, flagship or the date recruitment opens | `lib/site.ts` |
| The front page | `app/page.tsx` |
| The standards page | `app/standards/page.tsx` |
| The ranks page | `app/ranks/`, and what it reads in `lib/ranks.ts`. The rank names themselves are in the database |
| The roles pages | `app/roles/`, and what they read in `lib/roles.ts`. The posts themselves are in the database |
| Which area a post belongs to, and the areas' names, pictures and descriptions | `lib/areas.ts` |
| The fleet manual's words | The Markdown files in `content/manual/`. See Fleet manual below |
| The list of volumes, their state and the latest changes | `lib/manual.ts` |
| The joining page | `app/joining/page.tsx` |
| The sign-in page | `app/sign-in/page.tsx` |
| The order of battle page | `app/order-of-battle/page.tsx`, and what it reads in `lib/order-of-battle.ts` |
| The questions on the application form | `lib/application-form.ts` |
| The application page and the staff pages | `app/apply/` and `app/staff/applications/` |
| The member's record | `app/profile/page.tsx` |
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

Every picture is a Star Citizen screenshot whose author published it on Flickr under a Creative
Commons licence. `lib/pictures.ts` lists each one with its author, the page it came from and its
licence, and says which picture fills which place. The author is named in the corner of each
picture, and `/credits` lists them all, as the licences ask.

To add or change a picture:

1. Put the file in `pictures/`, no wider than 1920 pixels.
2. Add it to `shots` in `lib/pictures.ts` with its author, title, page and licence.
3. Point a place in `pictures` at it. The credits page picks it up by itself.

Three rules, which are Cloud Imperium's for fan sites and the licences' for the pictures:

- **Only use a picture you may use.** That means your own screenshots, the RSI fan kit once you have
  accepted its agreement, or a picture whose licence allows it. Do not copy pictures from the RSI
  website or from other players without a licence.
- **No commercial use.** The licences here bar it, and so does Cloud Imperium.
- **Keep the notice in the footer and the link to the official site.** The wording is Cloud
  Imperium's own.
