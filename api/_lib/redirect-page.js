const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeInput(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (VIDEO_ID_RE.test(trimmed)) return trimmed;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\/+/, '').split('/')[0];
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (url.pathname === '/watch') {
      const v = url.searchParams.get('v');
      return v && VIDEO_ID_RE.test(v) ? v : null;
    }
    const m = url.pathname.match(/^\/(shorts|live|embed|v)\/([^/?#]+)/);
    if (m) {
      const id = m[2];
      return VIDEO_ID_RE.test(id) ? id : null;
    }
  }

  return null;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const RE_LS = new RegExp('\\u2028', 'g');
const RE_PS = new RegExp('\\u2029', 'g');

function jsString(s) {
  let out = JSON.stringify(String(s ?? ''));
  out = out.replace(/</g, '\\u003c');
  out = out.replace(/>/g, '\\u003e');
  out = out.replace(/&/g, '\\u0026');
  out = out.replace(RE_LS, '\\u2028');
  out = out.replace(RE_PS, '\\u2029');
  return out;
}

function metadataWithFallback({ videoId, title, author, thumbnailUrl }) {
  const fallbackThumb = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  const t = title && String(title).trim() ? String(title) : 'Watch on YouTube';
  const a = author && String(author).trim() ? String(author) : '';
  const thumb = thumbnailUrl && String(thumbnailUrl).trim() ? String(thumbnailUrl) : fallbackThumb;
  const description = title && a
    ? `Watch "${t}" by ${a} on YouTube.`
    : 'View this video on YouTube.';
  return { title: t, author: a, thumbnailUrl: thumb, description };
}

function headTags({ pageUrl, videoId, title, description, thumbnailUrl }) {
  const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${escapeHtml(ytUrl)}">
<meta property="og:type" content="video.other">
<meta property="og:site_name" content="My First Dollar">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(thumbnailUrl)}">
<meta property="og:image:width" content="480">
<meta property="og:image:height" content="360">
<meta property="og:video" content="${escapeHtml(ytUrl)}">
<meta property="og:video:url" content="${escapeHtml(ytUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(thumbnailUrl)}">`;
}

export function renderCrawlerPage({ slug, videoId, title, author, thumbnailUrl, pageUrl }) {
  const meta = metadataWithFallback({ videoId, title, author, thumbnailUrl });
  const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  return `<!doctype html>
<html lang="en">
<head>
${headTags({ pageUrl, videoId, title: meta.title, description: meta.description, thumbnailUrl: meta.thumbnailUrl })}
</head>
<body>
<p>Watch on <a href="${escapeHtml(ytUrl)}">YouTube</a>.</p>
</body>
</html>`;
}

export function renderInterstitialPage({ slug, videoId, title, author, thumbnailUrl, pageUrl, posthogKey, posthogHost }) {
  const meta = metadataWithFallback({ videoId, title, author, thumbnailUrl });
  const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const appUrl = `vnd.youtube://watch?v=${encodeURIComponent(videoId)}`;
  const SLUG = jsString(slug);
  const VIDEO = jsString(videoId);
  const KEY = jsString(posthogKey || '');
  const HOST = jsString(posthogHost || '');

  return `<!doctype html>
<html lang="en">
<head>
${headTags({ pageUrl, videoId, title: meta.title, description: meta.description, thumbnailUrl: meta.thumbnailUrl })}
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
<img class="thumb" src="${escapeHtml(meta.thumbnailUrl)}" alt="">
<h1>${escapeHtml(meta.title)}</h1>
${meta.author ? `<p class="author">${escapeHtml(meta.author)}</p>` : ''}
<a class="cta" id="cta" href="${escapeHtml(appUrl)}" rel="noopener">Open in YouTube</a>
<script>
(function(){
  try {
    var el = document.getElementById('cta');
    if (el) el.click();
  } catch(e) {}
})();
</script>
<a class="secondary" id="fallback" href="${escapeHtml(ytUrl)}">Continue in this browser</a>
</div>
<script>
(function(){
  var SLUG=${SLUG},VIDEO_ID=${VIDEO},POSTHOG_KEY=${KEY},POSTHOG_HOST=${HOST};
  function fire(platform){
    try{ window.posthog && window.posthog.capture("deep_link_clicked",{slug:SLUG,videoId:VIDEO_ID,platform:platform}); }catch(e){}
  }
  function load(then){
    if(!POSTHOG_KEY||!POSTHOG_HOST) return;
    if(window.posthog){ then(); return; }
    var s=document.createElement("script");
    s.src=POSTHOG_HOST.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js";
    s.async=true;
    s.onload=function(){ try{ window.posthog.init(POSTHOG_KEY,{api_host:POSTHOG_HOST,autocapture:false}); then(); }catch(e){} };
    s.onerror=function(){};
    document.head.appendChild(s);
  }
  load(function(){ fire("instagram"); });
  var sec=document.getElementById("fallback");
  if(sec) sec.addEventListener("click",function(){ load(function(){ fire("instagram_browser_fallback"); }); });
})();
</script>
</body>
</html>`;
}

export function renderRedirectPage({ slug, videoId, title, author, thumbnailUrl, pageUrl, posthogKey, posthogHost }) {
  const meta = metadataWithFallback({ videoId, title, author, thumbnailUrl });
  const SLUG = jsString(slug);
  const VIDEO = jsString(videoId);
  const KEY = jsString(posthogKey || '');
  const HOST = jsString(posthogHost || '');
  const noscriptHref = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

  return `<!doctype html>
<html lang="en">
<head>
${headTags({ pageUrl, videoId, title: meta.title, description: meta.description, thumbnailUrl: meta.thumbnailUrl })}
<style>html,body{margin:0;background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif}.wrap{display:flex;min-height:100vh;align-items:center;justify-content:center;padding:1rem;text-align:center}a{color:#fff}</style>
</head>
<body>
<div class="wrap"><p>Opening YouTube… <a id="fallback" href="${escapeHtml(noscriptHref)}">Tap here if nothing happens</a>.</p></div>
<noscript><meta http-equiv="refresh" content="0;url=${escapeHtml(noscriptHref)}"></noscript>
<script>
(function(){
  var SLUG=${SLUG},VIDEO_ID=${VIDEO},POSTHOG_KEY=${KEY},POSTHOG_HOST=${HOST};
  var ua=navigator.userAgent||"";
  var isInstagram=/Instagram|FBAN|FBAV/.test(ua);
  var isIOS=/iPhone|iPad|iPod/.test(ua);
  var isAndroid=/Android/.test(ua);
  var platform=isInstagram?"instagram":(isIOS?"ios":(isAndroid?"android":"desktop"));
  var https="https://www.youtube.com/watch?v="+encodeURIComponent(VIDEO_ID);
  var android="intent://www.youtube.com/watch?v="+encodeURIComponent(VIDEO_ID)+
              "#Intent;package=com.google.android.youtube;scheme=https;"+
              "S.browser_fallback_url="+encodeURIComponent(https)+";end";

  function capture(){
    if(!POSTHOG_KEY||!POSTHOG_HOST) return Promise.resolve();
    if(window.posthog){
      try{ window.posthog.capture("deep_link_clicked",{slug:SLUG,videoId:VIDEO_ID,platform:platform}); }catch(e){}
      return Promise.resolve();
    }
    return new Promise(function(resolve){
      var s=document.createElement("script");
      s.src=POSTHOG_HOST.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js";
      s.async=true;
      s.onload=function(){
        try{
          window.posthog.init(POSTHOG_KEY,{api_host:POSTHOG_HOST,autocapture:false});
          window.posthog.capture("deep_link_clicked",{slug:SLUG,videoId:VIDEO_ID,platform:platform});
        }catch(e){}
        resolve();
      };
      s.onerror=function(){resolve();};
      document.head.appendChild(s);
    });
  }

  function go(url,replace){
    capture().finally(function(){ replace?location.replace(url):(location.href=url); });
  }

  if(isInstagram||(!isIOS&&!isAndroid)){
    go(https,true);
  } else if(isIOS){
    // Universal Link: iOS opens the YouTube app silently when installed and
    // falls back to web automatically when it isn't. No "Open in YouTube?"
    // prompt, no 500ms timer needed.
    go(https,true);
  } else if(isAndroid){
    go(android,false);
  }
})();
</script>
</body>
</html>`;
}

export function renderNotFoundPage(slug) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Link not found</title>
<style>html,body{margin:0;background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif}.wrap{display:flex;min-height:100vh;align-items:center;justify-content:center;padding:1rem;text-align:center}a{color:#fff}</style>
</head>
<body>
<div class="wrap"><p>No link found for <code>${escapeHtml(slug || '')}</code>. <br><a href="/">Back to getmyfirstdollar.com</a></p></div>
</body>
</html>`;
}
