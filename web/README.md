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
| `npm run e2e` | Signing in, the member pages and signing out, in a real browser. Run `npm run build` first |

GitHub runs all four on every push that touches `web/`.

The browser test does not touch Discord or the fleet's database. It runs the built site against a
small stand-in for Supabase, in `e2e/mock-supabase.mjs`, and checks the hand-off, the session
cookies, the redirects, saving names and the order of battle. The stand-in serves the units and
posts from `e2e/fixtures/order-of-battle.json`, which is a copy of what the database migrations
create. It needs a browser: `npx playwright-core install chromium`.

## Sign-in

| Address | What it does |
| --- | --- |
| `/sign-in` | The button that sends you to Discord |
| `/auth/discord` | Where the button posts. It answers with a redirect to Discord |
| `/auth/callback` | Where Discord sends you back. It turns Discord's one-time code into a session |
| `/profile` | Your record: status, service, rank, post, and your names |
| `/order-of-battle` | Every unit and post, who holds each, what is vacant and what opens later. For the serving fleet |

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
| The joining page | `app/joining/page.tsx` |
| The sign-in page | `app/sign-in/page.tsx` |
| The order of battle page | `app/order-of-battle/page.tsx`, and what it reads in `lib/order-of-battle.ts` |
| The member's record | `app/profile/page.tsx` |
| Colours and type | `app/globals.css` |

## Search engines

The site tells search engines to stay out until launch. On launch day, set the environment
variable `SITE_INDEXABLE` to `1` in the Vercel project and redeploy. The sign-in and member pages
stay closed to search engines after that.

## Design

The page is drawn as the side of a ship: weatherwork grey above the waterline, the fleet's
number painted on the hull, a black boot-topping line, and red anti-fouling paint below it
for the footer. The one typeface is Archivo, set narrow and heavy for headings.
