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
export function applySecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.removeHeader?.('X-Powered-By');
}

export function applyCors(req, res, methods = ['GET', 'POST']) {
  applySecurityHeaders(res);
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
  if (header.length > 4300) return null;
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(header);
  return match ? match[1] : null;
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

const MAX_BODY_BYTES = 256 * 1024;

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value);
}

export function body(req) {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return {};
  const raw = req.body;
  if (plainObject(raw)) {
    try {
      if (Buffer.byteLength(JSON.stringify(raw)) > MAX_BODY_BYTES) return {};
    } catch {
      return {};
    }
    const clean = Object.create(null);
    for (const key of Object.keys(raw)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      clean[key] = raw[key];
    }
    return clean;
  }
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!plainObject(parsed)) return {};
      const clean = Object.create(null);
      for (const key of Object.keys(parsed)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        clean[key] = parsed[key];
      }
      return clean;
    } catch {
      return {};
    }
  }
  return {};
}