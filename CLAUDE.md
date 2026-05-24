# getmyfirstdollar.com — Project Rules

## Stack
- Plain static site: one `index.html`, one `styles.css`, one `script.js` at repo root.
- Two Vercel Node serverless functions in `api/` (classic `(req, res)` handler style).
- No Next.js, no React, no router, no `package.json` at root, no build step.
- Hosted on Vercel. Routing entirely via `vercel.json` rewrites + headers.

## DO NOT MODIFY (unless Rob explicitly says so)
- `api/posts.js`
- `api/subscribe.js`
- `index.html`
- `styles.css`
- `script.js`

These are the load-bearing surface of the live site. New features must live in new files.

## Coding conventions (observed in existing code)
- Serverless functions: `export default async function handler(req, res) { … }`. No frameworks, no Express, no SDKs. Plain `fetch` for outbound HTTP.
- Method check up front: `if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });`
- Errors return `res.status(<code>).json({ error: '<message>' })`. Catch-all `catch { return res.status(500).json({ error: 'Something went wrong' }); }`.
- Module-scoped `let cache = …` is the established pattern for hot caches.
- Frontend: vanilla DOM (`document.querySelectorAll`, `addEventListener`, `fetch`). No bundler, no JSX, no TS. Keep new client code in the same style.
- `async` IIFE pattern for page-init blocks (see `script.js` `loadArchive`).
- Two-space indent, single quotes, semicolons, trailing-comma style matches existing files.

## vercel.json catch-all trap
`vercel.json` has this rewrite as its **last** entry:

```json
{ "source": "/((?!api/).*)", "destination": "/index.html" }
```

It sends every non-`/api/` path to `index.html` with HTTP 200. Any new public route (`/v/[slug]`, `/admin`, etc.) MUST be added as a rewrite **above** this line — Vercel evaluates rewrites top-to-bottom and uses the first match. Adding a new file at `/admin/index.html` without a rewrite will NOT work; the catch-all wins.

## Env vars in play
- `BEEHIIV_API_KEY` — used by `api/posts.js` and `api/subscribe.js`. Do not touch.
- `BEEHIIV_PUBLICATION_ID` — same.
- New vars introduced by the deep-link feature (planned):
  - `EDGE_CONFIG` — Edge Config connection string (used by `@vercel/edge-config` SDK for reads)
  - `EDGE_CONFIG_ID` — bare Edge Config ID (used by writes via Vercel REST API)
  - `VERCEL_API_TOKEN` — Vercel REST API token scoped to the team, for writes
  - `VERCEL_TEAM_ID` — Vercel team ID (Edge Config is team-scoped per Rob, May 2026)
  - `ADMIN_PASSWORD` — shared password for `/admin` login
  - `ADMIN_COOKIE_SECRET` — random 32+ byte secret for HMAC-signing the admin session cookie
  - `POSTHOG_KEY` and `POSTHOG_HOST` — PostHog project key + ingest host for `/v/[slug]` click analytics

Local secrets live in `.env.local` (gitignored). Production values are set in Vercel project settings.

## Rule
Always plan before coding. Never invent requirements not stated by Rob.
