// POST /api/photo-urls   body: { publicIds: string[] }
// Gallery photos are private (Cloudinary type=authenticated). This route turns
// public IDs into signed delivery URLs, but only for signed-in school accounts
// (and admins, who are not on the school domain).
//
// Note: Cloudinary signed URLs on standard plans do not expire; they are just
// unguessable and only ever handed to authenticated users. Time-limited URLs
// need Cloudinary's token-based authentication (Enterprise feature).
import { v2 as cloudinary } from 'cloudinary';
import { guard, body, bearerToken } from './_lib/http.js';
import { verifySchoolUser, isAdminByRules } from './_lib/auth.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const ID_PATTERN = /^aurora\/gallery\/[A-Za-z0-9_\-./]+$/;
const MAX_IDS = 200;

const sign = (publicId, transformation) =>
  cloudinary.url(publicId, {
    type: 'authenticated',
    sign_url: true,
    secure: true,
    ...(transformation && { transformation })
  });

export default async function handler(req, res) {
  if (!guard(req, res, 'POST')) return;

  try {
    const token = bearerToken(req);
    const allowed = (await verifySchoolUser(token)) || (await isAdminByRules(token));
    if (!allowed) return res.status(403).json({ error: 'School account required.', code: 'NOT_SCHOOL_EMAIL' });

    const { publicIds } = body(req);
    if (!Array.isArray(publicIds) || publicIds.length > MAX_IDS || !publicIds.every((id) => typeof id === 'string' && ID_PATTERN.test(id))) {
      return res.status(400).json({ error: 'Invalid publicIds.' });
    }

    const urls = {};
    for (const id of publicIds) {
      urls[id] = {
        thumb: sign(id, [{ width: 600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }]),
        view: sign(id, [{ width: 1800, crop: 'limit', quality: 'auto', fetch_format: 'auto' }]),
        original: sign(id)
      };
    }
    return res.status(200).json({ urls });
  } catch (err) {
    console.error('photo-urls error:', err);
    return res.status(500).json({ error: 'Could not sign URLs.' });
  }
}