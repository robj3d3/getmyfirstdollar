# Deep-link OG preview + Instagram in-app handoff — investigation

Two issues from real-device testing in Instagram DMs:
1. **OG preview broken** — IG's preview card shows "Redirecting…" with no thumbnail because `/v/<slug>` has no Open Graph tags.
2. **Instagram in-app browser captures the tap** — IG's WKWebView opens youtube.com inside its own browser instead of handing off to the YouTube app.

Both are fixable. The fixes are coupled (the same per-video metadata feeds both the OG preview and a tap-required interstitial), but technically independent. This doc reports findings and proposes a direction — **no code yet**.

---

## 1. Current `/v/[slug]` HTML output

`api/_lib/redirect-page.js` → `renderRedirectPage()` currently emits these tags inside `<head>`:

```html
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Redirecting…</title>
<style>…</style>
```

No `og:*`, no `twitter:*`, no `description`, no canonical, no thumbnail. The title is the generic string `Redirecting…`. `api/v/[slug].js` sets `Content-Type: text/html` and `Cache-Control: no-store` but adds no metadata of its own. Result: when `facebookexternalhit` fetches the page for an IG link-preview card, it has literally nothing rich to show, so it falls back to the title `Redirecting…` and a missing image.

The 404 path (`renderNotFoundPage`) is the same — generic `<title>Link not found</title>`, no OG tags. Not a priority but worth fixing in the same patch for consistency.

---

## 2. Crawler User-Agents

Across the major chat / social platforms, the link-preview crawler UAs are well-known and stable. For our use case (IG DM previews) only the first one is load-bearing today, but treating them uniformly is cheap and future-proof.

| Platform | User-Agent substring (case-insensitive) |
| --- | --- |
| **Instagram / Facebook / Messenger / Threads** | `facebookexternalhit/1.1`, `facebookexternalhit/1.0`, `meta-externalagent` |
| Facebook product crawler | `facebookcatalog/1.0` |
| Twitter / X | `Twitterbot` |
| LinkedIn | `LinkedInBot` |
| Slack (unfurl) | `Slackbot-LinkExpanding`, `Slackbot` |
| WhatsApp | `WhatsApp` |
| Telegram | `TelegramBot` |
| Discord | `Discordbot` |
| iMessage rich link | `facebookexternalhit` (uses the FB crawler) and Apple's `WhatsApp`-style preview agents historically — but in 2026 iMessage primarily relies on the `og:*` tags via Apple's preview service; UA is non-load-bearing for us. |

**Recommendation:** treat all of these identically — serve an "OG-only" page (no JS, no redirect, just metadata). A single regex (`/(facebookexternalhit|meta-externalagent|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|WhatsApp|TelegramBot|Discordbot)/i`) keeps the detection one line. We don't need per-crawler branching — they all want the same `og:*` tags.

The IG in-app browser UA is **different** from `facebookexternalhit` — it contains `Instagram` in a normal mobile UA string (`… Mobile/15E148 Instagram 320.0.0.10.90`). That's the path for *humans*, not crawlers. Our current client-side detection already handles it (`/Instagram|FBAN|FBAV/.test(ua)`). The crawler check needs to happen *server-side* before that.

Sources: [facebookexternalhit overview, Hall.ai](https://usehall.com/agents/facebookexternalhit), [What is facebookexternalhit?, llmpulse.ai](https://llmpulse.ai/ai-crawler-index/facebookexternalhit).

---

## 3. YouTube oEmbed API

Endpoint: `https://www.youtube.com/oembed?url=<youtube-url>&format=json`. Verified live against `dQw4w9WgXcQ` — returns:

```json
{
  "title": "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
  "author_name": "Rick Astley",
  "author_url": "https://www.youtube.com/@RickAstleyYT",
  "type": "video",
  "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  "thumbnail_width": 480,
  "thumbnail_height": 360,
  "provider_name": "YouTube",
  "provider_url": "https://www.youtube.com/",
  "html": "<iframe …></iframe>",
  "version": "1.0", "width": 200, "height": 113
}
```

Properties of the endpoint:
- **No authentication.** No API key, no quota header, no signed URL.
- **No documented rate limit** for oEmbed specifically. YouTube does aggressively rate-limit the Data API v3 (10,000 units/day) but oEmbed is a separate, public, CDN-cached service that the embed industry hits at enormous volume. Treat it as "effectively unlimited for our scale" but **always cache results** — see §4.
- **No description field.** oEmbed returns `title`, `author_name`, `thumbnail_url` — not the long-form video description. For the OG `description` field we either: (a) reuse `author_name` ("Video by Rick Astley"), (b) leave it blank, or (c) make a second call to a scraper / the Data API. I recommend (a) — keep the architecture single-call.
- **Callable from a Vercel serverless function.** Plain `fetch` works; no SDK needed.
- **Failure modes:** age-restricted / region-restricted / private videos return 401 or 404 from oEmbed. We need to handle those: store nothing, fall back to a generic OG preview, but still serve the redirect normally.
- **Thumbnail quality:** `hqdefault.jpg` is 480×360. Better options exist via direct URL construction (no API call needed): `https://i.ytimg.com/vi/<id>/maxresdefault.jpg` (1280×720, but missing for older / lower-res videos) and `https://i.ytimg.com/vi/<id>/sddefault.jpg` (640×480, always present). For OG: prefer `maxresdefault` with a `hqdefault` fallback.

---

## 4. Edge Config schema change

### Proposed shape

```json
{
  "links": {
    "launch": {
      "videoId": "dQw4w9WgXcQ",
      "createdAt": 1716552000000,
      "title": "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
      "author": "Rick Astley",
      "thumbnailUrl": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      "metadataFetchedAt": 1716552001234
    }
  }
}
```

All four new fields are optional — if they're missing or null, the redirect page degrades gracefully (no rich preview, plain redirect still works). `metadataFetchedAt` lets us re-fetch stale records later if we want.

### Fetch at create time vs every hit

**Recommendation: fetch at admin-create time, store, with a lazy refresh on miss.**

| Approach | Per-hit cost | Cold-start risk | Implementation |
| --- | --- | --- | --- |
| **Fetch at admin create (store), lazy backfill on hit if missing** ✅ | One Edge Config read. Fast. | None — `/v/<slug>` never blocks on YouTube. | Two paths: create-time fetch (sync, blocks the admin create), hit-time backfill (async fire-and-forget) for records pre-dating the schema change. |
| Fetch on every hit | One Edge Config read + one oEmbed fetch (~100–300ms) on every redirect. | Adds 100ms+ to every link-tap latency. Defeats the "instant redirect" goal. | Simple. |
| Pre-warm via cron | Predictable | Stale data if YouTube updates the title; adds infrastructure. | Overkill for a single-user system. |

The create-time path is ~50 extra lines in `api/admin/links.js`. The lazy-backfill path is ~10 extra lines in `api/v/[slug].js` — but it's a *background* write (don't await it before returning the redirect HTML).

### Failure handling

If the oEmbed call fails or times out (e.g. 5-second cap):
- **At admin create:** still store the record without metadata fields; surface a warning in the admin UI ("Link created, but YouTube metadata couldn't be fetched — preview will be generic"). Don't fail the create.
- **At hit-time backfill:** silently skip. Try again next time.

---

## 5. Server-side vs client-side UA detection

Current architecture: **everything is client-side**. The HTML body has a `<script>` that reads `navigator.userAgent` and branches. That's invisible to crawlers (no JS execution) and forces every visitor — even desktop users with great connections — to download HTML then run a script that does nothing for them.

### Proposed split

| Decision | Where it should live | Why |
| --- | --- | --- |
| "Is this a crawler?" | **Server** | Crawlers don't run JS. Must be decided before the response body is generated. |
| OG / Twitter meta tag values | **Server** | Same reason. |
| iOS / Android / desktop / Instagram detection | **Both, with server hinting** | Server can pre-pick the right anchor target on first paint (no flash). Client still validates for edge cases. |
| The actual navigation (`location.replace`, anchor tap, etc.) | **Client** | Has to run in the browser. |
| PostHog capture | **Client** | Same. |

Concretely the server-side handler in `api/v/[slug].js` becomes:

```
GET /api/v/<slug>:
  ua = req.headers['user-agent'] || ''
  if (isCrawler(ua)) {
    return renderOgOnlyPage({slug, record})   // no JS, no redirect, just <meta og:*>
  }
  if (isInstagramInApp(ua)) {
    return renderInterstitialPage({slug, record, fullUA: ua})   // OG tags + "Open in YouTube" button
  }
  return renderRedirectPage({slug, record, fullUA: ua})   // OG tags + auto-redirect JS
```

The three render functions share the OG tag block. Only the body differs.

Crawler detection regex (single line):
```js
const CRAWLER_RE = /(facebookexternalhit|meta-externalagent|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|WhatsApp|TelegramBot|Discordbot)/i;
```

---

## 6. Universal Links from Instagram WebView — 2026 state

**Confirmed: Instagram's WKWebView blocks Universal Links on JavaScript-initiated navigation.** The Linkrunner write-up ([Universal Links break in in-app browsers](https://linkrunner.io/blog/universal-links-app-links-break-in-app-browsers)) and a 2025 Medium walkthrough ([Why Deep Links Don't Open in Instagram's iOS WebView](https://medium.com/@nisthaaah/why-deep-links-dont-open-in-instagram-s-ios-webview-and-how-i-fixed-it-4d566482df7e)) both confirm:

- `location.href = "https://youtube.com/…"` from JS → stays in WebView. App handoff is suppressed.
- An `<a href="https://youtube.com/…">` that the user **taps** → also stays in WebView (Instagram intercepts top-level navigations).
- The reliable handoff: a user-tapped anchor pointing to a **custom URL scheme** (e.g. `youtube://watch?v=…` or `vnd.youtube://watch?v=…`). The custom-scheme prompt that we just removed (for normal Safari) is acceptable in the WebView context because (a) IG users *expect* a prompt to leave the app, and (b) there's no other way.

### Competitor inspection

I curled the actual redirect pages of two competitor services:

**openinyoutube.com/dQw4w9WgXcQ** — emits a Next.js SSR shell with this body markup:

```html
<button class="btn btn-danger mt-5 open-button px-4">OPEN YOUTUBE</button>
```

Their OG tags are *empty* (Next.js client-only render — they have the same OG bug we do). But the body shows their core technique: **a button the user taps**, which is the only way Instagram's WebView lets the navigation escape. The button's click handler is in a separate JS bundle I couldn't inspect, but standard practice is `window.location.href = 'youtube://watch?v=…'` on click, which fires from a user gesture and triggers the iOS app-launch confirmation (acceptable inside IG).

**openyou.tube** — I couldn't enumerate their per-video URL pattern (`/dQw4w9WgXcQ`, `/v/…`, `/?v=…` all 404). Their homepage does have rich OG tags, but I can't confirm whether their per-video pages do or how their interstitial behaves. The homepage marketing copy explicitly claims "bypass the Instagram browser" — strongly suggesting a tap-required interstitial.

**linktw.in** — I hit the `Error` page (no real short code). Their error page does emit OG tags (`og:title`, `og:description`, `og:site_name=LinkTwin`, `og:url`), which confirms the architecture pattern: SSR'd OG tags on every URL, even unknowns.

### What this means for us

For Instagram in-app traffic we need to **stop trying** to auto-redirect. Instead:
- Render a small interstitial page with the video's thumbnail + title + a single big "Open in YouTube" button.
- The button is an `<a href="vnd.youtube://watch?v=<id>" rel="noopener">` (and a fallback `youtube://watch?v=<id>` — both schemes are registered by the YouTube app, `vnd.youtube` is the documented one for Android intent compatibility).
- One tap = native iOS app-handoff prompt = YouTube app opens.
- Add a smaller "or open in browser" link below as a secondary path.

For Safari (typed URL or tapped from non-WebView) — keep the current Universal Link path. No change to that branch.

---

## 7. Backfill plan

Existing links in Edge Config (none in production yet, since this branch hasn't shipped, but the schema needs to be additive for future-safety):

**Strategy: lazy backfill on first hit.**

```
GET /api/v/<slug>:
  record = links[slug]
  if (record exists but !record.title):
    backfill = oEmbedFetch(record.videoId).then(meta => writeLinks(...))   // fire-and-forget
    // do NOT await — return the redirect with whatever metadata we have (none yet)
  render with whatever metadata we have
```

The first hit serves a degraded preview (no rich OG); the second hit and beyond serve the full preview. For the IG-DM use case the *crawler* hit is usually first (within milliseconds of paste), so we'd still miss the very first preview. To avoid that:

**Better: backfill at admin-create time only, with a one-off migration script for any links that pre-date this change.**

The migration script is trivial (`scripts/backfill-metadata.js`): read all links, for each missing `title`, hit oEmbed, accumulate writes, call `writeLinks` once with the merged map. Run locally with `node scripts/backfill-metadata.js`. Idempotent (skips records that already have a title). Rob runs it once after deploying.

For production safety: the `/v/<slug>` handler should never *block* on metadata. If the record has it, use it; if not, render a generic preview (no thumbnail, generic description) and still serve the redirect normally. No 500s, no broken pages.

---

## 8. Proposed OG tag set

For a link with `videoId = "dQw4w9WgXcQ"`, `slug = "launch"`, title `"Rick Astley - Never Gonna Give You Up"`, author `"Rick Astley"`, the rendered `<head>` would be:

```html
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rick Astley - Never Gonna Give You Up</title>
<meta name="description" content="Watch &quot;Rick Astley - Never Gonna Give You Up&quot; by Rick Astley on YouTube.">
<link rel="canonical" href="https://www.getmyfirstdollar.com/v/launch">

<!-- Open Graph -->
<meta property="og:type" content="video.other">
<meta property="og:site_name" content="My First Dollar">
<meta property="og:url" content="https://www.getmyfirstdollar.com/v/launch">
<meta property="og:title" content="Rick Astley - Never Gonna Give You Up">
<meta property="og:description" content="Watch &quot;Rick Astley - Never Gonna Give You Up&quot; by Rick Astley on YouTube.">
<meta property="og:image" content="https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="720">
<meta property="og:video" content="https://www.youtube.com/watch?v=dQw4w9WgXcQ">
<meta property="og:video:url" content="https://www.youtube.com/watch?v=dQw4w9WgXcQ">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Rick Astley - Never Gonna Give You Up">
<meta name="twitter:description" content="Watch &quot;Rick Astley - Never Gonna Give You Up&quot; by Rick Astley on YouTube.">
<meta name="twitter:image" content="https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg">
```

Notes:
- **Drop `<meta name="robots" content="noindex">`.** It was added defensively when the page had no content; with rich OG tags we can let Google index the redirect page if it wants to (low value but not harmful). Actually, keep it — search engines indexing a redirect page is noisy and serves no SEO purpose. Leave `noindex` in.
- **`og:type=video.other`** — `video.other` is the right Open Graph type for "a link to a YouTube video on someone else's domain." Don't use `video.movie` (implies long-form content with an MPAA rating) or `og:video` alone (needs more video metadata).
- **`og:image` uses `maxresdefault`** at 1280×720. If oEmbed reports the thumbnail is smaller (older videos), we fall back to `hqdefault` at 480×360. The choice is encoded server-side at create time so the field is just a static string by the time the page renders.
- **All values must be HTML-escaped** (existing `escapeHtml` helper in `redirect-page.js` handles this).
- **No `description` from YouTube** — oEmbed doesn't return it. We synthesize from title + author, which is good enough for a preview card.

---

## Recommendation summary

1. **Server-side render OG tags** based on stored metadata. Detect crawlers via UA regex and serve an OG-only page (no JS, no redirect, no interstitial).
2. **Extend the Edge Config schema** additively: `title`, `author`, `thumbnailUrl`, `metadataFetchedAt`. All optional — existing records keep working.
3. **Fetch oEmbed at admin-create time**, store the result. Provide a one-off migration script for any pre-existing links.
4. **Render an Instagram interstitial** when the UA is `Instagram/FBAN/FBAV`. Shows the thumbnail + title + a single "Open in YouTube" tap target whose `href` is `vnd.youtube://watch?v=<id>`. The user tap + custom scheme is the documented way to escape the IG WebView.
5. **Keep the Safari Universal Link path** for everything else (typed-URL iOS, Android intent, desktop). No regression there.
6. **No PostHog change.** Capture call moves into the interstitial click handler for the IG branch, stays where it is for the others.

---

## Open questions for Rob

1. **Description copy** — I've defaulted to `Watch "<title>" by <author> on YouTube.` Do you want a different formula, or your own static tagline (e.g. "My First Dollar — watch the latest episode")?
2. **Instagram interstitial copy** — Should the tap target just say "Open in YouTube", or branded ("Open in YouTube — My First Dollar")? And should there be a visible "Continue in this browser" link below it, or is the YouTube button the only call to action?
3. **Crawler-page noindex** — Should the OG-only crawler page (which is what Google might also see if it lands here) include `noindex`? My instinct is yes, since `/v/<slug>` is a redirect, not content. Confirm.
4. **Migration script triggering** — Run as `node scripts/backfill-metadata.js` from your local machine using prod env vars, or wired into the admin UI as a one-click "Backfill metadata" button? I lean toward the script (less code, runs once, easy to re-run).
5. **Stale-title refresh** — Should we ever re-fetch oEmbed for an existing link (e.g. on next admin-page load if `metadataFetchedAt` is >30 days old), or treat metadata as set-once-on-create-forever? Set-once is simpler; refresh is more accurate if Rob renames a video later.

Sources used in this investigation:
- [YouTube oEmbed live response (dQw4w9WgXcQ)](https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&format=json)
- [facebookexternalhit overview, Hall.ai](https://usehall.com/agents/facebookexternalhit)
- [What is facebookexternalhit?, llmpulse.ai](https://llmpulse.ai/ai-crawler-index/facebookexternalhit)
- [Why Universal Links break in in-app browsers, Linkrunner](https://linkrunner.io/blog/universal-links-app-links-break-in-app-browsers)
- [Why Deep Links Don't Open in Instagram's iOS WebView, Medium (2025)](https://medium.com/@nisthaaah/why-deep-links-dont-open-in-instagram-s-ios-webview-and-how-i-fixed-it-4d566482df7e)
- Direct curl of `openinyoutube.com/dQw4w9WgXcQ` and `linktw.in/sample` HTML responses (analysed above).
