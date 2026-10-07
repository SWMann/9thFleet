# 9th Fleet website

The fleet's public site: what the fleet is, what it expects, and how joining works. It is a
[Next.js](https://nextjs.org) app deployed on Vercel. Sign-in and the member platform will be
added to this app later.

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

GitHub runs all three on every push that touches `web/`.

## Change the words

| To change | Edit |
| --- | --- |
| The fleet's name, flagship or the date recruitment opens | `lib/site.ts` |
| The front page | `app/page.tsx` |
| The standards page | `app/standards/page.tsx` |
| The joining page | `app/joining/page.tsx` |
| Colours and type | `app/globals.css` |

## Search engines

The site tells search engines to stay out until launch. On launch day, set the environment
variable `SITE_INDEXABLE` to `1` in the Vercel project and redeploy.

## Design

The page is drawn as the side of a ship: weatherwork grey above the waterline, the fleet's
number painted on the hull, a black boot-topping line, and red anti-fouling paint below it
for the footer. The one typeface is Archivo, set narrow and heavy for headings.
