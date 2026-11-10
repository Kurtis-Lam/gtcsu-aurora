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

function isCloudinaryUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname === 'res.cloudinary.com';
  } catch {
    return false;
  }
}

export async function fetchCloudinaryImage(url, maxBytes = MAX_IMAGE_BYTES) {
  if (!isCloudinaryUrl(url)) throw new Error('Image provider URL is not trusted');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_IMAGE_BYTES) {
    throw new Error('Invalid image size limit');
  }

  const upstream = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
    headers: { Accept: 'image/jpeg' }
  });
  if (!upstream.ok) throw new Error(`Image provider returned ${upstream.status}`);
  if (!isCloudinaryUrl(upstream.url || url)) throw new Error('Image provider returned an untrusted URL');

  const upstreamType = (upstream.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (upstreamType !== 'image/jpeg' && upstreamType !== 'image/jpg') {
    throw new Error('Image provider returned an unexpected image format');
  }

  const contentLength = upstream.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes) {
      throw new Error('Image exceeds size limit');
    }
  }
  if (!upstream.body) throw new Error('Image provider returned an empty response');

  const reader = upstream.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error('Image exceeds size limit');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) throw new Error('Image provider returned an empty response');
  return { buffer: Buffer.concat(chunks, totalBytes), contentType: 'image/jpeg' };
}

export async function fetchDownloadSource(image) {
  const sourceUrl = cloudinary.url(image.publicId, {
    type: 'authenticated',
    sign_url: true,
    secure: true,
    resource_type: 'image',
    transformation: [
      { width: 3000, crop: 'limit' },
      { quality: 95, format: 'jpg' }
    ]
  });
  return fetchCloudinaryImage(sourceUrl);
}