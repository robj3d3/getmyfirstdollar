# Deep-link OG preview + Instagram in-app handoff — implementation plan

## Context

Two issues found from real-device IG DM testing:

1. **OG preview broken** — IG's preview card shows "Redirecting…" with no thumbnail. `/v/<slug>` currently emits no Open Graph metadata; `facebookexternalhit` has nothing rich to render.
2. **Instagram WebView captures the tap** — IG's WKWebView blocks Universal Links, so tapping a `/v/<slug>` link inside IG ends up at `youtube.com` *inside the WebView* rather than handing off to the YouTube app.

Investigation findings are in `deep-link-og-fix.md`. Rob's decisions (locked):
- Description copy: `Watch "<title>" by <author> on YouTube.`
- Interstitial: primary CTA `"Open in YouTube"` (no branding); secondary `"Continue in this browser"` link below
- All crawler/redirect responses include `<meta name="robots" content="noindex">`
- Backfill via `scripts/backfill-metadata.js`, run once from local
- Metadata stored set-once-forever (no refresh logic)

**Load-bearing UX requirement for the Instagram interstitial** (added this round): the interstitial must **auto-trigger the deep link via `anchor.click()` on page load**, exploiting iOS's transient user-activation window (the user just tapped the original link, so activation is still valid for ~5 seconds). The visible button is the fallback for the small percentage of cases where the auto-click is ignored (slow paint, expired activation, WebView quirks). Most users see the interstitial flash for a fraction of a second before the YouTube app opens — they never interact with it. **No `setTimeout`** — the click must fire synchronously as soon as the anchor exists in the DOM, or the activation window can expire.

---

## Files to create

| Path | Purpose |
| --- | --- |
| `api/_lib/oembed.js` | `fetchYouTubeMetadata(videoId)` — calls `https://www.youtube.com/oembed?...`, returns `{ title, author, thumbnailUrl }` or `null` on failure. Never throws. |
| `api/_lib/ua.js` | Single source of truth for server-side UA detection. Exports `isCrawler(ua)` and `isInstagramApp(ua)`. |
| `scripts/backfill-metadata.js` | One-shot CLI that reads the `links` map, fetches oEmbed for any record missing `title`, writes back the merged map. Idempotent. |

## Files to modify

| Path | Exact change |
| --- | --- |
| `api/v/[slug].js` | Detect crawler / IG / regular path server-side via `req.headers['user-agent']`. Branch to one of three renderers. Pass the full link record (including metadata) into each renderer. |
| `api/_lib/redirect-page.js` | Add three exports: `renderCrawlerPage`, `renderInterstitialPage`, plus extended `renderRedirectPage`. All three share a single `headTags()` helper for the OG/Twitter/canonical/noindex block. `renderNotFoundPage` extended with the same noindex meta (no OG since no metadata). |
| `api/admin/links.js` | After validating a POST create, call `fetchYouTubeMetadata(videoId)` before the Edge Config write. Store whatever it returns (including null fields if it fails — the link create must not fail because oEmbed failed). The response JSON includes a `warning` field if metadata was unavailable so the admin UI can surface it. |
| `api/admin/page.js` | When the create form gets a `warning` in the response, render it inline below the form (`Link created, but YouTube metadata couldn't be fetched — preview will be generic.`). |

Files explicitly NOT modified: `index.html`, `styles.css`, `script.js`, `api/posts.js`, `api/subscribe.js`, `vercel.json` (no new routes — same `/v/:slug` and `/admin` rewrites carry this work).

---

## UA detection regexes (server-side)

Both regexes are case-insensitive and live in `api/_lib/ua.js`. They are **disjoint** — a UA cannot match both. `isCrawler` is checked first.

### Crawler regex

```js
export const CRAWLER_RE = /facebookexternalhit|meta-externalagent|facebookcatalog|Twitterbot|LinkedInBot|Slackbot(?:-LinkExpanding)?|WhatsApp|TelegramBot|Discordbot|Applebot|Pinterest|redditbot/i;

export function isCrawler(ua) {
  return !!ua && CRAWLER_RE.test(ua);
}
```

Covers: Meta (Instagram + Facebook + Messenger + Threads previews all use `facebookexternalhit`), Meta's newer `meta-externalagent`, FB catalog crawler, Twitter/X, LinkedIn, Slack unfurl, WhatsApp, Telegram, Discord, Apple's preview agent, Pinterest, Reddit. One regex, one branch.

### Instagram WebView regex

```js
export const IG_APP_RE = /Instagram|FBAN|FBAV|FBIOS|Threads/i;

export function isInstagramApp(ua) {
  return !!ua && IG_APP_RE.test(ua);
}
```

Note: the *Instagram crawler* hits us with `facebookexternalhit` (matches `CRAWLER_RE` only). The *Instagram in-app browser* hits us with a normal mobile UA that contains the literal substring `Instagram` (matches `IG_APP_RE` only). Same goes for Facebook's app — `FBAN`/`FBAV`/`FBIOS` are in the in-app browser UA, not the crawler.

### Branch order in `api/v/[slug].js`

```
if (isCrawler(ua))         -> renderCrawlerPage
else if (isInstagramApp(ua)) -> renderInterstitialPage
else                          -> renderRedirectPage   // existing iOS/Android/desktop JS branching
```

Client-side JS detection in `renderRedirectPage` stays as-is (defensive — handles the case where the server UA check somehow misclassifies). The IG branch in the client-side JS becomes effectively unreachable but I'm leaving it in place as a no-op safety net.

---

## HTML — the Instagram interstitial

Placeholders: `{{TITLE}}`, `{{AUTHOR}}`, `{{THUMB}}`, `{{VIDEO_ID}}`, `{{URL}}` (the canonical `/v/<slug>` URL), `{{POSTHOG_KEY}}`, `{{POSTHOG_HOST}}`. All escaped server-side.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{TITLE}}</title>
  <meta name="description" content="Watch &quot;{{TITLE}}&quot; by {{AUTHOR}} on YouTube.">
  <meta name="robots" content="noindex">
  <link rel="canonical" href="https://www.youtube.com/watch?v={{VIDEO_ID}}">

  <!-- Open Graph -->
  <meta property="og:type" content="video.other">
  <meta property="og:site_name" content="My First Dollar">
  <meta property="og:url" content="{{URL}}">
  <meta property="og:title" content="{{TITLE}}">
  <meta property="og:description" content="Watch &quot;{{TITLE}}&quot; by {{AUTHOR}} on YouTube.">
  <meta property="og:image" content="{{THUMB}}">
  <meta property="og:image:width" content="480">
  <meta property="og:image:height" content="360">
  <meta property="og:video" content="https://www.youtube.com/watch?v={{VIDEO_ID}}">
  <meta property="og:video:url" content="https://www.youtube.com/watch?v={{VIDEO_ID}}">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{{TITLE}}">
  <meta name="twitter:description" content="Watch &quot;{{TITLE}}&quot; by {{AUTHOR}} on YouTube.">
  <meta name="twitter:image" content="{{THUMB}}">

  <style>
    html,body{margin:0;background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif}
    .wrap{display:flex;flex-direction:column;min-height:100vh;align-items:center;justify-content:center;padding:1.5rem;text-align:center;gap:1rem}
    .thumb{width:min(100%,360px);aspect-ratio:16/9;object-fit:cover;border-radius:.5rem;background:#222}
    h1{font-size:1.1rem;line-height:1.3;margin:.5rem 0 0;max-width:360px}
    .author{font-size:.9rem;opacity:.7;margin:0}
    .cta{display:inline-block;margin-top:1rem;padding:.85rem 1.4rem;background:#ff0000;color:#fff;text-decoration:none;border-radius:.4rem;font-weight:600;min-width:220px}
    .secondary{font-size:.85rem;opacity:.7;color:#fff;text-decoration:underline}
  </style>
</head>
<body>
  <div class="wrap">
    <img class="thumb" src="{{THUMB}}" alt="">
    <h1>{{TITLE}}</h1>
    <p class="author">{{AUTHOR}}</p>

    <a class="cta" id="cta" href="vnd.youtube://watch?v={{VIDEO_ID}}" rel="noopener">Open in YouTube</a>
    <!-- INLINE SCRIPT IMMEDIATELY AFTER THE ANCHOR — synchronous click while parser
         hasn't finished, so user activation from the original tap is still valid.
         No setTimeout, no DOMContentLoaded. -->
    <script>
      (function(){
        try {
          var el = document.getElementById('cta');
          if (el) el.click();
        } catch(e) {}
      })();
    </script>

    <a class="secondary" href="https://www.youtube.com/watch?v={{VIDEO_ID}}">Continue in this browser</a>
  </div>

  <!-- PostHog capture runs AFTER the auto-click so it can never block the navigation
       attempt. Same lazy-load pattern as the redirect page. Fire-and-forget. -->
  <script>
    (function(){
      var POSTHOG_KEY={{POSTHOG_KEY_JS}}, POSTHOG_HOST={{POSTHOG_HOST_JS}};
      var SLUG={{SLUG_JS}}, VIDEO_ID={{VIDEO_ID_JS}};
      if(!POSTHOG_KEY||!POSTHOG_HOST) return;
      function fire(){ try{ window.posthog && window.posthog.capture('deep_link_clicked',{slug:SLUG,videoId:VIDEO_ID,platform:'instagram'}); }catch(e){} }
      if(window.posthog){ fire(); return; }
      var s=document.createElement('script');
      s.src=POSTHOG_HOST.replace('.i.posthog.com','-assets.i.posthog.com')+'/static/array.js';
      s.async=true;
      s.onload=function(){ try{ window.posthog.init(POSTHOG_KEY,{api_host:POSTHOG_HOST,autocapture:false}); fire(); }catch(e){} };
      s.onerror=function(){};
      document.head.appendChild(s);
    })();

    // Secondary tap handler: also capture, then let the browser follow the link normally.
    var sec = document.querySelector('.secondary');
    if (sec) sec.addEventListener('click', function(){
      try { window.posthog && window.posthog.capture('deep_link_clicked',{slug:{{SLUG_JS}},videoId:{{VIDEO_ID_JS}},platform:'instagram_browser_fallback'}); } catch(e) {}
    });
  </script>
</body>
</html>
```

### Why the inline `<script>` is positioned immediately after the anchor (not in `<head>`, not DOMContentLoaded)

- The HTML parser inserts the `<a id="cta">` element into the DOM as soon as it sees the closing `>`. The next sibling script runs synchronously *during* parsing, with the anchor already addressable.
- `setTimeout(..., 0)` defers to the next event-loop tick, which is *after* the current task ends — by then iOS may have decided the user activation has expired.
- `DOMContentLoaded` fires even later. Same problem, worse.
- `anchor.click()` on a custom-scheme URL inside a still-valid activation window is treated by iOS as a user-initiated navigation, which is the only kind that escapes the IG WebView.

This is the technique LinkTwin uses (Rob recalled seeing the flash; same mechanism).

### Fallback semantics for the visible button

If the auto-click is ignored (rare — usually only when the IG WebView throttles the page, the user backgrounded the WebView mid-load, or activation expired due to a slow paint), the user sees the rendered interstitial and taps "Open in YouTube" themselves. That tap is a fresh user activation and the same anchor fires the same `vnd.youtube://` URL. Either path → same destination.

The secondary "Continue in this browser" link is a plain `https://www.youtube.com/watch?v=…` anchor — for users without YouTube installed or who explicitly prefer the browser.

---

## HTML — the crawler-only page

No JS, no interstitial, no body styling. Just OG tags and a minimal visible body so a human who somehow lands on this page (e.g. by setting their own UA to `facebookexternalhit` for testing) has somewhere to click.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{TITLE}}</title>
  <meta name="description" content="Watch &quot;{{TITLE}}&quot; by {{AUTHOR}} on YouTube.">
  <meta name="robots" content="noindex">
  <link rel="canonical" href="https://www.youtube.com/watch?v={{VIDEO_ID}}">

  <!-- Open Graph -->
  <meta property="og:type" content="video.other">
  <meta property="og:site_name" content="My First Dollar">
  <meta property="og:url" content="{{URL}}">
  <meta property="og:title" content="{{TITLE}}">
  <meta property="og:description" content="Watch &quot;{{TITLE}}&quot; by {{AUTHOR}} on YouTube.">
  <meta property="og:image" content="{{THUMB}}">
  <meta property="og:image:width" content="480">
  <meta property="og:image:height" content="360">
  <meta property="og:video" content="https://www.youtube.com/watch?v={{VIDEO_ID}}">
  <meta property="og:video:url" content="https://www.youtube.com/watch?v={{VIDEO_ID}}">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{{TITLE}}">
  <meta name="twitter:description" content="Watch &quot;{{TITLE}}&quot; by {{AUTHOR}} on YouTube.">
  <meta name="twitter:image" content="{{THUMB}}">
</head>
<body>
  <p>Watch on <a href="https://www.youtube.com/watch?v={{VIDEO_ID}}">YouTube</a>.</p>
</body>
</html>
```

### Degraded case (metadata unavailable)

If a link was created before this change (or oEmbed failed at create time and was never backfilled), `title`/`author`/`thumbnailUrl` are null. Crawler page falls back to:
- `<title>` = `Watch on YouTube`
- `og:title` = `Watch on YouTube`
- `og:description` = `View this video on YouTube.`
- `og:image` = `https://i.ytimg.com/vi/{{VIDEO_ID}}/hqdefault.jpg` (constructed from the videoId — always exists for any valid videoId without an API call)

So even a metadata-less link gets a half-decent preview card with a thumbnail. The backfill script closes the gap properly.

---

## YouTube oEmbed fetch contract

Module: `api/_lib/oembed.js`.

```js
export async function fetchYouTubeMetadata(videoId) { … }
```

### Endpoint

```
GET https://www.youtube.com/oembed?url=<urlEnc>&format=json
```

Where `<urlEnc>` = `encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)`.

No auth header. No API key. Plain `fetch` from a Vercel serverless function.

### Request shape

```js
fetch(oembedUrl, {
  method: 'GET',
  signal: AbortSignal.timeout(5000),    // 5 second timeout, fail fast
  headers: { 'User-Agent': 'getmyfirstdollar.com/1.0' },
});
```

### Success response (200) — stored fields

YouTube returns ~12 keys. We store **only these three** in Edge Config:

| Field stored | Source |
| --- | --- |
| `title` | response `.title` (string, may be 100+ chars — store verbatim, do not truncate) |
| `author` | response `.author_name` |
| `thumbnailUrl` | response `.thumbnail_url` (always `hqdefault.jpg` at 480×360 — guaranteed to exist for every video) |

Also recorded: `metadataFetchedAt: Date.now()` for future reference / debugging.

We do **not** store: `author_url`, `html`, `width`, `height`, `provider_*`, `type`, `version`, `thumbnail_width`, `thumbnail_height`. They're not used in any render path.

### Failure modes — never throw, never fail the caller

| Failure | Helper behaviour |
| --- | --- |
| Network error / DNS fail | `console.log` warning, return `null` |
| Timeout (5s) | `console.log` warning, return `null` |
| 401 / 403 / 404 (age-restricted, private, region-blocked, deleted video) | `console.log` warning, return `null` |
| 5xx from YouTube | `console.log` warning, return `null` |
| Body is not JSON | `console.log` warning, return `null` |
| Missing expected fields | `console.log` warning, return `null` |

```js
// pseudocode
export async function fetchYouTubeMetadata(videoId) {
  try {
    const res = await fetch(url, { /* … */ });
    if (!res.ok) { console.log('[oembed] non-ok', { videoId, status: res.status }); return null; }
    const json = await res.json();
    if (!json?.title) { console.log('[oembed] missing-title', { videoId }); return null; }
    return { title: json.title, author: json.author_name || '', thumbnailUrl: json.thumbnail_url || null };
  } catch (err) {
    console.log('[oembed] error', { videoId, message: err?.message });
    return null;
  }
}
```

### Caller behaviour in `api/admin/links.js`

```
POST /api/admin/links flow:
  videoId   = parseYouTubeInput(body.youtubeUrl || body.videoId)
  if (!videoId) -> 400
  slug = body.slug || videoId
  if (reserved or invalid or conflict) -> 4xx
  metadata = await fetchYouTubeMetadata(videoId)         // may be null
  newRecord = {
    videoId, createdAt: Date.now(),
    title: metadata?.title ?? null,
    author: metadata?.author ?? null,
    thumbnailUrl: metadata?.thumbnailUrl ?? null,
    metadataFetchedAt: metadata ? Date.now() : null,
  }
  await writeLinks({ ...links, [slug]: newRecord })
  return 200 {
    slug, videoId, createdAt,
    title, author, thumbnailUrl,
    warning: metadata ? undefined : 'YouTube metadata could not be fetched — preview will be generic.',
  }
```

If oEmbed fails the link is still created; the admin UI shows the warning string under the form.

---

## Edge Config schema — additive delta

**Before** (still works after this change — see "degraded case" above):

```json
{ "links": { "<slug>": { "videoId": "string", "createdAt": number } } }
```

**After:**

```json
{
  "links": {
    "<slug>": {
      "videoId": "string",
      "createdAt": number,
      "title": "string | null",
      "author": "string | null",
      "thumbnailUrl": "string | null",
      "metadataFetchedAt": "number | null"
    }
  }
}
```

The four new fields are **all optional**. Render functions tolerate `null` / missing (degraded case above). No migration required for the schema itself; only the *values* need backfilling for older records.

Storage helpers (`api/_lib/edge.js`) need **no change** — they treat the value as an opaque object.

---

## Backfill script contract — `scripts/backfill-metadata.js`

### Purpose

One-shot CLI that fills in `title` / `author` / `thumbnailUrl` / `metadataFetchedAt` for any link record that's missing `title`. Run once after deploy; idempotent on re-run.

### How to run

```bash
cd ~/Documents/Code/getmyfirstdollar
# Pull prod env vars first (or set them inline)
vercel env pull .env.local   # one-time
node scripts/backfill-metadata.js
```

Required env vars (already documented in `README.md`): `EDGE_CONFIG`, `EDGE_CONFIG_ID`, `VERCEL_API_TOKEN`, `VERCEL_TEAM_ID`. The script loads `.env.local` via Node's built-in `--env-file=` flag — instruct Rob to run `node --env-file=.env.local scripts/backfill-metadata.js` (Node 20.6+).

### Read

Uses `getLinks()` from `api/_lib/edge.js`. Returns the full `{ slug → record }` map.

### Iteration & fetch

```
for each [slug, record] in links:
  if record.title:                   # already filled
    print "SKIP  <slug> (already has metadata)"
    continue
  meta = await fetchYouTubeMetadata(record.videoId)
  if meta:
    next[slug] = { ...record, ...meta, metadataFetchedAt: Date.now() }
    print "OK    <slug> -> '<title>'"
    updated++
  else:
    print "FAIL  <slug> (videoId=<id>) — oEmbed unavailable"
    failed++
```

The script does **not** rewrite records it couldn't fetch. They stay as-is and remain candidates for the next run.

### Write

Single atomic `writeLinks(next)` at the end — only if at least one record was updated. The whole map is upserted in one PATCH (matches the existing helper semantics).

### Idempotence guarantees

- Records that already have `title` are skipped on every subsequent run.
- A second run after a successful first run does zero writes (everything is `SKIP`).
- A run that fully fails (every link's oEmbed call returns null) does zero writes.
- The script never deletes anything, never modifies `videoId` or `createdAt`, only fills the four new fields.

### Output / exit codes

- Prints one line per record (`OK` / `SKIP` / `FAIL`).
- Final summary: `<updated> updated, <skipped> skipped, <failed> failed`.
- Exit 0 on normal completion (including all-failed-oEmbed — that's not a script bug).
- Exit 1 only on fatal env-config errors or Edge Config write failure.

---

## Updated acceptance criteria

All criteria from `deep-link-d-plan.md` still hold. Additionally:

### Crawler / OG preview
- `GET /v/<known-slug>` with `User-Agent: facebookexternalhit/1.1` returns 200 HTML containing **all** of: `og:type=video.other`, `og:title`, `og:description`, `og:image`, `og:url`, `og:video`, `twitter:card=summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image`, `<meta name="robots" content="noindex">`, `<link rel="canonical" href="https://www.youtube.com/watch?v=…">`.
- The crawler-served HTML contains **no `<script>` tag** for redirect/interstitial logic (verifiable with `curl -A 'facebookexternalhit/1.1' /v/<slug> | grep -c '<script'` → `0`).
- For a metadata-less link (e.g. legacy record), the crawler page still renders with `og:title="Watch on YouTube"`, `og:image=https://i.ytimg.com/vi/<videoId>/hqdefault.jpg`, and the noindex meta.
- The same crawler-page logic fires for `Twitterbot`, `LinkedInBot`, `Slackbot`, `WhatsApp`, `TelegramBot`, `Discordbot` UAs.

### Instagram WebView interstitial
- `GET /v/<known-slug>` with an Instagram in-app UA (e.g. `… Instagram 320.0.0.10.90`) returns the interstitial HTML.
- The interstitial includes a thumbnail `<img>`, the video title `<h1>`, the author, an `<a id="cta" href="vnd.youtube://watch?v=…">Open in YouTube</a>` primary button, and an `<a class="secondary" href="https://www.youtube.com/watch?v=…">Continue in this browser</a>` fallback.
- An inline `<script>` placed **immediately after** the CTA anchor calls `document.getElementById('cta').click()` **synchronously** (no `setTimeout`, no `DOMContentLoaded`).
- On a real iOS device opened from an Instagram DM tap: the YouTube app opens via the iOS "Open in YouTube?" prompt within ~1 second of the original tap, with the interstitial visible for a brief flash only.
- When YouTube is not installed: the user sees the interstitial fully rendered and can tap "Continue in this browser" to reach `youtube.com`.
- PostHog event `deep_link_clicked` with `platform: 'instagram'` fires (auto-click path). Tapping the secondary fallback fires `platform: 'instagram_browser_fallback'`.

### Admin create flow + oEmbed
- `POST /api/admin/links` with a valid `youtubeUrl` calls `fetchYouTubeMetadata(videoId)` before writing to Edge Config.
- On oEmbed success: the stored record contains `title`, `author`, `thumbnailUrl`, and `metadataFetchedAt`. The response JSON omits any `warning` field.
- On oEmbed failure (timeout, 4xx, 5xx, malformed JSON): the link is **still created** with `title: null`, `author: null`, `thumbnailUrl: null`, `metadataFetchedAt: null`. The response JSON includes `warning: "YouTube metadata could not be fetched — preview will be generic."`. HTTP status is still 200.
- The admin dashboard renders the warning text under the create form when present.

### Backfill script
- `node --env-file=.env.local scripts/backfill-metadata.js` reads all links, fetches oEmbed for records missing `title`, writes the merged map exactly once at the end (only if anything was updated).
- Running the script a second time immediately after a successful first run prints `SKIP` for every record and performs zero writes.
- Running the script against an empty Edge Config (`links` is `{}`) exits 0 with `0 updated, 0 skipped, 0 failed`.

### Regression
- All existing acceptance criteria from `deep-link-d-plan.md` continue to hold (admin auth, slug validation, reserved slugs, 404 for unknown slugs, no modification to `index.html` / `styles.css` / `script.js` / `api/posts.js` / `api/subscribe.js`, etc.).
- `vercel.json` is byte-identical (no new rewrites needed).

---

## Updated manual test plan — 6 scenarios

Before running: create a fresh test link via admin (`/v/test` → `https://youtu.be/dQw4w9WgXcQ`). Verify the create response includes `title`, `author`, `thumbnailUrl` (no `warning`). If it shows a warning, oEmbed failed — investigate before continuing.

1. **IG DM preview card shows YouTube thumbnail + title.** Paste `https://www.getmyfirstdollar.com/v/test` into an Instagram DM (do not send yet — wait for the preview). Expected: preview card renders with the YouTube video thumbnail, the video title as the headline, "getmyfirstdollar.com" as the domain label. Compare side-by-side with a LinkTwin link to the same video — should look equivalent.

2. **Tapping link from IG DM opens YouTube app.** Send the DM to yourself, open Instagram, tap the link. Expected: the interstitial flashes briefly (≤ 1 second), iOS shows "Open this page in YouTube?" prompt, tap Open → YouTube app loads the video. **No `youtube.com` page rendered inside the IG WebView.**

3. **Tapping link from Safari opens YouTube app silently (no prompt).** Open Safari, tap a `/v/test` link from Notes or Messages. Expected: Universal Link triggers, YouTube app opens directly, **no "Open in YouTube?" prompt** (Universal Links are silent outside in-app browsers). If YouTube is uninstalled: redirects to `youtube.com` in Safari.

4. **Desktop redirects immediately.** Open `/v/test` in desktop Chrome. Expected: instant `location.replace` to `https://www.youtube.com/watch?v=dQw4w9WgXcQ`. Browser back button returns to the page that linked here (not the redirect page itself).

5. **Facebook share preview.** Open Facebook (web or app), start composing a status, paste the URL. Expected: Facebook's `facebookexternalhit/1.1` fetches the page and shows the rich preview card with thumbnail + title within ~3 seconds. Optional: paste into Facebook's Sharing Debugger (`developers.facebook.com/tools/debug/`) and confirm all `og:*` tags resolve. **No publish required** to verify.

6. **Crawler-only page has noindex.** From any terminal:
   ```bash
   curl -s -A 'facebookexternalhit/1.1' https://www.getmyfirstdollar.com/v/test \
     | grep -E '<meta name="robots"|<script'
   ```
   Expected output: exactly one line containing `<meta name="robots" content="noindex">` and **zero** `<script>` matches. Sanity-check `og:image` URL by opening it in a browser — should load the YouTube thumbnail.

### Regression spot-checks (also run)

- `curl -I https://<preview>/api/posts` returns 200 (existing Beehiiv route unaffected).
- `/admin` login + create + delete flow still works end-to-end.
- `git diff main..HEAD -- index.html styles.css script.js api/posts.js api/subscribe.js vercel.json` shows zero changes.

---

## Verification (before merge)

- Run `node scripts/test-url-parser.js` — must still pass 19/19.
- `vercel dev` locally: create a test link, hit `/v/<slug>` from `curl -A 'facebookexternalhit/1.1'` and confirm OG tags. Spoof a fake Instagram UA via `curl -A 'Mozilla/5.0 (iPhone …) Instagram 320.0.0.10.90'` and confirm the interstitial body and auto-click script render.
- Push the branch, get a preview URL, run all 6 manual scenarios on a real iPhone.
- Confirm Vercel Function logs show the expected `console.log` lines: `[v/slug] crawler`, `[v/slug] instagram`, `[v/slug] hit`, `[oembed] non-ok` (if applicable), `[admin/links] create-ok` (with title), etc.

---

## Risks and edge cases

- **YouTube oEmbed downtime** at the moment of admin create → link created without metadata, warning shown, backfill script can fill it later. No code path fails.
- **Age-restricted / private videos** → oEmbed returns 401/403 → same null-metadata path. Acceptable; rare for our use case.
- **iOS user activation expires before auto-click** → fallback button is visible, user taps manually. Single extra tap, no broken state.
- **Instagram blocks `vnd.youtube://` in the future** → we'd need a real Universal-Link-into-IG-app pathway (not currently possible). The "Continue in this browser" secondary link is the safety net.
- **Crawler UA spoofing** → harmless; spoofed crawler request gets the OG-only page instead of a redirect. No data leak.
- **`vnd.youtube://` not registered on a device** → iOS shows "Cannot Open Page" alert. The visible fallback link mitigates. (Tested in research; YouTube app registers this scheme on both iOS and Android.)
