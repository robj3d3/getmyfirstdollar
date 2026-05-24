import { getLinks, writeLinks } from '../api/_lib/edge.js';
import { fetchYouTubeMetadata } from '../api/_lib/oembed.js';

async function main() {
  if (!process.env.EDGE_CONFIG) {
    console.error('FATAL: EDGE_CONFIG env var is required (run with `node --env-file=.env.local scripts/backfill-metadata.js`).');
    process.exit(1);
  }
  if (!process.env.EDGE_CONFIG_ID || !process.env.VERCEL_API_TOKEN || !process.env.VERCEL_TEAM_ID) {
    console.error('FATAL: EDGE_CONFIG_ID, VERCEL_API_TOKEN, and VERCEL_TEAM_ID are all required for writes.');
    process.exit(1);
  }

  let links;
  try {
    links = await getLinks();
  } catch (err) {
    console.error('FATAL: failed to read Edge Config:', err?.message || err);
    process.exit(1);
  }

  const slugs = Object.keys(links);
  console.log(`Found ${slugs.length} link(s) in Edge Config.`);

  const next = { ...links };
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const slug of slugs) {
    const record = links[slug];
    if (record?.title) {
      console.log(`SKIP  ${slug} (already has metadata)`);
      skipped++;
      continue;
    }
    if (!record?.videoId) {
      console.log(`FAIL  ${slug} (no videoId)`);
      failed++;
      continue;
    }
    const meta = await fetchYouTubeMetadata(record.videoId);
    if (!meta) {
      console.log(`FAIL  ${slug} (videoId=${record.videoId}) — oEmbed unavailable`);
      failed++;
      continue;
    }
    next[slug] = {
      ...record,
      title: meta.title,
      author: meta.author,
      thumbnailUrl: meta.thumbnailUrl,
      metadataFetchedAt: Date.now(),
    };
    console.log(`OK    ${slug} -> "${meta.title}"`);
    updated++;
  }

  if (updated === 0) {
    console.log(`\n${updated} updated, ${skipped} skipped, ${failed} failed. No writes needed.`);
    process.exit(0);
  }

  try {
    await writeLinks(next);
  } catch (err) {
    console.error('FATAL: writeLinks failed:', err?.message || err);
    process.exit(1);
  }

  console.log(`\n${updated} updated, ${skipped} skipped, ${failed} failed. Wrote ${updated} record(s) to Edge Config.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL: unexpected error:', err?.message || err);
  process.exit(1);
});
