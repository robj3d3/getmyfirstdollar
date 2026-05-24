# getmyfirstdollar.com

Static site + Vercel serverless functions.

## Deep links (`/v/<slug>`)

Short, brandable URLs that deep-link to YouTube. Edit/add via `/admin`.

### Env vars

All set in **Vercel → Project → Settings → Environment Variables**. Local dev mirrors them in `.env.local` (gitignored).

| Variable | Purpose |
| --- | --- |
| `EDGE_CONFIG` | Edge Config connection string. Vercel auto-injects this when you attach an Edge Config store to the project. Used by `@vercel/edge-config` for low-latency reads at the edge. |
| `EDGE_CONFIG_ID` | Bare Edge Config ID (the `ecfg_…` value). Used by the write helper. |
| `VERCEL_API_TOKEN` | Vercel REST API token scoped to the team. Generate at vercel.com/account/tokens. Used to PATCH the Edge Config. |
| `VERCEL_TEAM_ID` | The team ID that owns the Edge Config. Found at Vercel → Team Settings. |
| `ADMIN_PASSWORD` | Password for the `/admin` login form. |
| `ADMIN_COOKIE_SECRET` | Random 32+ byte string used to HMAC-sign the `admin_session` cookie. Rotate to log everyone out. Generate with `openssl rand -hex 32`. |
| `POSTHOG_KEY` | PostHog project API key. Without it the redirect page renders a no-op `capture()` and skips analytics. |
| `POSTHOG_HOST` | PostHog ingest host (`https://eu.i.posthog.com` or `https://us.i.posthog.com`). |

The existing `BEEHIIV_API_KEY` and `BEEHIIV_PUBLICATION_ID` remain in use for the newsletter — unchanged.

### One-time Edge Config setup

1. Vercel dashboard → **Storage → Create → Edge Config**. Name it (anything), pick the same team as the project.
2. Open the Edge Config → **Connect to Project → getmyfirstdollar.com**. This auto-injects `EDGE_CONFIG` into the project's env.
3. Copy the Edge Config **ID** (`ecfg_…`) from the URL or details panel → set as `EDGE_CONFIG_ID` env var.
4. Copy the **team ID** from Team Settings → set as `VERCEL_TEAM_ID`.
5. Create a Vercel API token at vercel.com/account/tokens scoped to that team → set as `VERCEL_API_TOKEN`.
6. Generate `ADMIN_COOKIE_SECRET`: `openssl rand -hex 32`. Pick a memorable `ADMIN_PASSWORD`.
7. (Optional) Add `POSTHOG_KEY` + `POSTHOG_HOST` to wire up click analytics.
8. Redeploy so the new env vars take effect.

The schema is a single key, `links`, holding `{ "<slug>": { "videoId": "…", "createdAt": <epoch-ms> } }`. The first create from the admin UI initialises it — no manual seeding needed.

### Creating your first link

1. Visit `https://www.getmyfirstdollar.com/admin`.
2. Enter `ADMIN_PASSWORD`. The cookie lasts 7 days.
3. Paste a YouTube URL into the **YouTube URL or 11-char video ID** field. Any of these work:
   - `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
   - `https://youtu.be/dQw4w9WgXcQ`
   - `https://www.youtube.com/shorts/abcDEF12345`
   - `https://www.youtube.com/live/ZyhrYis509A`
   - `dQw4w9WgXcQ` (raw 11-char ID)
4. Optionally type a custom slug (e.g. `launch`). Leave blank to use the video ID itself.
5. Click **Create link**. The row appears in the list with a copy button and a thumbnail.
6. Share `https://www.getmyfirstdollar.com/v/<slug>`.

### Behaviour by client

| Client | What happens |
| --- | --- |
| iOS Safari w/ YouTube app | `youtube://` scheme opens the app; if no app, falls back to `m.youtube.com` after 500ms. |
| Android Chrome | `intent://` URL opens the app, or `S.browser_fallback_url` takes over. |
| Desktop browser | Immediate `location.replace` to `https://www.youtube.com/watch?v=…`. No 500ms delay. |
| Instagram in-app browser | Skips the deep-link attempt (UA detected), goes straight to https — Instagram blocks custom schemes. |

### Storage notes

- Click counts are NOT in Edge Config. PostHog captures `deep_link_clicked` with `{ slug, videoId, platform }` per redirect.
- Admin writes replace the entire `links` map atomically via `PATCH /v1/edge-config/{id}/items?teamId=…` with an `upsert` operation.

### Local dev

`vercel dev` runs the full stack locally. Set the env vars in `.env.local`. Note that Edge Config reads still go to the real Vercel edge — there is no local emulator.
