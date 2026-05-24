import crypto from 'node:crypto';

const COOKIE_NAME = 'admin_session';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

function hmac(secret, payloadBytes) {
  return crypto.createHmac('sha256', secret).update(payloadBytes).digest();
}

export function signSession(secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new Error('ADMIN_COOKIE_SECRET is not set');
  const payload = { iat: nowSeconds, exp: nowSeconds + MAX_AGE_SECONDS };
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = hmac(secret, payloadBytes);
  return `${b64url(payloadBytes)}.${b64url(sig)}`;
}

export function verifySession(secret, cookieValue, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || !cookieValue) return false;
  const dot = cookieValue.indexOf('.');
  if (dot === -1) return false;

  const payloadB64 = cookieValue.slice(0, dot);
  const sigB64 = cookieValue.slice(dot + 1);

  let payloadBytes;
  let sigBytes;
  try {
    payloadBytes = b64urlDecode(payloadB64);
    sigBytes = b64urlDecode(sigB64);
  } catch {
    return false;
  }

  const expected = hmac(secret, payloadBytes);
  if (expected.length !== sigBytes.length) return false;
  if (!crypto.timingSafeEqual(expected, sigBytes)) return false;

  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    return false;
  }

  if (typeof payload.exp !== 'number') return false;
  if (payload.exp < nowSeconds) return false;
  return true;
}

export { COOKIE_NAME, MAX_AGE_SECONDS };
