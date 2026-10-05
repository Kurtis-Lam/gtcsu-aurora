import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { getServices } from './_lib/firebase.js';
import { isAdminByRules } from './_lib/auth.js';
import { bearerToken, body, guard } from './_lib/http.js';

export const config = { maxDuration: 60 };

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function unsubscribeUrl(uid) {
  const secret = process.env.NEWS_UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error('NEWS_UNSUBSCRIBE_SECRET is not configured');
  const payload = Buffer.from(uid).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `https://gtcsu-aurora.vercel.app/api/unsubscribe-news?token=${payload}.${signature}`;
}

function makeEmail(article, unsubscribeLink) {
  const titleEn = escapeHtml(article.titleEn);
  const bodyEn = escapeHtml(article.bodyEn);
  const titleZh = escapeHtml(article.titleZh);
  const bodyZh = escapeHtml(article.bodyZh);
  const paragraphs = (value) => value.replace(/\r?\n/g, '<br>');
  const date = article.publishedAt?.toDate?.();
  const dateText = date
    ? new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'long', timeZone: 'Asia/Hong_Kong'
    }).format(date) + ' (HKT)'
    : '';
  const subject = `[Aurora] ${article.titleEn || article.titleZh || 'Latest news'}`.slice(0, 250);
  const html = `<!doctype html><html><body style="margin:0;background:#050b12;color:#dff6f2;font-family:Arial,sans-serif;padding:28px 12px">
    <div style="max-width:620px;margin:0 auto;background:#0a1a20;border:1px solid #28505a;border-radius:18px;overflow:hidden">
      <div style="padding:24px 28px;background:linear-gradient(120deg,#103840,#102520)">
        <p style="margin:0 0 8px;color:#7fe9f0;font-size:12px;letter-spacing:3px;text-transform:uppercase">Aurora · Latest News</p>
        <h1 style="margin:0;color:#fff;font-size:24px">Student Union Announcement</h1>
        ${dateText ? `<p style="margin:10px 0 0;color:#b9d2d0;font-size:13px">${escapeHtml(dateText)}</p>` : ''}
      </div>
      <div style="padding:28px">
        <h2 style="margin:0 0 10px;color:#2fe6b8;font-size:22px">${titleEn}</h2>
        <p style="margin:0;line-height:1.75;white-space:normal">${paragraphs(bodyEn)}</p>
        <hr style="border:0;border-top:1px solid #28505a;margin:26px 0">
        <h2 lang="zh-Hant" style="margin:0 0 10px;color:#7fe9f0;font-size:22px">${titleZh}</h2>
        <p lang="zh-Hant" style="margin:0;line-height:1.85;white-space:normal">${paragraphs(bodyZh)}</p>
        <p style="margin:28px 0 0"><a href="https://gtcsu-aurora.web.app/news.html" style="display:inline-block;padding:11px 18px;border-radius:999px;background:#2fe6b8;color:#04121c;text-decoration:none;font-weight:bold">View Latest News</a></p>
      </div>
      <div style="padding:18px 28px;border-top:1px solid #28505a;color:#91aaa8;font-size:12px;line-height:1.6">
        You received this because you signed in to Aurora. <a href="${escapeHtml(unsubscribeLink)}" style="color:#7fe9f0">Unsubscribe from news emails</a>.
      </div>
    </div>
  </body></html>`;
  const text = [
    'Aurora · Latest News',
    dateText,
    '',
    article.titleEn,
    article.bodyEn,
    '',
    article.titleZh,
    article.bodyZh,
    '',
    'View: https://gtcsu-aurora.web.app/news.html',
    `Unsubscribe: ${unsubscribeLink}`
  ].join('\n');
  return { subject, html, text };
}

async function claimDelivery(db, deliveryRef, details) {
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(deliveryRef);
    const data = existing.data();
    if (data?.status === 'sent') return false;
    if (data?.status === 'pending' && Date.now() - (data.startedAt?.toMillis?.() || 0) < 10 * 60 * 1000) {
      return false;
    }
    transaction.set(deliveryRef, {
      ...details,
      status: 'pending',
      startedAt: new Date()
    });
    return true;
  });
}

export default async function handler(req, res) {
  if (!guard(req, res, 'POST')) return;

  try {
    const token = bearerToken(req);
    if (!token || !(await isAdminByRules(token))) {
      return res.status(403).json({ error: 'Admin access is required.' });
    }

    const { newsId } = body(req);
    if (typeof newsId !== 'string' || !newsId.trim() || newsId.includes('/')) {
      return res.status(400).json({ error: 'Provide a valid news ID.' });
    }

    const { db } = getServices();
    const articleRef = db.collection('news').doc(newsId);
    const articleSnapshot = await articleRef.get();
    if (!articleSnapshot.exists) return res.status(404).json({ error: 'Announcement not found.' });
    const article = articleSnapshot.data();
    if (article.status !== 'published' || article.deleted === true) {
      return res.status(409).json({ error: 'Only published announcements can be emailed.' });
    }

    const subscribers = await db.collection('newsSubscriptions')
      .where('subscribed', '==', true)
      .get();
    if (subscribers.empty) return res.status(200).json({ total: 0, sent: 0, failed: 0, skipped: 0 });

    const gmailUser = process.env.GMAIL_USER?.trim();
    const appPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '');
    if (!gmailUser || !appPassword || !process.env.NEWS_UNSUBSCRIBE_SECRET) {
      return res.status(503).json({ error: 'Gmail delivery is not configured. Set GMAIL_USER, GMAIL_APP_PASSWORD, and NEWS_UNSUBSCRIBE_SECRET.' });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: appPassword }
    });
    const revision = Number(article.revision) || 1;
    const counters = { total: subscribers.size, sent: 0, failed: 0, skipped: 0 };
    const pending = subscribers.docs.filter((subscriber) => (
      typeof subscriber.data().email === 'string' && subscriber.data().email.includes('@')
    ));
    counters.failed += subscribers.size - pending.length;

    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < pending.length) {
        const subscriber = pending[nextIndex++];
        const uid = subscriber.id;
        const email = subscriber.data().email;
        const deliveryRef = db.collection('newsDeliveries').doc(`${newsId}_${revision}_${uid}`);
        let claimed = false;
        try {
          claimed = await claimDelivery(db, deliveryRef, { newsId, revision, uid, email });
          if (!claimed) {
            counters.skipped++;
            continue;
          }
          const link = unsubscribeUrl(uid);
          const message = makeEmail(article, link);
          await transporter.sendMail({
            from: `"Aurora Student Union" <${gmailUser}>`,
            to: email,
            subject: message.subject,
            text: message.text,
            html: message.html,
            headers: {
              'List-Unsubscribe': `<${link}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
            }
          });
          await deliveryRef.update({ status: 'sent', sentAt: new Date() });
          counters.sent++;
        } catch (error) {
          console.error(`Could not deliver news ${newsId} to subscriber ${uid}:`, error);
          if (claimed) {
            await deliveryRef.set({ newsId, revision, uid, email, status: 'failed', failedAt: new Date() });
          }
          counters.failed++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, pending.length) }, worker));
    await transporter.close();
    return res.status(200).json(counters);
  } catch (error) {
    console.error('News email delivery failed:', error);
    return res.status(500).json({ error: 'News was published, but subscriber email delivery failed.' });
  }
}
