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
const IMAGE_DOC_CACHE_MS = 60 * 1000;
const VARIANT_CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 2000;
const imageDocCache = new Map();
const variantUrlCache = new Map();

function readCache(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(map, key, value, ttlMs) {
  if (map.size >= CACHE_MAX_ENTRIES) map.clear();
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function getGalleryImage(imageId) {
  if (typeof imageId !== 'string' || !IMAGE_DOC_ID_PATTERN.test(imageId)) return null;
  const cachedImage = readCache(imageDocCache, imageId);
  if (cachedImage) return cachedImage;
  const snapshot = await getServices().db.collection('galleryImages').doc(imageId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() || {};
  if (typeof data.publicId !== 'string' || !GALLERY_ID_PATTERN.test(data.publicId)) return null;
  const image = { ...data, id: snapshot.id };
  writeCache(imageDocCache, imageId, image, IMAGE_DOC_CACHE_MS);
  return image;
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
  const memoryKey = `${image.id}_${variant}_${image.publicId}`;
  const memoryUrl = readCache(variantUrlCache, memoryKey);
  if (memoryUrl) return memoryUrl;
  const db = getServices().db;
  const cacheRef = db.collection('photoDerivativeCache').doc(`${image.id}_${variant}`);
  const cached = await cacheRef.get();
  if (cached.exists) {
    const value = cached.data() || {};
    if (value.publicId === image.publicId && typeof value.secureUrl === 'string' && value.secureUrl.startsWith('https://')) {
      writeCache(variantUrlCache, memoryKey, value.secureUrl, VARIANT_CACHE_MS);
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
  writeCache(variantUrlCache, memoryKey, eager.secure_url, VARIANT_CACHE_MS);
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