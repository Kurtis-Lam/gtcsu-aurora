import crypto from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { guard, body, bearerToken, clientIp, hashIp } from './_lib/http.js';
import { authenticateGalleryUser } from './_lib/auth.js';
import { takeRateLimit, RATE_LIMITS } from './_lib/ratelimit.js';
import { getServices } from './_lib/firebase.js';
import { getGalleryImage, fetchDownloadSource } from './_lib/photos.js';
import { embedWatermark, isWatermarkConfigured, WATERMARK_METHOD } from './_lib/watermark.js';

const CONSENT_VERSION = '2026-10-v1';

function getClientDetails(userAgent = '') {
  const value = String(userAgent).slice(0, 1000);
  const browser = /Edg\//i.test(value) ? 'Edge'
    : /Firefox\//i.test(value) ? 'Firefox'
    : /Chrome\//i.test(value) ? 'Chrome'
    : /Safari\//i.test(value) ? 'Safari'
    : 'Other';
  const device = /iPad|Tablet/i.test(value) ? 'Tablet'
    : /Mobi|Android|iPhone|iPod/i.test(value) ? 'Mobile'
    : value ? 'Desktop or unknown' : 'Unknown';
  return { browser, device };
}

function escapeFilename(value) {
  const safe = String(value || 'aurora-photo').normalize('NFKC').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/[. ]+$/g, '').slice(0, 100);
  return safe || 'aurora-photo';
}

function hongKongTime(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

export default async function handler(req, res) {
  if (!guard(req, res, 'POST')) return;

  try {
    const session = await authenticateGalleryUser(bearerToken(req));
    if (!session) return res.status(403).json({ error: 'A verified school account is required.' });
    const decoded = session.decoded;

    const { imageId, batchId, consent, consentVersion } = body(req);
    if (typeof imageId !== 'string' || (batchId !== undefined && (typeof batchId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(batchId)))) {
      return res.status(400).json({ error: 'Invalid photo request.' });
    }
    if (consent !== true || consentVersion !== CONSENT_VERSION) {
      return res.status(400).json({ error: 'The download audit notice must be accepted before downloading.', code: 'CONSENT_REQUIRED' });
    }

    const accountHashSecret = process.env.ANALYTICS_HMAC_SECRET;
    if (!accountHashSecret || Buffer.byteLength(accountHashSecret) < 32) {
      return res.status(503).json({ error: 'Photo audit service is not configured.' });
    }

    if (!isWatermarkConfigured()) {
      return res.status(503).json({ error: 'Photo protection service is not configured.' });
    }

    const image = await getGalleryImage(imageId);
    if (!image) return res.status(404).json({ error: 'Photo not found.' });

    const now = new Date();
    const accountHash = crypto.createHmac('sha256', accountHashSecret).update(String(decoded.uid)).digest('hex');
    const { db } = getServices();
    const quota = await takeRateLimit(db, RATE_LIMITS.photoDownload, accountHash);
    if (!quota.allowed) {
      res.setHeader('Retry-After', String(quota.retryAfterSeconds));
      const minutes = Math.max(1, Math.ceil(quota.retryAfterSeconds / 60));
      return res.status(429).json({
        error: `Download limit reached (10 photos per hour). Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        code: 'RATE_LIMITED'
      });
    }

    const downloadId = crypto.randomUUID();
    const timeHkt = hongKongTime(now);
    const email = String(decoded.email || 'verified-user').slice(0, 254);
    const watermarkId = downloadId.replace(/-/g, '').slice(0, 16).toLowerCase();
    const watermarkRef = watermarkId.slice(0, 8).toUpperCase();
    const source = await fetchDownloadSource(image);
    const delivered = await embedWatermark(source.buffer, watermarkId);
    const { browser, device } = getClientDetails(req.headers['user-agent']);
    let networkHash;
    if (process.env.IP_HASH_SECRET) {
      try {
        const address = clientIp(req);
        if (address && address !== 'unknown') networkHash = hashIp(address);
      } catch {}
    }

    const logRef = db.collection('photoDownloadLogs').doc(downloadId);
    const summaryRef = db.collection('photoDownloadStats').doc('summary');
    const photoStatsRef = db.collection('photoDownloadStats').doc(`photo_${image.id}`);
    const userStatsRef = db.collection('photoDownloadUsers').doc(accountHash);
    const log = {
      downloadId,
      batchId: typeof batchId === 'string' ? batchId : null,
      uid: String(decoded.uid || '').slice(0, 128),
      email,
      displayName: String(decoded.name || '').slice(0, 150),
      photoDocId: image.id,
      photoTitle: String(image.title || image.name || 'Untitled').slice(0, 200),
      folderPath: String(image.folderPath || 'Uncategorized').slice(0, 300),
      downloadedAt: FieldValue.serverTimestamp(),
      eventTime: Timestamp.fromDate(now),
      eventTimeHkt: `${timeHkt} HKT`,
      status: 'response-generated',
      action: 'invisible-watermarked-download-generated',
      consentAccepted: true,
      consentVersion: CONSENT_VERSION,
      consentRecordedAt: Timestamp.fromDate(now),
      watermarkMethod: WATERMARK_METHOD,
      watermarkId,
      outputFormat: 'jpg',
      outputBytes: delivered.buffer.length,
      maxWidth: 3000,
      browser,
      device,
      watermarkRef,
      ...(networkHash ? { networkHash } : {})
    };

    await db.runTransaction(async (transaction) => {
      const [summarySnap, photoSnap, userSnap] = await Promise.all([
        transaction.get(summaryRef), transaction.get(photoStatsRef), transaction.get(userStatsRef)
      ]);
      const summary = summarySnap.exists ? summarySnap.data() : {};
      const photoStats = photoSnap.exists ? photoSnap.data() : {};
      const userStats = userSnap.exists ? userSnap.data() : {};
      transaction.create(logRef, log);
      transaction.set(summaryRef, {
        totalDownloads: Number(summary.totalDownloads || 0) + 1,
        uniqueAccounts: Number(summary.uniqueAccounts ?? summary.uniquePeople ?? 0) + (userSnap.exists ? 0 : 1),
        lastDownloadAt: FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.set(photoStatsRef, {
        photoDocId: image.id,
        photoTitle: log.photoTitle,
        folderPath: log.folderPath,
        totalDownloads: Number(photoStats.totalDownloads || 0) + 1,
        lastDownloadedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.set(userStatsRef, {
        totalDownloads: Number(userStats.totalDownloads || 0) + 1,
        lastDownloadedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });

    const filename = `${escapeFilename(image.name || image.title || 'aurora-photo').replace(/\.[^.]+$/, '')}-aurora.jpg`;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', String(delivered.buffer.length));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return res.status(200).send(delivered.buffer);
  } catch (err) {
    console.error('photo-download error:', err.message);
    return res.status(502).json({ error: 'Could not prepare the protected download.' });
  }
}