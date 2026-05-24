import { verifySession, COOKIE_NAME } from '../_lib/auth.js';
import { parseCookies } from '../_lib/cookies.js';
import { getLinks, writeLinks } from '../_lib/edge.js';
import { parseYouTubeInput } from '../_lib/redirect-page.js';

const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

const RESERVED = new Set([
  'admin', 'api', 'v', 'images', 'favicon', 'robots', 'sitemap', 'manifest',
  'index', 'login', 'logout', 'page', 'static', 'public', 'assets',
  '_next', '_vercel', 'null', 'undefined',
  'android-chrome-192x192', 'android-chrome-512x512',
  'apple-touch-icon', 'favicon-16x16', 'favicon-32x32', 'site',
]);

function isAuthed(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  return verifySession(process.env.ADMIN_COOKIE_SECRET, token);
}

function toRows(linksMap) {
  return Object.entries(linksMap)
    .map(([slug, rec]) => ({ slug, videoId: rec?.videoId, createdAt: rec?.createdAt }))
    .filter((r) => r.videoId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export default async function handler(req, res) {
  if (!isAuthed(req)) {
    console.log('[admin/links] auth-fail', { method: req.method });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  console.log('[admin/links] auth-pass', { method: req.method });

  if (req.method === 'GET') {
    try {
      const links = await getLinks();
      console.log('[admin/links] list', { count: Object.keys(links).length });
      return res.status(200).json({ links: toRows(links) });
    } catch (err) {
      console.log('[admin/links] list-error', { message: err?.message });
      return res.status(500).json({ error: 'Something went wrong' });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const youtubeInput = body.youtubeUrl || body.videoId;
    const videoId = parseYouTubeInput(youtubeInput);
    if (!videoId) {
      console.log('[admin/links] create-invalid-video', { youtubeInput });
      return res.status(400).json({ error: 'Could not parse a YouTube video ID' });
    }

    let slug = (body.slug || '').trim();
    if (!slug) slug = videoId;

    if (!SLUG_RE.test(slug)) {
      console.log('[admin/links] create-invalid-slug', { slug });
      return res.status(400).json({ error: 'Slug must be 1-64 chars, [A-Za-z0-9_-]' });
    }
    if (RESERVED.has(slug.toLowerCase())) {
      console.log('[admin/links] create-reserved-slug', { slug });
      return res.status(400).json({ error: 'Slug is reserved' });
    }

    let links;
    try {
      links = await getLinks();
    } catch (err) {
      console.log('[admin/links] create-read-error', { message: err?.message });
      return res.status(500).json({ error: 'Something went wrong' });
    }

    if (links[slug]) {
      console.log('[admin/links] create-conflict', { slug });
      return res.status(409).json({ error: 'Slug already exists' });
    }

    const next = { ...links, [slug]: { videoId, createdAt: Date.now() } };

    try {
      await writeLinks(next);
    } catch (err) {
      console.log('[admin/links] create-write-error', { slug, message: err?.message });
      return res.status(500).json({ error: 'Something went wrong' });
    }

    console.log('[admin/links] create-ok', { slug, videoId });
    return res.status(200).json({ slug, videoId, createdAt: next[slug].createdAt });
  }

  if (req.method === 'DELETE') {
    const slug = (req.query?.slug || '').trim();
    if (!slug) {
      console.log('[admin/links] delete-missing-slug');
      return res.status(400).json({ error: 'slug query param required' });
    }

    let links;
    try {
      links = await getLinks();
    } catch (err) {
      console.log('[admin/links] delete-read-error', { message: err?.message });
      return res.status(500).json({ error: 'Something went wrong' });
    }

    if (!links[slug]) {
      console.log('[admin/links] delete-miss', { slug });
      return res.status(404).json({ error: 'Not found' });
    }

    const next = { ...links };
    delete next[slug];

    try {
      await writeLinks(next);
    } catch (err) {
      console.log('[admin/links] delete-write-error', { slug, message: err?.message });
      return res.status(500).json({ error: 'Something went wrong' });
    }

    console.log('[admin/links] delete-ok', { slug });
    return res.status(200).json({ success: true });
  }

  console.log('[admin/links] method-not-allowed', { method: req.method });
  return res.status(405).json({ error: 'Method not allowed' });
}
