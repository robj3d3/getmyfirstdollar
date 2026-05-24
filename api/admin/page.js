import { verifySession, COOKIE_NAME } from '../_lib/auth.js';
import { parseCookies } from '../_lib/cookies.js';

function loginHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Admin · login</title>
<style>
  html,body{margin:0;background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif}
  .wrap{display:flex;min-height:100vh;align-items:center;justify-content:center;padding:1rem}
  form{display:flex;flex-direction:column;gap:.75rem;width:min(100%,320px)}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  input,button{font:inherit;padding:.6rem .75rem;border-radius:.4rem;border:1px solid #333;background:#111;color:#fff}
  button{cursor:pointer;border-color:#666}
  button:hover{background:#1a1a1a}
  .err{color:#ff6b6b;font-size:.9rem;min-height:1.2em}
</style>
</head>
<body>
<div class="wrap">
  <form id="login">
    <h1>Admin</h1>
    <input type="password" name="password" placeholder="Password" autofocus required>
    <button type="submit">Sign in</button>
    <div class="err" id="err"></div>
  </form>
</div>
<script>
document.getElementById('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err');
  err.textContent = '';
  const password = e.target.password.value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.ok) { location.href = '/admin'; return; }
  const data = await res.json().catch(() => ({}));
  err.textContent = data.error || 'Login failed';
});
</script>
</body>
</html>`;
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Admin · deep links</title>
<style>
  html,body{margin:0;background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif;line-height:1.4}
  .wrap{max-width:880px;margin:0 auto;padding:1.5rem 1rem 4rem}
  header{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.5rem}
  h1{font-size:1.4rem;margin:0}
  a{color:#fff}
  button,input{font:inherit;padding:.55rem .7rem;border-radius:.4rem;border:1px solid #333;background:#111;color:#fff}
  button{cursor:pointer;border-color:#666}
  button:hover{background:#1a1a1a}
  button.danger{border-color:#a33;color:#ff8a8a}
  .create{display:grid;grid-template-columns:1fr 220px auto;gap:.5rem;margin-bottom:2rem}
  .create input{min-width:0}
  .create .submit{grid-column:1/-1;justify-self:start}
  .err{color:#ff6b6b;font-size:.9rem;min-height:1.2em;margin-bottom:1rem}
  .warn{color:#f5c542;font-size:.9rem;min-height:1.2em;margin-bottom:1rem}
  ul.links{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.75rem}
  ul.links li{display:grid;grid-template-columns:88px 1fr auto;gap:.75rem;align-items:center;padding:.6rem;border:1px solid #222;border-radius:.5rem;background:#0f0f0f}
  ul.links img{width:88px;height:50px;object-fit:cover;border-radius:.25rem;background:#222}
  .slug{font-weight:600}
  .url{font-size:.85rem;opacity:.8;word-break:break-all}
  .row-actions{display:flex;gap:.5rem;align-items:center}
  .copy{font-size:.8rem}
  @media (max-width:560px){.create{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Deep links</h1>
    <button id="logout">Log out</button>
  </header>

  <form id="create" class="create">
    <input type="text" name="youtubeUrl" placeholder="YouTube URL or 11-char video ID" required>
    <input type="text" name="slug" placeholder="Custom slug (optional)">
    <button class="submit" type="submit">Create link</button>
  </form>
  <div class="err" id="err"></div>
  <div class="warn" id="warn"></div>

  <ul class="links" id="links"><li>Loading…</li></ul>
</div>
<script>
const origin = location.origin;
const linksEl = document.getElementById('links');
const errEl = document.getElementById('err');
const warnEl = document.getElementById('warn');

function showErr(msg){ errEl.textContent = msg || ''; }
function showWarn(msg){ warnEl.textContent = msg || ''; }

function row(item){
  const url = origin + '/v/' + encodeURIComponent(item.slug);
  const thumb = 'https://i.ytimg.com/vi/' + encodeURIComponent(item.videoId) + '/hqdefault.jpg';
  const li = document.createElement('li');
  li.dataset.slug = item.slug;
  li.innerHTML = '<img src="' + thumb + '" alt=""><div><div class="slug">' + item.slug + '</div><div class="url"><a href="' + url + '" target="_blank" rel="noopener">' + url + '</a></div></div><div class="row-actions"><button class="copy" data-copy="' + url + '">Copy</button><button class="danger" data-del="' + item.slug + '">Delete</button></div>';
  return li;
}

async function load(){
  showErr('');
  const res = await fetch('/api/admin/links');
  if (res.status === 401) { location.href = '/admin'; return; }
  if (!res.ok) { showErr('Failed to load links'); return; }
  const data = await res.json();
  linksEl.innerHTML = '';
  if (!data.links.length) {
    linksEl.innerHTML = '<li>No links yet. Create one above.</li>';
    return;
  }
  for (const item of data.links) linksEl.appendChild(row(item));
}

document.getElementById('create').addEventListener('submit', async (e) => {
  e.preventDefault();
  showErr('');
  showWarn('');
  const fd = new FormData(e.target);
  const body = { youtubeUrl: fd.get('youtubeUrl'), slug: fd.get('slug') || undefined };
  const res = await fetch('/api/admin/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showErr(data.error || 'Failed to create'); return; }
  if (data.warning) showWarn(data.warning);
  e.target.reset();
  load();
});

linksEl.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.copy) {
    try { await navigator.clipboard.writeText(t.dataset.copy); t.textContent = 'Copied'; setTimeout(() => t.textContent = 'Copy', 1200); } catch {}
    return;
  }
  if (t.dataset.del) {
    if (!confirm('Delete /v/' + t.dataset.del + '?')) return;
    const res = await fetch('/api/admin/links?slug=' + encodeURIComponent(t.dataset.del), { method: 'DELETE' });
    if (!res.ok) { showErr('Delete failed'); return; }
    load();
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  location.href = '/admin';
});

load();
</script>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    console.log('[admin/page] method-not-allowed', { method: req.method });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookies = parseCookies(req);
  const authed = verifySession(process.env.ADMIN_COOKIE_SECRET, cookies[COOKIE_NAME]);

  console.log('[admin/page] render', { authed });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(authed ? dashboardHtml() : loginHtml());
}
