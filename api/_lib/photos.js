import { v2 as cloudinary } from 'cloudinary';
import { getServices } from './firebase.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

export const GALLERY_ID_PATTERN = /^aurora\/gallery\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
export const IMAGE_DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const cloudinaryClient = cloudinary;

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export async function getGalleryImage(imageId) {
  if (typeof imageId !== 'string' || !IMAGE_DOC_ID_PATTERN.test(imageId)) return null;
  const snapshot = await getServices().db.collection('galleryImages').doc(imageId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() || {};
  if (typeof data.publicId !== 'string' || !GALLERY_ID_PATTERN.test(data.publicId)) return null;
  return { ...data, id: snapshot.id };
}

function fixedTransformation(variant) {
  const width = variant === 'thumb' ? 600 : 1800;
  return [
    { width, crop: 'limit' },
    { quality: 'auto:good', format: 'jpg' }
  ];
}

export async function getOrCreatePhotoVariantUrl(image, variant) {
  if (!['thumb', 'view'].includes(variant)) throw new Error('Unsupported photo variant');
  const db = getServices().db;
  const cacheRef = db.collection('photoDerivativeCache').doc(`${image.id}_${variant}`);
  const cached = await cacheRef.get();
  if (cached.exists) {
    const value = cached.data() || {};
    if (value.publicId === image.publicId && typeof value.secureUrl === 'string' && value.secureUrl.startsWith('https://')) {
      return value.secureUrl;
    }
  }

  const result = await cloudinary.uploader.explicit(image.publicId, {
    type: 'authenticated',
    resource_type: 'image',
    eager_async: false,
    eager: [Object.assign({}, ...fixedTransformation(variant))]
  });
  const eager = Array.isArray(result.eager) ? result.eager.find((item) => typeof item.secure_url === 'string') : null;
  if (!eager) throw new Error('Cloudinary did not generate an authenticated photo variant');

  await cacheRef.set({
    publicId: image.publicId,
    imageDocId: image.id,
    variant,
    secureUrl: eager.secure_url,
    generatedAt: new Date(),
    format: eager.format || 'jpg',
    bytes: Number(eager.bytes || 0)
  });
  return eager.secure_url;
}

export async function fetchCloudinaryImage(url, maxBytes = MAX_IMAGE_BYTES) {
  const upstream = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!upstream.ok) throw new Error(`Image provider returned ${upstream.status}`);
  const upstreamType = (upstream.headers.get('content-type') || '').toLowerCase();
  if (!upstreamType.startsWith('image/')) throw new Error('Image provider returned a non-image response');
  const announcedSize = Number(upstream.headers.get('content-length') || 0);
  if (announcedSize > maxBytes) throw new Error('Image exceeds size limit');
  const buffer = Buffer.from(await upstream.arrayBuffer());
  if (buffer.length === 0 || buffer.length > maxBytes) throw new Error('Image exceeds size limit');
  return { buffer, contentType: upstreamType };
}

export async function createWatermarkedDownload(image, watermarkText, downloadId) {
  const temporaryPublicId = `aurora/temp-downloads/${downloadId}`;
  const sourceUrl = cloudinary.url(image.publicId, {
    type: 'authenticated',
    sign_url: true,
    secure: true,
    resource_type: 'image'
  });

  try {
    await cloudinary.uploader.upload(sourceUrl, {
      public_id: temporaryPublicId,
      resource_type: 'image',
      type: 'authenticated',
      overwrite: false,
      invalidate: true,
      format: 'jpg',
      transformation: [
        { width: 3000, crop: 'limit' },
        {
          overlay: {
            font_family: 'Arial',
            font_size: 24,
            font_weight: 'bold',
            text: watermarkText
          },
          color: '#FFFFFF',
          opacity: 58,
          angle: -25,
          gravity: 'center',
          flags: 'layer_apply'
        },
        { quality: 88, format: 'jpg' }
      ]
    });

    const temporaryUrl = cloudinary.url(temporaryPublicId, {
      type: 'authenticated',
      sign_url: true,
      secure: true,
      resource_type: 'image',
      format: 'jpg'
    });
    return await fetchCloudinaryImage(temporaryUrl);
  } finally {
    try {
      await cloudinary.uploader.destroy(temporaryPublicId, {
        type: 'authenticated',
        resource_type: 'image',
        invalidate: true
      });
    } catch (err) {
      console.error('Temporary watermarked photo cleanup failed:', err.message);
    }
  }
}
