import { guard, body, bearerToken } from './_lib/http.js';
import { isAdminByRules } from './_lib/auth.js';
import { getServices } from './_lib/firebase.js';
import { cloudinaryClient, GALLERY_ID_PATTERN, IMAGE_DOC_ID_PATTERN } from './_lib/photos.js';

export default async function handler(req, res) {
  if (!guard(req, res, 'POST')) return;

  try {
    if (!(await isAdminByRules(bearerToken(req)))) {
      return res.status(403).json({ error: 'Admins only.' });
    }

    const { imageId } = body(req);
    if (typeof imageId !== 'string' || !IMAGE_DOC_ID_PATTERN.test(imageId)) {
      return res.status(400).json({ error: 'Invalid photo ID.' });
    }

    const { db } = getServices();
    const imageRef = db.collection('galleryImages').doc(imageId);
    const snapshot = await imageRef.get();
    if (!snapshot.exists) return res.status(404).json({ error: 'Photo not found.' });
    const image = snapshot.data() || {};

    if (typeof image.publicId === 'string' && GALLERY_ID_PATTERN.test(image.publicId)) {
      const result = await cloudinaryClient.uploader.destroy(image.publicId, {
        type: 'authenticated',
        resource_type: 'image',
        invalidate: true
      });
      if (!['ok', 'not found'].includes(result?.result)) {
        return res.status(502).json({ error: 'The photo provider could not delete this file.' });
      }
    }

    const batch = db.batch();
    batch.delete(imageRef);
    batch.delete(db.collection('photoDerivativeCache').doc(`${imageId}_thumb`));
    batch.delete(db.collection('photoDerivativeCache').doc(`${imageId}_view`));
    await batch.commit();
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('delete-photo error:', err.message);
    return res.status(500).json({ error: 'Could not delete photo.' });
  }
}
