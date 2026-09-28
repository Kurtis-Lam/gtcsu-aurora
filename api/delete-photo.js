// POST /api/delete-photo   body: { publicId }   (admins only)
// Removes the actual file from Cloudinary (the admin page removes the
// Firestore record). Without this, "deleted" photos would stay retrievable.
import { v2 as cloudinary } from 'cloudinary';
import { guard, body, bearerToken } from './_lib/http.js';
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

    const { publicId } = body(req);
    if (typeof publicId !== 'string' || !/^aurora\/gallery\/[A-Za-z0-9_\-./]+$/.test(publicId)) {
      return res.status(400).json({ error: 'Invalid publicId.' });
    }

    await cloudinary.uploader.destroy(publicId, { type: 'authenticated', resource_type: 'image', invalidate: true });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('delete-photo error:', err);
    return res.status(500).json({ error: 'Could not delete photo.' });
  }
}