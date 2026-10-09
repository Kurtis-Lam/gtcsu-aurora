import { guard, bearerToken } from './_lib/http.js';
import { verifySchoolUser, isAdminByRules } from './_lib/auth.js';
import { getServices } from './_lib/firebase.js';
import { GALLERY_ID_PATTERN, IMAGE_DOC_ID_PATTERN } from './_lib/photos.js';

function safeString(value, maxLength, fallback = '') {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

export default async function handler(req, res) {
  if (!guard(req, res, 'GET')) return;

  try {
    const token = bearerToken(req);
    const allowed = (await verifySchoolUser(token)) || (await isAdminByRules(token));
    if (!allowed) return res.status(403).json({ error: 'A verified school account is required.' });

    const snapshot = await getServices().db.collection('galleryImages').get();
    const images = snapshot.docs.flatMap((document) => {
      const data = document.data() || {};
      if (!IMAGE_DOC_ID_PATTERN.test(document.id) || typeof data.publicId !== 'string' || !GALLERY_ID_PATTERN.test(data.publicId)) return [];
      return [{
        id: document.id,
        name: safeString(data.name, 200, 'photo'),
        title: safeString(data.title, 200, 'Untitled'),
        folderId: safeString(data.folderId, 128) || null,
        folderPath: safeString(data.folderPath, 300, 'Uncategorized')
      }];
    });

    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).json({ images });
  } catch (err) {
    console.error('list-photos error:', err.message);
    return res.status(500).json({ error: 'Could not retrieve gallery photos.' });
  }
}
