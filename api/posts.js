let cache = { data: null, expires: 0 };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const now = Date.now();

  if (cache.data && now < cache.expires) {
    return res.status(200).json(cache.data);
  }

  try {
    const posts = [];
    let cursor = null;

    // Paginate through all published posts
    for (let i = 0; i < 20; i++) {
      const params = new URLSearchParams({
        status: 'confirmed',
        order_by: 'publish_date',
        direction: 'desc',
        limit: '100',
      });
      if (cursor) params.set('cursor', cursor);

      const response = await fetch(
        `https://api.beehiiv.com/v2/publications/${process.env.BEEHIIV_PUBLICATION_ID}/posts?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.BEEHIIV_API_KEY}`,
          },
        }
      );

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Failed to fetch posts' });
      }

      const json = await response.json();

      for (const post of json.data) {
        posts.push({
          title: post.title,
          subtitle: post.subtitle,
          date: post.publish_date,
          url: post.web_url,
          thumbnail: post.thumbnail_url,
          tags: post.content_tags,
          preview: post.preview_text,
        });
      }

      if (!json.pagination?.has_more) break;
      cursor = json.pagination.next_cursor;
    }

    cache = { data: posts, expires: now + 5 * 60 * 1000 }; // 5 min cache

    return res.status(200).json(posts);
  } catch {
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
