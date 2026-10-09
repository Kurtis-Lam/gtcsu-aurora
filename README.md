# Aurora — Student Union Candidate Cabinet Website

Official website for **Aurora**, the No. 1 candidate cabinet for the Student Union of G.T. (Ellen Yeung) College, 2026–27.

This is a multi‑page, bilingual (English / Traditional Chinese) static website with dynamic features such as public news, automatic email subscriptions for signed-in school accounts, anonymous feedback submission, a real‑time support counter, and a detailed financial budget breakdown.

---

## ✨ Features

- **Bilingual Interface** – Toggle between English and Traditional Chinese on every page. Language preference is saved in `localStorage`.
- **Immersive Design** – Animated video background, glass‑morphism cards, and smooth scroll‑reveal effects.
- **Dynamic Navigation** – A shared navigation panel (`panel.html`) is injected via `load-components.js` for consistent headers across pages.
- **Latest News** – Anyone can read bilingual announcements and signed-in users can mark them as read. Signing in with a verified school Google account automatically subscribes to announcement emails; each email includes an unsubscribe link. Admins can draft, translate, review, publish, and manage announcements with an activity log.
- **Support Us Counter** – Real‑time global support counter with a per-device and per-account 10-minute cooldown. Uses Firebase Firestore.
- **Feedbacks & Support** – Submit feedback with an anonymous/name toggle and word‑count validation; the support counter is available below the feedback and FAQ.
- **Activities & Schedule** – Expandable cards detailing festive, regular, and post‑exam activities; month‑by‑month calendar.
- **Welfare & Discounts** – Curated list of student benefits, merchant discounts, and campus welfares.
- **Financial Transparency** – Full budget breakdown for all planned activities and election expenses.
- **Admin / Analytics** – Includes `analytics.js` for tracking, feedback and supporter management, private news drafts, audit logs, and OpenRouter-assisted translation.

---

## 📄 Pages

| File | Description |
|------|-------------|
| `index.html` | Landing page with cabinet name, slogan, and Instagram link. |
| `news.html` | Public bilingual announcements. |
| `aboutus.html` | Vision, promotion video, and cabinet member profiles. |
| `activities.html` | Detailed descriptions of all planned activities (festive, regular, post‑exam, inter‑school). |
| `welfare.html` | Student welfare offers, merchant discounts, and external benefits. |
| `schedule.html` | Month‑by‑month calendar of events for the 2026–27 academic year. |
| `feedbacks.html` | Anonymous feedback form, FAQ, and support counter. |
| `financial.html` | Complete budget breakdown with itemised costs. |
| `admin.html` | Admin analytics, feedback inbox, supporter records, photo uploads, and news management. |

---

## 🌐 Deployment

The webpage is hosted on:
- **Firebase Hosting**: Frontend
- **Vercel**: Backend and Cloud Functions

Backend secrets must be configured only as Vercel environment variables; use `.env.example` as the variable-name reference and never commit `.env.local`, service-account JSON, API keys, or other credentials. Set `ANALYTICS_HMAC_SECRET` and `IP_HASH_SECRET` to independent random values of at least 32 characters. `OPENROUTER_API_KEY` is used only by server-side translation. Deploy the Firestore rules and index/TTL configuration with `firebase deploy --only firestore:rules,firestore:indexes`; deploy static hosting changes with `firebase deploy --only hosting` and the API changes to Vercel with `vercel --prod`.

Admin access no longer depends on personal Gmail addresses embedded in Firestore rules. An approved admin account must have the trusted Firebase custom claim `admin: true`. Enable and require 2-Step Verification for each admin account in Google Workspace or the account's Google security settings, then set claims using the private Firebase service account in your terminal. For a raw service-account JSON file, set `FIREBASE_SERVICE_ACCOUNT` to its JSON contents for the command session (do not save it in this repository), then run `node scripts/set-admin-claims.js approved-admin@example.com` once per approved account. To remove access, run `node scripts/set-admin-claims.js --revoke approved-admin@example.com`. After claim changes, each admin must sign out and sign in again. Firebase does not reliably expose the Google account's 2-Step Verification state as a claim for this app's Google sign-in flow, so enforcement must be set at the Google account/Workspace level and verified by the system owner; the application cannot honestly guarantee 2FA by itself.

The photo gallery no longer gives browsers Cloudinary delivery URLs, provider public IDs, or unwatermarked originals. Firestore restricts gallery-image documents to admins; `/api/list-photos` exposes only allowlisted display metadata to verified school accounts, and `/api/photo-image` proxies authenticated variants with no-store caching and downgrades school-account lightbox requests to the 600-pixel thumbnail; only an admin session can request the 1800-pixel view variant. Cloudinary transformation links remain server-side. `/api/photo-download` creates an individually watermarked JPEG through a short-lived authenticated temporary asset, reads its bytes on the server, and attempts to delete that temporary asset before responding. The watermark uses a masked account email, Hong Kong time, and a unique reference so a shared image can be investigated without printing the student's full email address on the photo. The admin **Photo Downloads** tab shows all-time aggregate counters, unique verified Firebase accounts, the latest 500 events, popular photos, search, and CSV export. Each event records server time (shown in HKT), verified account email and UID, photo/folder IDs and names, batch and unique watermark references, output format and byte count, and coarse device/browser classification. When `IP_HASH_SECRET` is configured, it also stores a keyed hash of the source IP, never the raw address. Exact location, full user-agent strings, and additional device fingerprinting are deliberately not collected. Downloads are rate-limited per account (120/hour and 500/day). Firestore TTL is configured to remove detailed audit events after 365 days and pseudonymous rate-limit records after 90 days; confirm TTL activation in Firebase Console after deploying indexes. Only a keyed pseudonymous account counter remains for accurate all-time unique-account totals. An event means the server generated and returned a response, not proof a browser saved the file. Screenshots, external screen captures, and deliberate editing cannot be fully prevented or reliably traced.

To send announcement emails, enable 2-Step Verification on the `gtcsu2627aurora@gmail.com` account and create a Google App Password. In Vercel, open the project’s **Settings → Environment Variables** and add `GMAIL_USER` (the sender address), `GMAIL_APP_PASSWORD` (the App Password), and `NEWS_UNSUBSCRIBE_SECRET` (a long random signing secret). Generate the signing secret locally with `openssl rand -hex 32`; paste the generated value into Vercel and never commit it or put it in frontend code. Redeploy after adding the variables. Email delivery is sent by the authenticated admin publish action and can be retried from a past announcement.

---

## 🙌 Credits

- **Contents:** Aurora Cabinet 2026–27 Vice President and Members
- **Development:** Kurtis

---

## 📄 License

This project is for the internal use of G.T. (Ellen Yeung) College Student Union Candidate Cabinet No. 1 – Aurora.  
All rights reserved. Unauthorised reproduction or distribution is prohibited.

Licensed under MIT.

---

## 📬 Contact & Contributing

For any enquiries, please reach out via Aurora's Official Instagram: [@gteyc_aurora2627](https://www.instagram.com/gteyc_aurora2627/) or me at: `kurtislam100@gmail.com`

If you are looking forward to contributing, please see CONTRIBUTING.md


### 🔐 Security

- Firestore authorization is enforced server-side and by Firestore Security Rules; client-side checks are not treated as authorization.
- Analytics writes are mediated by the backend and throttled instead of allowing anonymous direct Firestore writes.
- Gallery records are resolved server-side, Cloudinary delivery URLs are not returned to browsers, and download responses receive per-account/time/reference watermarks.
- Download audit writes are performed by the server; clients may read audit records only with the admin custom claim.
- Security headers, including HSTS, a hash-based CSP without `script-src 'unsafe-inline'`, clickjacking protection, and MIME-sniffing protection, are configured for Firebase Hosting as well as Vercel.
- Admin authorization uses a trusted Firebase custom claim instead of a hard-coded email list. Protect approved admin Google accounts with enforced 2-Step Verification.
- The promotion video is re-encoded to 480p/24fps and lazy-loaded only after the user selects play; the file is approximately 22 MB instead of 326 MB.
- If credentials were ever committed or shared, rotate them at the provider immediately. Removing a secret from the repository does not invalidate an already-issued credential.

---

## 🙌 Acknowledgements

Built with ❤️ by Kurtis

---

*Sparked by Aurora, united with Harmonia.*