import crypto from 'node:crypto';

const STATIC_ORIGINS = [
  'https://gtcsu-aurora.web.app',
  'https://gtcsu-aurora.firebaseapp.com'
];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const extraOrigins = () =>
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

function originAllowed(origin) {
  return (
    STATIC_ORIGINS.includes(origin) ||
    extraOrigins().includes(origin) ||
    LOCAL_ORIGIN.test(origin)
  );
}

/**
 * Sets CORS headers for an allowed origin. Returns false (and responds 403)
 * when the origin is present but not allowed.
 * Exported so handlers can call it before anything that might fail.
 */
export function applyCors(req, res, methods = ['GET', 'POST']) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin, Access-Control-Request-Headers');

  const origin = req.headers.origin;
  if (!origin) return true;

  if (!originAllowed(origin)) {
    res.status(403).json({ error: 'Forbidden origin' });
    return false;
  }

  const allowed = Array.from(new Set([...methods, 'OPTIONS']));
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', allowed.join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

export function guard(req, res, methods) {
  const allowedMethods = Array.isArray(methods) ? methods : [methods];

  if (!applyCors(req, res, allowedMethods)) return false;

  // Preflight: answer before any method or auth checks.
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
  return /^Bearer\s+[^\s]+$/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : null;
}

export function body(req) {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > 256 * 1024) return {};
  const raw = req.body;
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}