import { COOKIE_NAME } from '../_lib/auth.js';
import { serializeCookie } from '../_lib/cookies.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    console.log('[admin/logout] method-not-allowed', { method: req.method });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookie = serializeCookie(COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0,
  });

  console.log('[admin/logout] cleared');
  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ success: true });
}
