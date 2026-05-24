import { getLinks } from '../_lib/edge.js';
import {
  renderRedirectPage,
  renderInterstitialPage,
  renderCrawlerPage,
  renderNotFoundPage,
} from '../_lib/redirect-page.js';
import { isCrawler, isInstagramApp } from '../_lib/ua.js';

function pageUrlFor(req, slug) {
  const proto = req.headers?.['x-forwarded-proto'] || 'https';
  const host = req.headers?.host || 'www.getmyfirstdollar.com';
  return `${proto}://${host}/v/${encodeURIComponent(slug)}`;
}

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

  const ua = req.headers?.['user-agent'] || '';
  const pageUrl = pageUrlFor(req, slug);
  const sharedArgs = {
    slug,
    videoId: record.videoId,
    title: record.title || null,
    author: record.author || null,
    thumbnailUrl: record.thumbnailUrl || null,
    pageUrl,
  };

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (isCrawler(ua)) {
    console.log('[v/slug] crawler', { slug, videoId: record.videoId, ua: ua.slice(0, 80) });
    return res.status(200).send(renderCrawlerPage(sharedArgs));
  }

  if (isInstagramApp(ua)) {
    console.log('[v/slug] instagram', { slug, videoId: record.videoId });
    return res.status(200).send(renderInterstitialPage({
      ...sharedArgs,
      posthogKey: process.env.POSTHOG_KEY,
      posthogHost: process.env.POSTHOG_HOST,
    }));
  }

  console.log('[v/slug] hit', { slug, videoId: record.videoId });
  return res.status(200).send(renderRedirectPage({
    ...sharedArgs,
    posthogKey: process.env.POSTHOG_KEY,
    posthogHost: process.env.POSTHOG_HOST,
  }));
}
