import crypto from 'node:crypto';

const STATIC_ORIGINS = [
  'https://gtcsu-aurora.web.app',
  'https://gtcsu-aurora.firebaseapp.com'
];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const extraOrigins = () =>
  (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

function originAllowed(origin, host) {
  return (
    STATIC_ORIGINS.includes(origin) ||
    extraOrigins().includes(origin) ||
    LOCAL_ORIGIN.test(origin) ||
    origin === `https://${host}`
  );
}

export function guard(req, res, methods) {
  const allowedMethods = Array.isArray(methods) ? methods : [methods];

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');

  const origin = req.headers.origin;
  if (origin) {
    if (!originAllowed(origin, req.headers.host)) {
      res.status(403).json({ error: 'Forbidden origin' });
      return false;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }

  if (!allowedMethods.includes(req.method)) {
    res.setHeader('Allow', allowedMethods.join(', '));
    res.status(405).json({ error: 'Method Not Allowed' });
    return false;
  }

  return true;
}

export function clientIp(req) {
  // On Vercel these headers are set by the edge, not the client.
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function hashIp(value) {
  const secret = process.env.IP_HASH_SECRET;
  if (!secret) throw new Error('IP_HASH_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex').slice(0, 24);
}

export function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

export function body(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}