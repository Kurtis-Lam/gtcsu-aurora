// POST /api/sign-upload  (admins only)
// Returns a signed Cloudinary upload payload. Uploads are stored with
// type=authenticated, so they can only be displayed through signed URLs that
// Browsers receive images only through the authenticated server-side photo proxy.
import { v2 as cloudinary } from 'cloudinary';
import { guard, bearerToken } from './_lib/http.js';
import { verifiedAdmin } from './_lib/auth.js';
import { getServices } from './_lib/firebase.js';
import { RATE_LIMITS, takeRateLimit } from './_lib/ratelimit.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export default async function handler(req, res) {
  if (!guard(req, res, 'POST')) return;

  try {
    const admin = await verifiedAdmin(bearerToken(req));
    if (!admin) return res.status(403).json({ error: 'Admins only.' });
    const { db } = getServices();
    const quota = await takeRateLimit(db, RATE_LIMITS.signUpload, String(admin.uid));
    if (!quota.allowed) {
      res.setHeader('Retry-After', String(quota.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many upload signatures requested.' });
    }

    const params = {
      timestamp: Math.round(Date.now() / 1000),
      folder: 'aurora/gallery',
      type: 'authenticated',
      allowed_formats: 'jpg,jpeg,png,webp'
    };
    const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);

    return res.status(200).json({
      ...params,
      signature,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY
    });
  } catch (err) {
    console.error('sign-upload error:', err.message);
    return res.status(500).json({ error: 'Could not sign upload.' });
  }
}