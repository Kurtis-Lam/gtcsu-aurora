import crypto from 'node:crypto';

// Every API route is called from our own pages (same origin), so we send NO
// CORS headers and additionally reject cross-origin browser calls. This stops
// other websites from spending our OpenRouter / Cloudinary / Firestore quota.
export function guard(req, res, method) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== method) {
    res.setHeader('Allow', method);
    res.status(405).json({ error: 'Method Not Allowed' });
    return false;
  }

  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { /* malformed */ }
    if (originHost !== req.headers.host) {
      res.status(403).json({ error: 'Forbidden origin' });
      return false;
    }
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

// Keyed hash so stored identifiers can't be brute-forced from the (small) IPv4
// space. The secret lives only in Vercel: IP_HASH_SECRET.
export function hashIp(ip) {
  const secret = process.env.IP_HASH_SECRET;
  if (!secret) throw new Error('IP_HASH_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(ip).digest('hex').slice(0, 24);
}

export function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

export function body(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}