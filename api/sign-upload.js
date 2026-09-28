// POST /api/sign-upload  (admins only)
// Returns a signed Cloudinary upload payload. Uploads are stored with
// type=authenticated, so they can only be displayed through signed URLs that
// /api/photo-urls hands out to signed-in school accounts.
import { v2 as cloudinary } from 'cloudinary';
import { guard, bearerToken } from './_lib/http.js';
import { isAdminByRules } from './_lib/auth.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export default async function handler(req, res) {
  if (!guard(req, res, 'POST')) return;

  try {
    if (!(await isAdminByRules(bearerToken(req)))) {
      return res.status(403).json({ error: 'Admins only.' });
    }

    const params = {
      timestamp: Math.round(Date.now() / 1000),
      folder: 'aurora/gallery',
      type: 'authenticated',
      allowed_formats: 'jpg,jpeg,png,webp,gif'
    };
    const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);

    return res.status(200).json({
      ...params,
      signature,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY
    });
  } catch (err) {
    console.error('sign-upload error:', err);
    return res.status(500).json({ error: 'Could not sign upload.' });
  }
}