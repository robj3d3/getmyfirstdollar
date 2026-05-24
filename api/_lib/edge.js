import { get } from '@vercel/edge-config';

const LINKS_KEY = 'links';

export async function getLinks() {
  const value = await get(LINKS_KEY);
  return value && typeof value === 'object' ? value : {};
}

export async function writeLinks(nextLinks) {
  const edgeConfigId = process.env.EDGE_CONFIG_ID;
  const token = process.env.VERCEL_API_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!edgeConfigId) throw new Error('EDGE_CONFIG_ID is not set');
  if (!token) throw new Error('VERCEL_API_TOKEN is not set');
  if (!teamId) throw new Error('VERCEL_TEAM_ID is not set');

  const url = `https://api.vercel.com/v1/edge-config/${edgeConfigId}/items?teamId=${teamId}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items: [{ operation: 'upsert', key: LINKS_KEY, value: nextLinks }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Edge Config write failed: ${response.status} ${text}`);
  }
}

export { LINKS_KEY };
