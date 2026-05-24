import { getLinks } from '../_lib/edge.js';
import { renderRedirectPage, renderNotFoundPage } from '../_lib/redirect-page.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    console.log('[v/slug] method-not-allowed', { method: req.method });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const slug = String(req.query?.slug || '').trim();
  if (!slug) {
    console.log('[v/slug] missing-slug');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).send(renderNotFoundPage(''));
  }

  let links;
  try {
    links = await getLinks();
  } catch (err) {
    console.log('[v/slug] edge-config-error', { slug, message: err?.message });
    return res.status(500).json({ error: 'Something went wrong' });
  }

  const record = links?.[slug];
  if (!record || !record.videoId) {
    console.log('[v/slug] miss', { slug });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).send(renderNotFoundPage(slug));
  }

  console.log('[v/slug] hit', { slug, videoId: record.videoId });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(renderRedirectPage({
    slug,
    videoId: record.videoId,
    posthogKey: process.env.POSTHOG_KEY,
    posthogHost: process.env.POSTHOG_HOST,
  }));
}
