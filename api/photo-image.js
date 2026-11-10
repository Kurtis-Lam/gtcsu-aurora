import { guard, bearerToken } from './_lib/http.js';
import { authenticateGalleryUser } from './_lib/auth.js';
import { getServices } from './_lib/firebase.js';
import { getGalleryImage, getOrCreatePhotoVariantUrl, fetchCloudinaryImage } from './_lib/photos.js';
import { RATE_LIMITS, takeRateLimit } from './_lib/ratelimit.js';

export default async function handler(req, res) {
  if (!guard(req, res, 'GET')) return;

  try {
    const session = await authenticateGalleryUser(bearerToken(req));
    if (!session) return res.status(403).json({ error: 'A verified school account is required.' });
    const { db } = getServices();
    const quota = await takeRateLimit(db, RATE_LIMITS.photoImage, String(session.decoded.uid));
    if (!quota.allowed) {
      res.setHeader('Retry-After', String(quota.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many photo requests. Try again shortly.' });
    }

    const url = new URL(req.url, 'https://aurora.invalid');
    const imageId = url.searchParams.get('imageId');
    const requestedVariant = url.searchParams.get('variant') || 'thumb';
    if (!['thumb', 'view'].includes(requestedVariant)) return res.status(400).json({ error: 'Invalid image variant.' });
    const variant = !session.admin && requestedVariant === 'view' ? 'thumb' : requestedVariant;

    const image = await getGalleryImage(imageId);
    if (!image) return res.status(404).json({ error: 'Photo not found.' });

    const variantUrl = await getOrCreatePhotoVariantUrl(image, variant);
    const delivered = await fetchCloudinaryImage(variantUrl);
    res.setHeader('Content-Type', delivered.contentType);
    res.setHeader('Content-Length', String(delivered.buffer.length));
    res.setHeader('Content-Disposition', 'inline; filename="aurora-photo"');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.status(200).send(delivered.buffer);
  } catch (err) {
    console.error('photo-image error:', err.message);
    return res.status(502).json({ error: 'Could not retrieve photo.' });
  }
}