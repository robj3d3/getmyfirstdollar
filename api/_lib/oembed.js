const TIMEOUT_MS = 5000;

export async function fetchYouTubeMetadata(videoId) {
  if (!videoId || typeof videoId !== 'string') {
    console.log('[oembed] invalid-input', { videoId });
    return null;
  }

  const target = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'getmyfirstdollar.com/1.0' },
    });

    if (!res.ok) {
      console.log('[oembed] non-ok', { videoId, status: res.status });
      return null;
    }

    let json;
    try {
      json = await res.json();
    } catch (err) {
      console.log('[oembed] bad-json', { videoId, message: err?.message });
      return null;
    }

    if (!json || typeof json !== 'object' || !json.title) {
      console.log('[oembed] missing-title', { videoId });
      return null;
    }

    console.log('[oembed] ok', { videoId, title: json.title });
    return {
      title: String(json.title),
      author: json.author_name ? String(json.author_name) : '',
      thumbnailUrl: json.thumbnail_url ? String(json.thumbnail_url) : null,
    };
  } catch (err) {
    console.log('[oembed] error', { videoId, message: err?.message });
    return null;
  }
}
