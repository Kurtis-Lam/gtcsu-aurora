# Aurora — Student Union Candidate Cabinet Website

Official website for **Aurora**, the No. 1 candidate cabinet for the Student Union of G.T. (Ellen Yeung) College, 2026–27.

**Current version: v2.3.0** (see `public/js/info.js`)

A multi‑page, bilingual (English / Traditional Chinese) website with a static front end on Firebase Hosting and a serverless API on Vercel. Beyond the campaign pages it includes school‑account sign‑in, public news with email subscriptions, a protected photo gallery with traceable downloads, a feedback form with automated spam screening, a support counter, and an admin portal.

---

## ✨ Features

- **Bilingual interface** – Toggle between English and Traditional Chinese on every page; the choice is saved in `localStorage`. Content cross‑fades on switch and respects reduced‑motion settings.
- **Immersive design** – Looping video background, glass‑morphism cards, scroll‑reveal effects and a shared visual layer (`css/aurora-fx.css` + `js/fx.js`) with ripple and hover feedback. A **lite mode** switches off heavy effects automatically on low‑end devices, data‑saver mode, or when the visitor prefers reduced motion.
- **Shared navigation** – `panel.html` (navigation bar with an **Info** dropdown for Activities, Financial, Schedule and Welfare, the Photos and Feedbacks links, Google sign‑in, language and info buttons), `background.html` and `info.html` (the "About this site" popup showing the version and last‑updated time) are injected by `load-components.js`. Components are cached per release.
- **School‑account sign‑in** – Sign in with Google from any page. Only verified `@gtcollege.edu.hk` accounts count as signed in; other accounts are ignored rather than signed out.
- **Latest News** – Public bilingual announcements. Signed‑in school users can mark items as read (with an unread dot in the navigation), and are subscribed to announcement emails automatically; every email carries a signed one‑click unsubscribe link. Admins draft, translate (AI‑assisted), review, publish, edit and delete announcements, with a per‑article activity log.
- **Photo Gallery** – School‑account‑only gallery organised in folders and subfolders, with a lightbox, select‑all / multi‑select, and ZIP download. Images are served through an authenticated proxy (thumbnails and 1800px previews), never as public links. Every download requires accepting an audit notice, is recorded against the verified account, and carries an **invisible digital watermark** so a leaked image can be traced. Downloads are rate‑limited.
- **Feedbacks & Support** – Feedback requires a school account (title of at least 3 words, description of at least 20 words). Your name and school email are stored with the submission and are visible to Student Union administrators only; submissions are not published. Submissions are screened for spam and are rate‑limited. The support counter and FAQ sit on the same page.
- **Support Us counter** – Real‑time global counter with a 10‑minute cooldown per device and, when signed in, per account. To prevent abuse, each vote stores an encrypted IP address and device details for the school's records, readable only by authorised administrators.
- **Activities & Schedule** – Expandable activity cards (festive, regular, post‑exam, inter‑school) and a month‑by‑month calendar.
- **Welfare & Discounts** – Student benefits, merchant discounts and campus welfares.
- **Financial Transparency** – Full budget breakdown of planned activities and election expenses.
- **Admin portal** – Site analytics (page views, time on page, open/close logs), feedback inbox, supporter records, encrypted support logs, photo upload and folder management, photo‑download audit, news management and a read‑only list of current admins.

---

## 📄 Pages

| File | Description |
|------|-------------|
| `index.html` | Landing page with cabinet name, slogan and Instagram link. |
| `aboutus.html` | Vision, promotion video and cabinet member profiles. |
| `news.html` | Public bilingual announcements with read tracking. |
| `activities.html` | Detailed descriptions of all planned activities. |
| `financial.html` | Complete budget breakdown with itemised costs. |
| `schedule.html` | Month‑by‑month calendar of events for 2026–27. |
| `welfare.html` | Student welfare offers, merchant discounts and external benefits. |
| `photos.html` | Protected photo gallery (school account required). |
| `feedbacks.html` | Feedback form, FAQ and support counter. `/supportus` redirects to its support section. |
| `admin.html` | Admin portal (admin accounts only). |
| `security_report.html` | School security and operations report, served at `/report`. |

Shared fragments (not standalone pages): `panel.html`, `background.html`, `info.html`.

---

## 🧱 Tech Stack & Architecture

| Layer | Details |
|-------|---------|
| Front end | Plain HTML, CSS and JavaScript (ES modules), no build step. Served from `public/` by **Firebase Hosting** (clean URLs). |
| Auth & data | **Firebase Authentication** (Google) and **Cloud Firestore**. Access is enforced by `firestore.rules` (admin custom claim, verified school account, per‑user receipts). |
| API | Serverless functions in `api/` on **Vercel** (`gtcsu-aurora.vercel.app`), Node ≥ 20.3. |
| Images | **Cloudinary** (authenticated delivery) and **sharp** for the DCT‑based invisible watermark. |
| Email | **Nodemailer** over Gmail for news announcements. |
| AI assistance | **OpenRouter** for news translation and feedback spam screening. |

### API endpoints (`api/`)

| Endpoint | Purpose |
|----------|---------|
| `pageview` | Privacy‑conscious page analytics. |
| `support` | Support counter cooldown check and vote. |
| `feedback` | Validate, screen and store feedback. |
| `translate-news`, `publish-news` | Admin: AI translation, publish and email announcements. |
| `unsubscribe-news` | Signed email unsubscribe link. |
| `list-photos`, `photo-image`, `photo-download` | School accounts: gallery listing, image proxy, watermarked and audited download. |
| `sign-upload`, `delete-photo` | Admin: signed Cloudinary uploads and photo removal. |
| `list-admins` | Admin: list accounts with the admin claim. |

Shared helpers live in `api/_lib/` (auth, CORS and request guards, rate limiting, Firebase, photos, crypto, watermark).

---

## 🚀 Getting Started

```bash
# Front end only
python3 -m http.server 3000 --directory public
# or
npx serve public
```

Open <http://localhost:3000>. Pages must be served over HTTP; `file://` will not work.

Notes for local work:
- The front end talks to the production API set in `public/js/api-config.js`. The API only accepts known origins, so API‑backed features (feedback, support, photos, admin) may be refused from `localhost` unless the origin is added to `ALLOWED_ORIGINS` on a deployment you control.
- Google sign‑in needs `localhost` among the authorised domains of your Firebase project.
- To run the API, install dependencies with `npm install` and deploy to your own Vercel project.

### Environment variables (Vercel)

| Variable | Used for |
|----------|----------|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin access |
| `ANALYTICS_HMAC_SECRET`, `IP_HASH_SECRET` | Keyed hashing for analytics, rate limits and audit records (≥ 32 bytes) |
| `SUPPORT_ENCRYPTION_KEY` | AES‑256‑GCM encryption of support logs |
| `WATERMARK_SECRET` | Photo watermark (falls back to `ANALYTICS_HMAC_SECRET`) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Photo storage |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | News emails |
| `NEWS_UNSUBSCRIBE_SECRET` | Signing unsubscribe links |
| `OPENROUTER_API_KEY` | Translation and feedback screening |
| `ALLOWED_ORIGINS` | Extra comma‑separated CORS origins |

Never commit these values. See `CONTRIBUTING.md`.

### Maintenance scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `python3 scripts/update-csp-hashes.py` | Recompute CSP hashes for inline scripts and handlers and write them to `vercel.json` and `firebase.json`. **Run after editing any inline script or `on…` handler.** |
| `node scripts/set-admin-claims.js <email>` / `--revoke <email>` | Grant or revoke the admin claim (needs `credentials/service-account.json`). |
| `npm run extract-watermark -- <image> [--widths=…] [--local-env]` | Identify which download a leaked image came from. |
| `node scripts/upload-profiles.mjs <image>` | Upload a profile image to Cloudinary. |

---

## 🌐 Deployment

- **Firebase Hosting** – front end (`public/`), Firestore rules and indexes (`firebase.json`, `firestore.rules`).
- **Vercel** – serverless API (`api/`) and security headers (`vercel.json`).

Both configs ship a strict Content‑Security‑Policy; remember to refresh the hashes (see above) before deploying changes to inline scripts.

---

## 🔒 Privacy & Security

- Firestore rules deny everything by default; admin and school‑account checks are verified server‑side.
- Feedback, support votes and photo downloads record limited account, device and network details, stored in hashed or encrypted form, and are accessible only to authorised administrators and the school.
- Found a vulnerability? Please do **not** open a public issue. Use GitHub's private vulnerability reporting (the repository's *Security* tab) or contact the maintainer.

---

## 🙌 Credits

- **Contents:** Aurora Cabinet 2026–27 Vice President and Members
- **Development:** Kurtis ([@Kurtis-Lam](https://github.com/Kurtis-Lam))

---

## 📄 License

Released under the MIT License (see `LICENSE`).

The Aurora name, branding, member photos and campaign content belong to G.T. (Ellen Yeung) College Student Union Candidate Cabinet No. 1 – Aurora and are not covered by that license.

This website is operated by student members of the Cabinet Aurora and is not the official website, agent or representative of G.T. (Ellen Yeung) College.

---

## 📬 Contact & Contributing

For any enquiries, reach out via Aurora's Official Instagram [@gteyc_aurora2627](https://www.instagram.com/gteyc_aurora2627/) or email `kurtislam100@gmail.com`.

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first. Repository: <https://github.com/Kurtis-Lam/gtcsu-aurora>

---

*Sparked by Aurora, united with Harmonia.*