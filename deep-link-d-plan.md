# Deep-link feature — implementation plan

## Context

Rob shares YouTube videos to his audience and wants a short, brandable URL per video — `getmyfirstdollar.com/v/<slug>` — that:
- Opens the YouTube app on iOS / Android when installed (deep link)
- Falls back to `m.youtube.com` after 500ms if the app isn't installed
- Goes straight to `youtube.com` on desktop (no deep-link attempt)
- Works inside Instagram's in-app browser (where deep links are blocked) by skipping straight to the https fallback
- Is managed via a tiny password-protected `/admin` page on the same domain (no Git commit / no redeploy per link)

Why now: existing analytics live in PostHog; sharing raw YouTube URLs gives Rob no attribution per channel and no way to swap the destination later. Vanity slugs on his own domain solve both.

Storage: **Vercel Edge Config**, already decided. Reads use `@vercel/edge-config` (cached at the edge). Writes use the Vercel REST API `PATCH /v1/edge-config/{id}/items` endpoint (confirmed against current Vercel docs, May 2026).

## Files to create

| Path | Purpose |
| --- | --- |
| `api/v/[slug].js` | Serverless function for `/api/v/<slug>` — looks up slug in Edge Config, returns the redirect HTML page (or 404 if unknown) |
| `api/admin/page.js` | Serves the admin HTML — returns the login form if not authed, the dashboard UI if authed |
| `api/admin/login.js` | `POST` — verifies `ADMIN_PASSWORD`, sets the HMAC-signed `admin_session` cookie |
| `api/admin/logout.js` | `POST` — clears the cookie |
| `api/admin/links.js` | `GET` (list), `POST` (create), `DELETE` (remove). All gated by `admin_session` cookie. Routed via `req.method` switch. |
| `api/_lib/auth.js` | HMAC-SHA256 sign + verify helpers for the session cookie. Vercel excludes files and directories under `/api/` whose name begins with `_` from being deployed as functions — verified May 2026 against vercel/vercel discussion #4983 and vercel/community discussion #46. Sibling functions can still `import` from them. |
| `api/_lib/edge.js` | Thin helpers: `getLinks()` (read via SDK), `writeLinks(items)` (PATCH via REST). |
| `api/_lib/redirect-page.js` | Returns the redirect-page HTML string given `{ slug, videoId }`. |
| `api/_lib/cookies.js` | Tiny `parseCookies(req)` / `serializeCookie(name, value, opts)` — avoids adding a dependency for two helpers. |

No new files at the repo root other than `CLAUDE.md`, `deep-link-d-plan.md`, and `package.json`. Helpers live under `api/_lib/` because Vercel's `_`-prefix rule excludes them from function deployment (sources cited in the table above) — this keeps helper modules out of the function count and unreachable as endpoints, while still letting sibling functions import them by relative path. If on first deploy the `_` rule turns out not to apply for any reason, the fallback is to move helpers to a root `lib/` directory and import via `../../lib/foo.js` (Vercel includes files referenced by function imports regardless of location).

## Files to modify

| Path | Exact change |
| --- | --- |
| `vercel.json` | Replace the `rewrites` array with the full version below. Headers block is unchanged. |
| `.env.local` | Add the six new env vars listed under "Env vars" in `CLAUDE.md`. Production values go in Vercel project settings, not committed. |
| `package.json` | **New file at repo root** — add `{ "dependencies": { "@vercel/edge-config": "^1" } }`. The repo has no `package.json` today; adding one is required to install the SDK. Vercel will run `npm install` on deploy. |

Files explicitly NOT modified: `api/posts.js`, `api/subscribe.js`, `index.html`, `styles.css`, `script.js`.

## `vercel.json` rewrites — full array in correct order

```json
"rewrites": [
  { "source": "/api/subscribe", "destination": "/api/subscribe" },
  { "source": "/v/:slug", "destination": "/api/v/:slug" },
  { "source": "/admin", "destination": "/api/admin/page" },
  { "source": "/admin/", "destination": "/api/admin/page" },
  { "source": "/((?!api/).*)", "destination": "/index.html" }
]
```

Order rationale: the `/api/subscribe` line is kept verbatim from today (harmless, avoids touching a working path). The two new specific rewrites (`/v/:slug` and `/admin`) must precede the catch-all so they win matching. The catch-all stays last and unchanged. Vercel routes `/api/*` natively, so `/api/v/<id>` and `/api/admin/*` work without explicit rewrites.

## Edge Config schema

Single key `links` holding a JSON object — keeps reads to one SDK call and keeps the admin write atomic.

```json
{
  "links": {
    "launch":      { "videoId": "dQw4w9WgXcQ", "createdAt": 1716552000000 },
    "dQw4w9WgXcQ": { "videoId": "dQw4w9WgXcQ", "createdAt": 1716552000000 }
  }
}
```

- Top-level key name: `links` (lowercase, fixed).
- Map key = slug (the path segment that follows `/v/`).
- Map value: `{ videoId: string, createdAt: number (epoch ms) }`.
- For the default-slug case (no custom slug), the slug IS the videoId — same record gets written under the videoId key.
- Click counts are NOT stored in Edge Config for v1 (PostHog owns analytics).
- Writes always send the entire `links` object via `{ operation: "upsert", key: "links", value: <new map> }` — keeps logic trivial and avoids needing a "delete one key" path.

### Write API (confirmed against current Vercel docs, May 2026)
- Endpoint: `PATCH https://api.vercel.com/v1/edge-config/{EDGE_CONFIG_ID}/items?teamId={VERCEL_TEAM_ID}` (team-scoped — `teamId` is required)
- Auth header: `Authorization: Bearer ${VERCEL_API_TOKEN}`
- Body: `{ "items": [ { "operation": "upsert", "key": "links", "value": <new map> } ] }`
- Success response: `{ "status": "ok" }`

## Cookie format — `admin_session`

- **Name:** `admin_session`
- **Algorithm:** HMAC-SHA256 (Node `crypto.createHmac('sha256', ADMIN_COOKIE_SECRET)`)
- **Payload JSON shape:** `{ "iat": <unix-seconds>, "exp": <unix-seconds> }` (no user field — single-user system)
- **Encoded value:** `<base64url(payload-json)>.<base64url(hmac-of-payload-bytes)>` — single dot separator, two segments
- **Expiry:** 7 days. Both the `exp` claim and the `Max-Age` cookie flag are set to 604800 seconds.
- **Cookie flags:** `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
  - `HttpOnly` — not readable from JS, prevents XSS theft
  - `Secure` — HTTPS only (Vercel preview + prod are HTTPS)
  - `SameSite=Lax` — allows the cookie on top-level navigations to `/admin`, blocks it on cross-site POSTs
  - `Path=/` — usable across `/admin` and `/api/admin/*`
- **Verification flow:** decode payload → recompute HMAC over the payload bytes → constant-time compare (`crypto.timingSafeEqual`) → reject if mismatch → reject if `exp < now`.

## Redirect page — pseudocode

The serverless function `api/v/[slug].js` returns an HTML document containing the videoId and a small inline script. Server-side flow:

```
GET /api/v/<slug>:
  links = await edgeConfig.get('links')
  record = links?.[slug]
  if (!record) return 404 with minimal HTML "Link not found"
  return 200 with Content-Type: text/html, no-store cache, body = redirectPage({slug, videoId: record.videoId})
```

Client-side script inside the redirect page:

```
const ua = navigator.userAgent;
const videoId = "<server-injected>";
const slug    = "<server-injected>";

const isInstagram = /Instagram|FBAN|FBAV/.test(ua);
const isIOS       = /iPhone|iPad|iPod/.test(ua);
const isAndroid   = /Android/.test(ua);

const https   = `https://www.youtube.com/watch?v=${videoId}`;
const httpsM  = `https://m.youtube.com/watch?v=${videoId}`;
const iosApp  = `youtube://watch?v=${videoId}`;
const android = `intent://www.youtube.com/watch?v=${videoId}` +
                `#Intent;package=com.google.android.youtube;scheme=https;` +
                `S.browser_fallback_url=${encodeURIComponent(https)};end`;

function go(url, replace=true) {
  capture().finally(() => (replace ? location.replace(url) : (location.href = url)));
}

if (isInstagram || (!isIOS && !isAndroid)) {
  // Desktop, or in-app browsers that block deep links: straight to https, no 500ms delay
  go(https);
} else if (isIOS) {
  // Try the app, fall back to mobile web after 500ms if still on this page
  location.href = iosApp;
  setTimeout(() => { if (!document.hidden) location.replace(httpsM); }, 500);
  capture(); // fire-and-forget, do not block the deep-link attempt
} else if (isAndroid) {
  // Intent URL handles app-vs-fallback natively via S.browser_fallback_url
  go(android, false);
}
```

The 500ms timer is gated on `!document.hidden` — if the YouTube app launched, the page is backgrounded and the fallback won't fire.

### PostHog handling

The redirect page should **not** force-load PostHog if the wider site doesn't use it. The script does:

```
function capture() {
  if (!POSTHOG_KEY) return Promise.resolve();          // build-time skip
  if (window.posthog) {                                 // already loaded by host page
    window.posthog.capture('deep_link_clicked', { slug, videoId, platform });
    return Promise.resolve();
  }
  // Load the PostHog snippet, then capture once
  return new Promise((resolve) => {
    const s = document.createElement('script');
    // Match PostHog's own snippet exactly: assets live on the *-assets host,
    // not the ingest host. Replace `.i.posthog.com` → `-assets.i.posthog.com`,
    // then append /static/array.js. e.g. https://eu.i.posthog.com →
    // https://eu-assets.i.posthog.com/static/array.js
    s.src = POSTHOG_HOST.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js';
    s.async = true;
    s.onload = () => {
      window.posthog.init(POSTHOG_KEY, { api_host: POSTHOG_HOST, autocapture: false });
      window.posthog.capture('deep_link_clicked', { slug, videoId, platform });
      resolve();
    };
    s.onerror = () => resolve();   // never block redirect on analytics failure
    document.head.appendChild(s);
  });
}
```

`POSTHOG_KEY` and `POSTHOG_HOST` are injected server-side into the HTML at request time. PostHog is wired up in v1 (per Rob, May 2026) — both env vars must be set in Vercel for the redirect page to fire events. The `if (!POSTHOG_KEY)` guard remains as a defensive no-op for local dev where the vars may be absent. `platform` is `'ios' | 'android' | 'desktop' | 'instagram'`.

## Admin UI scope (v1)

Served from `/admin` (rewritten to `/api/admin/page`). All HTML rendered server-side from one function — keeps it a single file, no client framework.

**If no valid `admin_session` cookie:**
- Render a centred login form: single `<input type="password">` + submit button.
- Form POSTs JSON `{ password }` to `/api/admin/login`. On 200, reload `/admin`. On 401, show inline error.

**If valid `admin_session` cookie:**
- **Link list** (top section)
  - Table or simple list of `{ slug, videoId, createdAt }`, fetched by client JS from `GET /api/admin/links`.
  - Each row shows: slug, videoId, full public URL (`https://www.getmyfirstdollar.com/v/<slug>`) with a "copy" button, a YouTube preview thumbnail (`https://i.ytimg.com/vi/<videoId>/hqdefault.jpg`), and a delete button.
  - **Click counts are NOT shown in v1** — PostHog handles per-event analytics. (Investigation explicitly defers this; the schema leaves room to add a counter later if needed.)
- **Create form** (above or below the list)
  - One input: "YouTube URL or video ID" (required).
  - One optional input: "Custom slug (leave blank to use video ID)".
  - Submit → `POST /api/admin/links` with `{ youtubeUrl?, videoId?, slug? }`. Server parses any of: full `https://www.youtube.com/watch?v=ID`, `https://youtu.be/ID`, `https://www.youtube.com/shorts/ID`, or a raw 11-char ID.
  - On success: prepend new row, clear inputs.
- **Delete button per row**
  - `DELETE /api/admin/links?slug=<slug>`. Confirm via `window.confirm`. Optimistic UI: remove row, re-fetch on error.
- **Logout link** in the top-right → `POST /api/admin/logout` → reload.

Vanilla DOM only — no React, no build step (matches existing `script.js` style).

## Reserved slugs

Cannot be created via the admin UI; `POST /api/admin/links` returns 400 for any of these (case-insensitive match):

```
admin, api, v, images, favicon, robots, sitemap, manifest,
index, login, logout, page, static, public, assets,
_next, _vercel, null, undefined,
android-chrome-192x192, android-chrome-512x512,
apple-touch-icon, favicon-16x16, favicon-32x32, site
```

Validation rules for any user-supplied slug:
- `^[a-zA-Z0-9_-]{1,64}$`
- Not in the reserved list above
- Not already present in the `links` map (→ 409 Conflict)

## Acceptance criteria

- `GET /v/<known-slug>` returns 200 with an HTML page that redirects to the correct YouTube URL within 500ms on mobile, immediately on desktop.
- `GET /v/<unknown-slug>` returns 404 with a minimal HTML body.
- `GET /v/<reserved-slug>` cannot exist (creation blocked); request returns 404 if no record.
- `GET /admin` while not authed returns the login form HTML with HTTP 200.
- `POST /api/admin/login` with the correct `ADMIN_PASSWORD` returns 200 and sets an `HttpOnly; Secure; SameSite=Lax; Max-Age=604800` cookie named `admin_session`.
- `POST /api/admin/login` with a wrong password returns 401 with no cookie set.
- `GET /api/admin/links` returns `{ links: [{ slug, videoId, createdAt }, …] }` when the cookie is valid; 401 otherwise.
- `POST /api/admin/links` accepts `{ youtubeUrl }` and extracts the 11-char videoId; accepts `{ videoId }` directly; uses `{ slug }` if provided, else falls back to `videoId` as the slug; returns 409 on conflict; returns 400 on validation failure.
- `DELETE /api/admin/links?slug=<slug>` removes the slug from the `links` map and returns 200; returns 404 if the slug does not exist.
- `POST /api/admin/logout` clears the cookie (sets `Max-Age=0`) and returns 200.
- HMAC verification rejects any cookie whose signature does not match a recomputation under `ADMIN_COOKIE_SECRET`.
- HMAC verification rejects any cookie whose `exp` is in the past.
- A redirect page never loads PostHog if `POSTHOG_KEY` is unset; the redirect still happens normally.
- A redirect page never loads PostHog if `window.posthog` is already present; it reuses the existing instance.
- `api/posts.js`, `api/subscribe.js`, `index.html`, `styles.css`, `script.js` are byte-identical to their pre-feature state.
- `GET /api/posts` and `POST /api/subscribe` continue to work unchanged.
- `vercel.json` matches the rewrites block above exactly, in the order shown.

## Manual test plan — 5 scenarios

For each scenario, create one test slug `/v/test` mapping to a known video ID (e.g. `dQw4w9WgXcQ`) via the admin UI first.

1. **iOS Safari, YouTube app installed** — open `https://www.getmyfirstdollar.com/v/test`. Expected: YouTube app opens directly to the video within ~500ms; the redirect page is never visible. PostHog event `deep_link_clicked` with `platform: 'ios'` appears in dashboard within 1 minute.

2. **iOS Safari, YouTube app NOT installed** — uninstall YouTube first (or test in a fresh simulator). Open the same URL. Expected: after 500ms the page redirects to `https://m.youtube.com/watch?v=dQw4w9WgXcQ`; the page loads in Safari. PostHog event captured before redirect.

3. **Android Chrome, YouTube app installed** — open the URL on a Pixel/any Android. Expected: Chrome's intent handler opens the YouTube app immediately (no 500ms delay needed — Android's intent URL handles fallback natively). PostHog event with `platform: 'android'`.

4. **Desktop Chrome (macOS or Windows)** — open the URL. Expected: instant `location.replace` to `https://www.youtube.com/watch?v=dQw4w9WgXcQ` with no delay and no app-launch attempt. PostHog event with `platform: 'desktop'`. Back button returns to the referring page (not the redirect page) thanks to `replace`.

5. **Instagram in-app browser (iOS)** — DM yourself the link, tap it from Instagram. Expected: skips the deep-link attempt entirely (UA matches `/Instagram/`), immediately redirects to `https://www.youtube.com/watch?v=…` in the in-app browser. From there iOS YouTube's own banner lets the user open the app. PostHog event with `platform: 'instagram'`.

After all five: check Vercel Function logs for any 5xx, confirm Edge Config still shows the `test` slug, then delete it via admin and confirm `/v/test` returns 404.

## Verification (end-to-end, before declaring done)

- `vercel dev` locally, exercise: create link via admin → hit `/v/<slug>` in browser → confirm redirect → delete via admin → confirm 404. Repeat with a custom slug.
- Deploy to a Vercel preview URL, run the 5 manual test-plan scenarios.
- `curl -I https://<preview>/v/<slug>` returns 200 + `text/html`; `curl -I https://<preview>/v/nope` returns 404.
- `curl -I https://<preview>/api/posts` and `/api/subscribe` smoke-test that existing endpoints are unaffected.
- `git diff` shows zero changes to `api/posts.js`, `api/subscribe.js`, `index.html`, `styles.css`, `script.js`.
