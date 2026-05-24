import crypto from 'node:crypto';
import { signSession, COOKIE_NAME, MAX_AGE_SECONDS } from '../_lib/auth.js';
import { serializeCookie } from '../_lib/cookies.js';

function timingSafeEqualStrings(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    console.log('[admin/login] method-not-allowed', { method: req.method });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const password = req.body?.password;
  if (!password || typeof password !== 'string') {
    console.log('[admin/login] missing-password');
    return res.status(400).json({ error: 'Password required' });
  }

  const expected = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_COOKIE_SECRET;
  if (!expected || !secret) {
    console.log('[admin/login] env-missing', { hasPassword: !!expected, hasSecret: !!secret });
    return res.status(500).json({ error: 'Server not configured' });
  }

  if (!timingSafeEqualStrings(password, expected)) {
    console.log('[admin/login] auth-fail');
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = signSession(secret);
  const cookie = serializeCookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });

  console.log('[admin/login] auth-pass');
  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ success: true });
}
