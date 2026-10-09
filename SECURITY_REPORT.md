# Aurora Website — Security, Photo Traceability & Incident Readiness Report

| | |
|---|---|
| **Project** | Aurora (G.T. (Ellen Yeung) College Student Union candidate cabinet, 2026–27) — `gtcsu-aurora` |
| **Report date** | 9 October 2026 |
| **Basis** | Static review of the uploaded source (`05281dc4-aurora.zip`: 12 API functions, Firestore rules, hosting/CSP config, all front-end pages). Nothing was deployed, probed or load-tested. |
| **Audience** | Aurora cabinet, Student Union (SU) advisors, school IT / teacher-in-charge |
| **Covers** | (1) Security & how it is maintained during the term · (2) Photo downloads with a digital footprint · (3) Likely risks and what to do about them |

> **How to read the tags.** Statements are tagged **[Verified]** when I confirmed them in the code, **[Doc]** when confirmed in vendor documentation, and **[Recommend]** when they are my suggestion. Anything I could not confirm from the files (for example, whether TTL is actually switched on in the Firebase Console) is listed in Appendix G.

---

## 0. Executive summary

**Overall.** The site is built with more security discipline than a typical student project. Authorization is enforced on the server and in Firestore rules (not in the browser), admins use a trusted custom claim, photos are never exposed through public URLs, and every photo download is individually watermarked and logged server-side.

**On the SU's request (photo download with traceability).** The system already does the core of it: each download carries a visible watermark (masked school email + Hong Kong time + a unique reference), and a matching record (full email, UID, photo, time, hashed IP, browser/device class) is stored where only admins can read it. If someone posts a downloaded photo with the watermark intact, the person can be identified in minutes.

**The honest limit.** The current watermark is *visible only*, small, and in one place on the image. A person who edits a photo maliciously will usually crop, paint over, or AI-erase it first — which is exactly the case the school is worried about. So today's tracing is strong against *casual leaking*, and weak against a *determined bad actor*. The most valuable upgrade is an **invisible per-download watermark** plus a few cheap hardening steps (Section 3.5). Even with those, no technology can guarantee tracing after heavy editing or a screenshot; the school should pair the tech with a **download agreement and a disciplinary process** (Section 3.6).

### Top 8 actions (details in Section 5)

| # | Action | Why | Effort |
|---|---|---|---|
| 1 | **Watermark the 600 px preview images too** (or stop serving them unmarked) | Any signed-in student can currently save an untraceable 600 px copy of every photo | Low |
| 2 | **Add a tiled/repeated visible watermark** and make it larger | One small centred label is trivial to crop out | Low |
| 3 | **Add an invisible (robust) watermark** carrying the download reference | Survives resize/recompression; survives light edits; helps when the visible mark is removed | Medium |
| 4 | **Lower the download quota** (now 120/hour, 500/day per account) and alert on bulk behaviour | Current limits allow one account to pull an entire album in minutes | Low |
| 5 | **Check the 4.5 MB response limit** on `/api/photo-download` | Vercel rejects responses above 4.5 MB **[Doc]**; a 3000 px JPEG at quality 88 can exceed it, so some downloads may fail | Low |
| 6 | **Use `checkRevoked: true`** on photo and admin endpoints; revoke tokens when offboarding | Disabled accounts / removed admins keep working for up to ~1 hour | Low |
| 7 | **Add Subresource Integrity (SRI) or self-host** JSZip and Chart.js | Third-party CDN scripts are allowed by the CSP and loaded without integrity checks | Low |
| 8 | **Transfer ownership to the school/SU** (Vercel, Firebase, Cloudinary, Gmail, domain) and write a handover | The whole system currently depends on one developer's accounts | Low–Medium |

---

## 1. System overview

```
 Student / visitor browser
        │  HTTPS (HSTS, CSP, X-Frame-Options: DENY …)
        ▼
 Firebase Hosting (static pages)          Firebase Auth (Google sign-in, school domain)
        │                                         │ ID token (JWT)
        │  fetch(API, Authorization: Bearer …)    │
        ▼                                         ▼
 Vercel Functions (/api/*)  ──── verifies token ──┘
        │            │               │
        │            │               └─► Cloudinary  (private "authenticated" images, watermark)
        │            └─► OpenRouter (AI spam check on feedback; admin-only translation)
        ▼
 Firestore (rules = second line of defence) · Gmail SMTP (news emails)
```

| Component | Role | Holds sensitive data? |
|---|---|---|
| Firebase Hosting | Serves static HTML/JS | No |
| Firebase Auth | Sign-in with Google; custom claim `admin: true` for admins | Emails, UIDs |
| Firestore | Feedback, supporters, news, subscriptions, photo metadata, **download audit log** | **Yes** |
| Vercel Functions | All privileged actions (12 endpoints) | Secrets in env vars |
| Cloudinary | Stores original photos privately (`type: authenticated`) | **Yes** (originals) |
| OpenRouter | Third-party LLM calls (feedback moderation, translation) | Feedback text leaves the school's control |
| Gmail (App Password) | Sends announcement emails | Subscriber emails |

**Roles.** *Anonymous visitor* → public pages, anonymous feedback, support counter. *School user* → verified `@gtcollege.edu.hk` Google account → news receipts, subscription, photo gallery (previews), watermarked downloads. *Admin* → school user (or other Google account) with the `admin` claim → analytics, feedback inbox, supporters, news, photo upload/delete, download audit.

---

## 2. Part 1 — Security: defence mechanisms and how safety is maintained

### 2.1 Defence in depth (what exists today)

| Layer | Control | Where | What it stops |
|---|---|---|---|
| **Transport** | HTTPS only; HSTS 1 year incl. subdomains; `upgrade-insecure-requests` | `vercel.json`, `firebase.json` | Downgrade / sniffing |
| **Browser hardening** | CSP (no `script-src 'unsafe-inline'`, hash-based), `frame-ancestors 'none'` + `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, camera/mic/geolocation disabled, COOP | Both config files | XSS, clickjacking, MIME confusion, data leakage via referrer |
| **Authentication** | Google sign-in; server verifies ID token, `email_verified`, provider `google.com`, and exact domain regex `@gtcollege.edu.hk` | `api/_lib/auth.js`, `firestore.rules` (`isSchoolUser`) | Outsiders, look-alike domains, unverified emails (the `hd` hint is not relied on) **[Verified]** |
| **Authorization** | Admin = custom claim `admin: true` **and** verified email; claims granted only through a private script using the service account | `firestore.rules` (`isAdmin`), `scripts/set-admin-claims.js` | Hard-coded admin emails; self-promotion |
| **Firestore rules** | Default-deny (unmatched collections are closed); sensitive collections (`feedbacks`, `supporters`, `pageviews`, `galleryImages`, logs, rate limits) are admin-only or `write: false`; strict field allow-lists for `newsReads` and `newsSubscriptions` | `firestore.rules` | Direct database tampering from a browser **[Verified]** |
| **Server-side writes** | Feedback, support votes, analytics, download logs are written only by backend code | `api/*.js` | Forged votes/logs from the console |
| **CORS** | Allow-list of origins (Firebase hosting domains, localhost, `ALLOWED_ORIGINS`) | `api/_lib/http.js` | Other websites calling the API from a visitor's browser |
| **Photo protection** | Originals uploaded as `authenticated`; browsers never receive Cloudinary URLs or public IDs; previews proxied with `no-store`; only admins can fetch the 1800 px view; students get 600 px | `api/photo-image.js`, `api/_lib/photos.js`, `api/sign-upload.js` | Hot-linking, URL guessing, bulk scraping of originals |
| **Traceable downloads** | Per-download watermark + server-side audit log | `api/photo-download.js` | Anonymous leaking (see Part 2) |
| **Abuse limits** | Feedback 5/hour/account, 30/hour/IP; support vote cooldown 10 min (device + account + IP); analytics 240/hour/IP; downloads 120/hour & 500/day/account | `api/*.js` | Spam, vote stuffing, scraping |
| **Input handling** | Body-size cap (256 KB), regex-validated IDs, HTML escaping in news/photos/admin rendering, CSV formula-injection guard in the audit export | `api/_lib/http.js`, pages | Injection, malformed input |
| **Content moderation** | AI spam filter on feedback with local fallback; treats submission as untrusted data | `api/feedback.js` | Spam/gibberish; prompt-injection only affects the spam verdict |
| **Data minimisation** | IPs stored only as keyed HMAC hashes; no exact location/full user-agent; TTL on audit logs (365 days) and rate-limit docs (90 days) | `api/_lib/http.js`, `firestore.indexes.json` | Excess personal data |
| **Email safety** | Signed unsubscribe tokens (HMAC, timing-safe compare), `List-Unsubscribe` headers, idempotent delivery records | `api/publish-news.js`, `api/unsubscribe-news.js` | Forged unsubscribes, duplicate sends |

### 2.2 How security is maintained during the term (operating routine)

Technical controls decay unless people maintain them. **[Recommend]** adopt this routine and name an owner for each line.

| When | Task | Owner |
|---|---|---|
| **Before launch** | Run the checklist in Appendix B (env vars, secrets, TTL active, CORS, rules deployed, admin list, 2-Step Verification) | Developer + IT |
| **Before launch** | Test photo flow with a dummy account: preview, download, audit-log entry, delete, rate limit | Developer |
| **Weekly** | Read the **Photo Downloads** tab: unusual spikes, one account downloading many photos, many failed attempts | Admin on duty |
| **Weekly** | Check Vercel, Firebase and Cloudinary usage dashboards against free-tier limits | Developer |
| **Monthly** | **Access review**: open the Admins tab (`/api/list-admins`); remove anyone who no longer needs access (`--revoke`) | Cabinet lead |
| **Monthly** | `npm audit`; update `firebase-admin`, `cloudinary`, `nodemailer`; redeploy | Developer |
| **Each publish** | Two-person check on news before **Publish** (emails cannot be recalled) | Two admins |
| **After any admin change** | Revoke old sessions, have the admin sign in again | Developer |
| **Quarterly** | Rotate secrets (Appendix F) and run a short incident drill (e.g. "an admin phone is stolen") | Developer + advisor |
| **End of term** | Handover & decommission checklist (Section 4, risk P) | Outgoing + incoming leads |

**Admin hygiene rules** (put these in a one-page "Admin Code of Conduct"): use a school or dedicated Google account; **2-Step Verification mandatory** (the application cannot enforce or verify this — it must be enforced in Google Workspace and checked by the owner, as the README itself states); never log in on shared or public computers; never export the audit CSV to personal cloud storage or chat; do not forward feedback or download logs; report a lost device within one hour.

### 2.3 Findings from the code review

Severity reflects likelihood × impact for a school-scale deployment. Evidence is given by file so each can be checked.

| ID | Sev. | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| **S1** | **High** | **600 px previews are served without any watermark or logging.** Any school user can save the blob/preview (right-click or DevTools network tab) for every photo with no trace. It is low-resolution, but enough for memes, profile pictures and edits. | `api/photo-image.js` (variant `thumb` for school users), `api/_lib/photos.js` (`fixedTransformation`: resize only) | Apply a tiled "AURORA · school use only" watermark to cached thumbnails; log preview requests in aggregate (per account per hour); consider 400 px. |
| **S2** | **High** | **Visible watermark is weak against editing**: single label, 24 px type, white at 58 % opacity, one position, on a 3000 px image. Easy to crop, clone out or AI-inpaint. | `api/_lib/photos.js` lines ~97–111 | Tile it (3–5 positions incl. near edges), scale type with image width, add dark outline for contrast on bright areas; add invisible mark (Section 3.5). |
| **S3** | **Medium** | **Download quota is generous**: 120/hour, 500/day per account. A single compromised or malicious account can pull a whole album. Each download also costs Cloudinary credits (upload + transform + delete). | `api/photo-download.js` line 53 | Suggest 30/hour and 100/day; alert at ≥ 50 in a day; raise only on request. |
| **S4** | **Medium** | **Possible 4.5 MB response-limit failures.** Vercel Functions cap request/response bodies at 4.5 MB (413 `FUNCTION_PAYLOAD_TOO_LARGE`) **[Doc: vercel.com/docs/functions/limitations]**. The download returns a 3000 px, quality-88 JPEG; detailed photos can exceed that. | `api/_lib/photos.js` (`width: 3000`, `quality: 88`), `api/photo-download.js` | Test with your largest photos. If any fail: reduce width (2400 px) / quality (80–82), or auto-retry at lower quality when bytes > 4.2 MB. |
| **S5** | **Medium** | **Token revocation is not checked.** `verifyIdToken` is called without `checkRevoked`, so a disabled student or an admin whose claim was removed can still act until the ID token expires (up to ~1 hour). | `api/_lib/auth.js` line 16; `api/support.js` line 46; `api/photo-download.js` line 78 | Use `verifyIdToken(token, true)` on admin and photo endpoints; call `revokeRefreshTokens(uid)` when removing an admin. |
| **S6** | **Medium** | **CDN scripts loaded without SRI**, and the CSP trusts those CDNs. If the CDN or package is compromised, malicious code runs in the page — including the admin page. | `public/photos.html` (JSZip from cdnjs), `public/admin.html` (Chart.js from jsDelivr); `vercel.json` / `firebase.json` CSP | Self-host both libraries (preferred; then drop the CDN hosts from `script-src`) or add `integrity=` + `crossorigin`. |
| **S7** | **Medium** | **Audit retention is 365 days only.** If a malicious edit surfaces after the logs expire, the trail is gone. The same collection holds full emails for a year. | `api/photo-download.js` line 119; `firestore.indexes.json` | Keep 365 days by default, but allow a "legal hold": a flagged incident copies relevant log rows to a separate restricted record. Confirm retention with the school's data policy. |
| **S8** | **Medium** | **Several collections have no TTL**: `pageviews` (can carry `userEmail`), `rateLimits`, `analyticsRateLimits`, `newsDeliveries` (stores emails), `supporters` (stores emails). Personal data accumulates after the term. | `firestore.indexes.json` (TTL only on two collections) | Add TTL/expiry fields or a scheduled clean-up; define retention per collection (Appendix A). |
| **S9** | Medium | **Admin actions on photos are not audited** (upload, delete, folder changes). News has an activity log; photos do not. An insider could delete evidence photos or upload inappropriate ones with no record. | `api/delete-photo.js`, admin upload code | Write an `adminAuditLog` entry (who, what, when) from the server for upload/delete. |
| **S10** | Low–Med | **Anonymous-feedback and support endpoints can be scripted.** Feedback is limited by hashed IP (30/h); support votes by random device id + IP + account. Rotating IPs/proxies can inflate the public support counter. | `api/feedback.js`, `api/support.js` | Treat the counter as indicative; admin tools already allow deletion and correction. Add Firebase App Check or a CAPTCHA if abuse is seen. |
| **S11** | Low–Med | **Feedback text is sent to third-party AI providers** (OpenRouter → Google/OpenAI) for spam checks, including text students may consider private. | `api/feedback.js` (`MODERATION_ATTEMPTS`) | Add a plain-language notice on the form; do not send identity; consider local-only checks if the school objects. |
| **S12** | Low | **Debug/verbose logging in production**: logs the first 8 characters of the OpenRouter key and the user's email; a `BUILD = 'debug-…'` marker is stored on every feedback record. | `api/feedback.js` lines 9, 58, 310 | Remove the key prefix; stop logging emails; drop the debug tag when stable. |
| **S13** | Low | **No `.gitignore` and no `.env.example`** in the package, although the README refers to `.env.example`. The repository is public (CONTRIBUTING links GitHub). `.DS_Store` files and the `.vercel/` folder are present. | project root | Add `.gitignore` (`.env*`, `.vercel`, `.DS_Store`, `*serviceAccount*.json`); add `.env.example` with names only; run a secret scan (e.g. gitleaks) over full git history. |
| **S14** | Low | **Gmail SMTP for news**: personal Gmail accounts have a daily sending cap (commonly cited as ~500 recipients/day), so a large school list may be partly deferred; spoofing/phishing by look-alike senders is also possible. | `api/publish-news.js` | Check subscriber count vs. cap; prefer a school Google Workspace sender; add SPF/DKIM/DMARC if a custom domain is used; teach students what real Aurora emails look like. |
| **S15** | Low | **Firebase web API key is public by design** (acceptable), but it is worth restricting. | `public/js/firebase-config.js` | In Google Cloud Console restrict the key to your site referrers; enable Firebase App Check for Auth/Firestore; check "Authorized domains". |
| **S16** | Info | **12 functions = Vercel Hobby plan ceiling** (comment in `api/pageview.js`). Adding endpoints will require merging or upgrading. | `api/` | Plan before adding new features (e.g. watermark verification endpoint). |
| **S17** | Info | **Hobby plan terms**: Vercel's Hobby tier is for non-commercial use; a student-union site is likely fine, but confirm. | n/a | — |

**What I checked and found sound** **[Verified]**: school-domain check is done server-side and in rules with an anchored regex; admin check cannot be spoofed from the browser (the server asks Firestore, using the caller's own token, whether the rules allow reading an admin-only document); IDs are pattern-validated before use (no path traversal into Firestore/Cloudinary); user-supplied text is escaped before it is placed in HTML (news, photos, admin lists, emails); `Content-Disposition` filenames are sanitised; temporary watermark assets are created as `authenticated` and deleted afterwards; email unsubscribe tokens are HMAC-signed and compared in constant time; audit logs cannot be written or edited from a browser.

---

## 3. Part 2 — Photo sharing with a digital footprint

### 3.1 The requirement and what is realistic

> *The SU wants to publish photos for students to download. The school wants a digital footprint so that if someone maliciously edits a photo online, the downloader can be traced.*

Two different guarantees are involved:

1. **Accountability for the download** — "who obtained this file, and when?" This can be made **very reliable** (the server decides who gets a file and records it).
2. **Link from an edited image on the internet back to a download** — "this meme came from that download." This works only if the *mark survives the edit*. It is **best-effort, never guaranteed**: screenshots, a phone camera pointed at a screen, heavy cropping, AI inpainting or regeneration can all remove marks.

The design goal is therefore **deterrence plus evidence**: make tracing likely enough, and publicly known enough, that students think twice — and give the school solid evidence when a mark does survive.

### 3.2 How it works today **[Verified]**

1. Student signs in with the school Google account.
2. Gallery list (`/api/list-photos`) returns only safe metadata; previews come through `/api/photo-image` (600 px, `no-store`).
3. Student selects photos and clicks **Download (ZIP)**. The browser requests each photo from `/api/photo-download` one by one and zips them locally.
4. For every photo the server: checks the token and the quota → creates a unique `downloadId` (UUID) → asks Cloudinary to render a ≤ 3000 px JPEG with the text `AURORA | k******m@gtcollege.edu.hk | 2026-10-09 15:42:10 HKT | REF A1B2C3D4` → fetches the bytes → **deletes the temporary asset** → writes the audit record → returns the file.
5. The audit record (`photoDownloadLogs`, admin-readable only) stores: server time (HKT), **full email**, UID, display name, photo ID/title/folder, `downloadId` and `watermarkRef` (first 8 characters), batch ID, output size/format, browser and device class, **keyed hash of IP** (if configured), status. Aggregates (`photoDownloadStats`, `photoDownloadUsers`) feed the admin dashboard and CSV export. Records expire after 365 days.

### 3.3 How to trace a suspicious image (investigation procedure)

Use this when someone reports a maliciously edited photo.

| Step | Action |
|---|---|
| 1 | **Preserve evidence first.** Save the post URL, screenshots with date/time, account name, and download the image file itself if possible. Do not engage with the poster. |
| 2 | **Look for the visible mark** (zoom in; check edges, corners, shadows; try raising contrast). If the line `AURORA \| … \| REF XXXXXXXX` is readable, note the **REF** and masked email. |
| 3 | In **Admin → Photo Downloads**, search the REF (or masked email/time). If the record is older than the 500 newest events shown in the UI, query `photoDownloadLogs` in the Firebase Console on `watermarkRef`. |
| 4 | **Cross-check**: the record's photo ID/title must match the original photo that was altered; the HKT time should precede the first appearance of the post. |
| 5 | **Consider alternative explanations** before concluding (Section 3.6, "fairness"): shared or compromised account, account used on a library computer, photo forwarded by the downloader to friends. |
| 6 | **Escalate to the school** (teacher-in-charge/discipline team) with the evidence pack: screenshots, the log row (export only that row), the original photo. The SU does not itself punish. |
| 7 | **Contain**: request take-down from the platform; if the account is implicated, temporarily disable it via Firebase Auth (and revoke tokens) *on the school's instruction*. |
| 8 | **Record** the incident (Appendix C) and apply a **legal hold** to the related log rows so TTL cannot delete them. |
| 9 | **If the visible mark was removed**: the image may still carry an invisible mark (once implemented, Section 3.5, tier B) — send it for decoding; otherwise the downloader cannot be proven, and the case rests on circumstantial evidence only. |

### 3.4 Limitations (be explicit with the school)

- **A log row means "the server produced the file", not "the person saved or posted it"** (also stated in the README).
- **Visible marks can be removed.** Today's mark is easy to remove (finding S2).
- **Unmarked previews exist** (finding S1). Edits based on a preview are currently untraceable.
- **Screenshots / screen recordings / phone photos of the screen** bypass server-side marks unless the mark is visibly overlaid on the preview too.
- **Account sharing / compromise** attributes the download to the wrong person. A shared Google password or a stolen session looks identical in the log.
- **Masked email on the image** is deliberate (privacy), so the REF and the server log are the real key — the log must therefore be retained and protected.
- **Only the 500 newest events** are shown in the admin UI table; older ones need the Firebase Console.
- **Retention is 365 days** (finding S7).
- **AI regeneration** ("make a new image in the style/likeness of this photo") produces content that carries none of the original's marks. Technology cannot trace that; policy and platform reporting must.

### 3.5 Recommended improvements (tiered)

**Tier A — quick wins (hours to a day)**

1. **Watermark previews** (S1): tiled, semi-transparent "AURORA · for school use" on the 600 px thumbnails; optionally a short per-session code.
2. **Strengthen the visible mark on downloads** (S2): repeat the line at several positions and along the bottom edge; font size relative to width (≈ 1.2–1.6 % of width); thin dark outline so it is readable on bright and dark areas; keep REF visible in two places.
3. **Lower quotas and add alerts** (S3): 30/hour, 100/day; weekly review of top downloaders.
4. **Embed metadata** in each JPEG (EXIF/XMP `Copyright`, `Source`, and the REF). Many platforms strip this, but it survives direct sharing of files, so it costs little. (Verify Cloudinary preserves your fields, or add them server-side with an image library.)
5. **Fix payload size** (S4) and **revocation checks** (S5).
6. **Hash the issued file**: store a SHA-256 and a **perceptual hash** (e.g. pHash/dHash) of each delivered JPEG in the audit record. A perceptual hash lets you confirm that a suspicious image is derived from a specific *original photo* even after resizing/recompression. It identifies the photo, not the person — the person is identified by the mark.

**Tier B — invisible per-download watermark (about 2–5 days; recommended)**

7. Embed the 32-bit REF (or a 64-bit ID) invisibly using a frequency-domain method (e.g. DWT/DCT, with error-correcting code) before returning the file. This survives typical JPEG recompression, mild resizing and many filters; it is **not** guaranteed to survive heavy crops, rotation or AI inpainting.
   - Implementation options: a small image-processing step inside the function using `sharp` plus a DCT/DWT embedding routine, **or** a separate Python function using an invisible-watermark library. Note the 12-function limit on Vercel Hobby (S16) and the 4.5 MB payload limit (S4).
   - **Validate before relying on it**: generate 20 test images, apply typical abuse (resize 50 %, JPEG 60, crop 70 %, screenshot, Instagram upload, brightness/contrast) and measure the decode rate. Report the measured rate to the school; do not claim it is "unremovable".
   - Add an **admin-only "Decode image"** tool (upload suspicious image → returns REF candidates) so staff do not need developer help.

**Tier C — structural (optional / larger)**

8. **View-only mode for most photos** (preview with visible mark) and **download on request** for only the selected "best" photos — reduces the attack surface.
9. **Time-limited gallery**: albums auto-hide after a set number of weeks.
10. **Per-album "no download" flag** for sensitive events (e.g. photos with identifiable minors).
11. **Face-blur or consent flags** for students who opt out (see 3.7).
12. **Anomaly alerts** by email/Slack to the admin on duty (e.g. > 50 downloads/day from one account, or a new account suddenly downloading everything).

### 3.6 Policy: tracing needs rules people agreed to

Technology identifies *who downloaded*; the school decides *what is acceptable and what follows*. **[Recommend]** before launch:

1. **Download agreement** shown before the first download (checkbox, stored with a timestamp): photos are for personal, non-commercial use; no editing that misrepresents, humiliates or harasses; no re-publishing of other people; downloads are logged and watermarked with the downloader's account details.
   *Draft wording (adjust with the school):* "These photos are provided by the Student Union for personal memories. Each download is watermarked and logged with your school account and the time. Do not edit, alter or share photos in a way that embarrasses, harasses or misrepresents anyone. Misuse may lead to school disciplinary action."
2. **Consequence ladder** owned by the school (warning → parent contact → suspension of gallery access → disciplinary measures), applied by teachers, not by the SU.
3. **Fairness rules for attribution**: a log match is *evidence*, not *proof*. Give the student an opportunity to respond; check for shared/compromised accounts; consider that a classmate may have received the photo from the downloader.
4. **Who may see the audit log**: named admins only, a short list, with access reviewed monthly (Section 2.2). Log exports are sensitive personal data.
5. **Notice to students** (privacy notice) describing what is logged, why, who sees it, and for how long.
6. **Take-down channel**: a visible contact for "please remove my photo" (Section 4, risk L).

### 3.7 Privacy and legal considerations (not legal advice)

Hong Kong's Personal Data (Privacy) Ordinance (PDPO) applies to the personal data in these logs. In plain terms the six Data Protection Principles ask for: collecting only what you need and telling people why (DPP1); keeping data accurate and **not longer than necessary** (DPP2); using it only for the stated purpose (DPP3); securing it (DPP4); being open about your practices (DPP5); and letting people access/correct their data (DPP6). Applied here:

- Collection notice at sign-in/first download (purpose: security, accountability, abuse handling).
- Retention: justify 365 days or shorten; delete after the term for non-incident records (S7, S8).
- Purpose limitation: do not reuse download logs for marketing or election analytics.
- Security: restricted access, MFA, no casual exports (Section 2.2).
- **Cross-border/third-party processing:** Cloudinary, Vercel, Firebase and OpenRouter process data outside Hong Kong; mention this in the notice (S11).
- **Photos of students (many are under 18):** confirm the school's photography/consent policy and whether parental consent is needed for publication; support opt-out and take-down.
- **Doxxing:** posting a person's personal data to harass them can be an offence under the PDPO following the 2021 amendments; relevant if a student's identity from the logs is exposed. Never publish log details.
- Ask the school's legal adviser / data protection officer to review the notice and retention periods before launch.

---

## 4. Part 3 — Likely risks and how to handle them

### 4.1 Risk register (summary)

| ID | Risk | Likelihood | Impact | Existing mitigation | Priority gap |
|---|---|---|---|---|---|
| A | Malicious edit / misuse of a photo | **High** | High | Watermark + audit log | S1, S2, invisible mark |
| B | Admin account takeover (phishing, stolen device) | Medium | **Very high** | Custom claim; server checks | Enforce 2SV; `checkRevoked`; admin audit (S5, S9) |
| C | Student account compromised or shared → wrong attribution | Medium | Medium | Domain check | Education; fairness rules; alerts |
| D | Secret/credential leak (service account, API keys, App Password) | Medium | **Very high** | Env vars; README warnings | `.gitignore`, secret scan, rotation drill (S13) |
| E | Defacement / hijack of hosting, DNS or deployment | Low–Med | High | Static hosting, headers | 2SV on all provider accounts; protected branch |
| F | Traffic spike / DDoS / free-tier quota exhaustion | Medium | Medium | Rate limits | Monitoring + budgets; fallback page |
| G | Vote-stuffing of the Support counter / spam feedback | **High** (election) | Medium | Cooldowns, AI filter | App Check/CAPTCHA if abused |
| H | Harmful feedback: threats, bullying, **self-harm disclosure**, allegations | Medium | **High** | Admin-only inbox | Triage protocol (below) |
| I | Personal data breach (logs, CSV, emails) | Low–Med | High | Admin-only collections | Export discipline; retention |
| J | Wrong/premature announcement emailed; phishing look-alikes | Medium | Medium | Two-step publish workflow | Two-person rule; sender hygiene |
| K | Election-period disputes: impersonation, false claims, content complaints | Medium | Medium–High | Single official site | Official-channel statement; evidence kit |
| L | Photo take-down request / inappropriate photo uploaded | **High** | Medium | `delete-photo` with CDN invalidation | SOP + SLA |
| M | Provider outage (Firebase/Vercel/Cloudinary/OpenRouter) | Medium | Low–Med | Static pages independent of API | Status page + comms plan |
| N | Single point of failure: developer unavailable | **High** (over a year) | High | README | Second owner; handover pack |
| O | Insider misuse (admin leaks photos, reads/forwards feedback) | Low–Med | High | Admin-only; claim | Admin audit log; code of conduct |
| P | End-of-term data and access clean-up | Certain | Medium | — | Checklist (below) |
| Q | Third-party script compromise (CDN) | Low | High | CSP | SRI / self-host (S6) |
| R | Content/legal: copyright (music, images), minors' images, defamation | Medium | Medium | — | Review checklist |

### 4.2 Playbooks

Each playbook follows **Detect → Contain → Investigate → Recover → Learn**. Keep names/phone numbers of the people filling each role on a one-page contact sheet (Appendix C).

**Incident roles.** *Incident lead* (cabinet lead), *Technical lead* (developer), *School liaison* (teacher-in-charge), *Comms* (spokesperson; only one person speaks publicly).

---

#### A. A downloaded photo is maliciously edited or misused online

- **Detect**: report from students/teachers/parents; social media monitoring of the cabinet's name and official Instagram mentions.
- **Contain (first hour)**: take screenshots/URLs (evidence), report the post to the platform (harassment/impersonation/privacy), tell the affected student support from the school; **temporarily switch the affected album to view-only** (or remove it).
- **Investigate**: follow the tracing procedure in Section 3.3; place a legal hold on matching log rows.
- **Recover**: school-led disciplinary process; support for the person depicted; remind students of the download agreement.
- **Learn**: did the visible mark survive? Was a preview used? Update watermarking (tier A/B).
- *Never*: publicly name a suspect; share log details beyond the school's disciplinary team.

#### B. Admin account compromised or admin device lost

- **Signs**: unknown sign-in in Google "Security" page, unexpected news published, photos deleted/uploaded, new admin claims, unusual downloads.
- **Contain (minutes)**: Technical lead runs `node scripts/set-admin-claims.js --revoke <email>`; in Firebase Console → Authentication, **disable** the user and **revoke refresh tokens**; the affected person changes their Google password and removes unknown devices/sessions.
- **Investigate**: Admin → Photo Downloads and news activity log (what was read/changed); Vercel function logs; Firebase Auth "last sign-in"; check `feedbacks` access exposure.
- **Recover**: restore deleted photos from backup (see "Backups" in Appendix B); retract wrongful news (and send a correction email); re-enable access only after 2SV is confirmed.
- **Notify**: school liaison; if feedback/emails were accessed, treat as data breach (risk I).
- **Learn**: add an admin audit log (S9), enable `checkRevoked` (S5).

#### C. Student account compromised, or sharing of passwords

- **Signs**: downloads at odd hours/locations (device/browser class changes), user says "I didn't do that".
- **Contain**: school IT resets the Google password and signs out sessions; disable the account in Firebase Auth if needed.
- **Handle fairly**: do not treat the log as proof against the student; mark affected download rows as "disputed" in the incident record.
- **Prevent**: school-enforced 2SV for student accounts if possible; short advice sheet on account safety.

#### D. A secret is leaked or suspected leaked

Secrets: `FIREBASE_SERVICE_ACCOUNT`, `CLOUDINARY_API_SECRET`, `GMAIL_APP_PASSWORD`, `OPENROUTER_API_KEY`, `ANALYTICS_HMAC_SECRET`, `IP_HASH_SECRET`, `NEWS_UNSUBSCRIBE_SECRET`.

- **Contain**: **rotate at the provider immediately** — removing a secret from code does not invalidate it (the README says the same). Then update the Vercel environment variable and **redeploy** (variables apply to new deployments only).
- **Impact of rotating** (Appendix F): `ANALYTICS_HMAC_SECRET` invalidates in-flight analytics tokens **and changes per-account hashes used for the download quota and "unique accounts" counter**; `IP_HASH_SECRET` breaks continuity of IP hashes and support/feedback cooldown keys; `NEWS_UNSUBSCRIBE_SECRET` invalidates old unsubscribe links in sent emails.
- **Investigate**: how it leaked (public repo, chat, screenshot, log); check provider usage logs for abuse; for the service account, review Firestore/Auth activity.
- **Recover & learn**: `.gitignore`, secret scanning (S13), remove key prefixes from logs (S12); if the Git history contained the secret, treat it as permanently exposed.

#### E. Website defaced, hijacked, or an unauthorised deployment

- **Signs**: unexpected content, redirect, new deployment you did not make, DNS change.
- **Contain**: roll back in Vercel (promote previous deployment) and Firebase Hosting (`firebase hosting:clone` / previous release); rotate provider passwords; revoke tokens/API keys; remove unknown collaborators on GitHub/Vercel/Firebase.
- **Communicate**: short notice on the official Instagram: "site temporarily unavailable; no action needed by users unless told".
- **Prevent**: 2SV on GitHub, Vercel, Firebase, Google, domain registrar; protected `main` branch with required review; minimal collaborators; deploy keys not personal tokens.

#### F. Traffic spike, attack or quota exhaustion

- **Signs**: slow pages, 429/5xx, provider email about limits (Firebase, Vercel, Cloudinary credits, OpenRouter balance, Gmail send cap).
- **Contain**: enable provider-level protection (e.g. Vercel firewall/rate limiting where available); temporarily disable heavy features (photo downloads; AI moderation falls back to local checks automatically; announcements can be retried later).
- **Recover**: raise limits or upgrade for the election week; cache aggressively static content.
- **Prevent**: set budget/usage alerts at 50/80 %; avoid a burst by announcing photo release times (a ZIP of 50 photos = 50 transformations).

#### G. Support counter inflated / feedback spam

- **Signs**: sudden jump in count; identical feedback; one IP hash with many events.
- **Respond**: use the admin Supporter list to delete suspect records (the counter adjusts); tighten limits; add CAPTCHA/App Check; add a footnote that the counter is indicative.
- **Why it matters**: opponents or pranksters can undermine credibility during the election — document your counter-measures so you can show good faith.

#### H. Harmful or sensitive feedback (threats, bullying, self-harm, allegations)

The anonymous feedback inbox can receive messages that are not "feedback" at all. Prepare in advance:

- **Define a triage rule** (printed next to the inbox): *Any message mentioning self-harm, suicide, abuse, violence, or a named person at risk → treat as urgent, same day.*
- **Do not reply publicly; do not investigate yourselves.** Pass to the **school social worker / counsellor / teacher-in-charge** with the text (not the whole inbox). Anonymous messages cannot be traced by the system (anonymous mode stores no identity), so the school decides how to respond — e.g. a general wellbeing reminder.
- **If the sender is named** (non-anonymous mode), the school liaison contacts the student privately.
- **Add helpline information** to the feedback page (confirm numbers before printing): e.g. Suicide Prevention Services, Samaritan Befrienders Hong Kong, The Samaritans (Hong Kong), Hospital Authority Mental Health Direct; in an emergency, **999**.
- **Allegations against staff/students**: do not publish; do not forward widely; send to the school liaison. Delete from the inbox only after the school has the record.
- **Admin wellbeing**: reading distressing messages is hard; share load and debrief.

#### I. Personal data breach (logs, CSV exports, subscriber lists)

- **Contain**: identify what, how many people, who had access; stop the leak (revoke link/files, rotate secrets, remove access); do not circulate the data further while investigating.
- **Assess**: types of data (email addresses, names, download history, feedback identities), likelihood of harm to students.
- **Notify**: school liaison/data protection officer; consider notifying affected students and the Office of the Privacy Commissioner for Personal Data (PCPD) as guided by the school's policy and legal advice. (I could not confirm the current mandatory/voluntary status of breach notification under the PDPO; confirm with the school.)
- **Prevent**: no exports to personal devices; passwords/links to shares expire; retention (S8).

#### J. Wrong or premature announcement emailed; look-alike phishing

- **Wrong announcement**: you cannot recall emails. Immediately **unpublish** (set `deleted`/draft in admin), send a short correction email, and post on Instagram. Prevent with a **two-person rule** and a review checklist (names, dates, facts, links, no confidential details).
- **Phishing look-alikes** ("Aurora giveaway – log in here"): tell students that Aurora **never asks for passwords**, only links to `gtcsu-aurora.web.app` (and the official Instagram). Keep the legitimate sender address constant; consider SPF/DKIM/DMARC with a custom domain.

#### K. Election-period disputes, impersonation, false claims

- Keep **one list of official channels**: website, Instagram `@gteyc_aurora2627`, sender email. Report fake accounts to the platform with screenshots.
- Keep an **evidence kit** (dated screenshots, archived copies) of false claims; respond calmly and factually; escalate to the **Election Committee/teacher** rather than debating in public.
- Check campaign content against election rules (spending, claims, mentions of other cabinets). The Financial page is public — ensure figures match the official submission.

#### L. Photo take-down request / inappropriate photo uploaded

- **SLA** (suggest): acknowledge within 24 h, remove within 48 h; faster if the photo is sensitive.
- **Steps**: Admin → Photos → delete (this destroys the Cloudinary original with CDN invalidation and clears derived cache; `api/delete-photo.js`); record who asked, which photo, when, who removed it.
- **Limit**: copies already downloaded cannot be recalled; say so honestly, and use the audit log to identify who downloaded it so the school can ask for deletion where appropriate.
- **Prevent**: two-person review before uploading albums; consent policy; avoid photos in changing rooms, medical/sensitive settings, or showing home addresses, ID cards, names on screens.

#### M. Provider outage

- Static pages continue from Firebase Hosting even if Vercel is down; **sign-in-dependent features, photos, feedback and news data may fail**. Keep a status note template for Instagram. Photo downloads simply wait; feedback has no offline queue (tell students to retry or use Instagram DM).
- Check provider status pages (Vercel, Firebase/Google Cloud, Cloudinary, OpenRouter) before debugging your own code.

#### N. Developer unavailable (bus factor)

- **Risk**: one developer owns the code and provider accounts; in a year of exams, illness or graduation the site becomes unmaintainable.
- **Mitigate now**: second technical owner; shared password manager; provider accounts under a **school/SU-owned organisation** (or at least two owners); documented runbooks (this report + README); `docs/` folder with deployment steps; scheduled "can someone else deploy?" drill.
- **Break-glass**: a sealed copy of recovery codes held by the teacher-in-charge.

#### O. Insider misuse

- **Prevent**: smallest possible admin list; no shared accounts; code of conduct (2.2); admin audit log for uploads/deletes/exports (S9); log every CSV export.
- **Respond**: suspend the admin (revoke claim + tokens), preserve logs, escalate to the school; treat as a data breach if personal data left the system.

#### P. End of term — handover and decommission

1. Revoke all outgoing admin claims; revoke refresh tokens; review `list-admins`.
2. Rotate **all** secrets (Appendix F); remove outgoing members from GitHub, Vercel, Firebase, Cloudinary, Google, domain registrar.
3. Transfer ownership of accounts to the school/SU; update the contact sheet.
4. **Data**: export what the school wants to archive; delete or anonymise the rest (feedback, supporters, pageviews, subscriptions, old photos, logs) per retention policy; confirm Firestore TTL has run.
5. Decide the site's fate: archive as static pages (disable API/sign-in) or shut down; remove the Firebase Auth users and Cloudinary assets.
6. Archive this report and the incident log.

#### Q. Third-party script compromise

- **Signs**: unexpected script behaviour, CSP violation reports, notice from the library or CDN.
- **Contain**: remove or pin the script; self-host verified copies (S6); redeploy; rotate any credentials that were active in the browser session of an affected admin; ask admins to sign out/in.

#### R. Content and legal checks before publishing

Checklist for any page, photo or video: **copyright** (music/fonts/images, third-party logos — the promo video is large and likely contains music), **consent** (people in photos, especially minors), **accuracy** (budget figures, promises), **defamation** (no claims about other cabinets or individuals without evidence), **data** (no personal data in alt text, filenames or captions).

---

## 5. Prioritised action plan

**Now (before photos go live)**
- [ ] S1 watermark previews · S2 stronger visible mark · S3 lower quota · S4 payload test · S5 `checkRevoked`
- [ ] Enforce 2-Step Verification for **every** admin and provider account; run the Appendix B checklist
- [ ] Download agreement + privacy notice + take-down contact (Section 3.6/3.7)
- [ ] Add `.gitignore`, `.env.example`; secret scan the repository history (S13)
- [ ] Triage rule + helplines for sensitive feedback (risk H)
- [ ] Contact sheet and incident template (Appendix C)

**Within 2–4 weeks**
- [ ] Tier B invisible watermark with measured robustness; admin "decode image" tool
- [ ] Perceptual hash + SHA-256 stored per download
- [ ] SRI or self-host JSZip/Chart.js (S6)
- [ ] Admin audit log for photo upload/delete/exports (S9)
- [ ] Usage/budget alerts (Firebase, Vercel, Cloudinary, OpenRouter, Gmail)
- [ ] Retention/TTL for remaining collections (S8) and legal-hold procedure (S7)

**During the term**
- [ ] Weekly download review; monthly access review; quarterly rotation and drill (Section 2.2)
- [ ] Second technical owner trained to deploy and rotate secrets (risk N)

**End of term**
- [ ] Handover & decommission (risk P)

---

## Appendix A — Data inventory and suggested retention

| Collection / store | Personal data | Written by | Read by | Current expiry | Suggested |
|---|---|---|---|---|---|
| `photoDownloadLogs` | Email, name, UID, hashed IP, browser/device | Server | Admin | 365 days (TTL) | Keep ≤ 365 days; legal hold for incidents |
| `photoDownloadUsers` / `Stats` | Keyed account hash, counters | Server | Admin | none (counters) | Reset at term end |
| `photoDownloadRateLimits` | Keyed account hash | Server | none | 90 days (TTL) | Keep |
| `feedbacks` | Text; email/name if not anonymous | Server | Admin | none | Review quarterly; delete after term |
| `supporters` | Device hash, email (if signed in) | Server | Admin | none | Delete after election period |
| `pageviews` | Path, duration, `userEmail` if attached | Server | Admin | none | TTL ≈ 90–180 days |
| `rateLimits`, `analyticsRateLimits`, `supporterIpCooldowns` | Hashed IP/UID | Server | none | none | TTL ≈ 1–7 days |
| `newsSubscriptions` | Email, UID, language | Client (own) | Owner/Admin | none | Delete at term end |
| `newsDeliveries` | Email, status | Server | none | none | TTL ≈ 90 days |
| `newsReads` | UID, news ID | Client (own) | Owner/Admin | none | Delete at term end |
| `galleryImages` / `galleryFolders` | Metadata | Admin | Admin / school users (folders) | none | Per album policy |
| Cloudinary | Original photos | Admin | Server only | none | Delete at term end/archival |
| Vercel logs | Emails in some log lines (S12) | Platform | Developer | Provider default | Remove email logging |

## Appendix B — Pre-launch security checklist

- [ ] All of these Vercel variables set and non-trivial: `FIREBASE_SERVICE_ACCOUNT`, `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET`, `ANALYTICS_HMAC_SECRET` (≥ 32 chars), `IP_HASH_SECRET` (≥ 32 chars, independent), `NEWS_UNSUBSCRIBE_SECRET`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `OPENROUTER_API_KEY`, `ALLOWED_ORIGINS` (if a custom domain is used). `DEBUG_FEEDBACK` is **unset**.
- [ ] `firebase deploy --only firestore:rules,firestore:indexes` done; **TTL policies show "Active" in the Firebase Console** for `photoDownloadLogs.deleteAfter` and `photoDownloadRateLimits.expiresAt`.
- [ ] Admin list reviewed (`/api/list-admins`); each admin has 2-Step Verification.
- [ ] Test accounts: a non-school Gmail cannot read photos/news receipts; a school account cannot read `galleryImages`, logs or other users' receipts (use the Firebase Rules Playground).
- [ ] Download test: ZIP of 10 largest photos works (no 413); audit rows appear; REF on image matches the log; quota triggers a 429.
- [ ] Deletion test: delete a test photo; confirm it can no longer be fetched and the CDN copy is invalidated.
- [ ] Security headers verified on the live site (browser DevTools or a scanner); CSP violations monitored in console.
- [ ] Google Cloud: API key restricted by referrer; authorized domains correct; App Check considered.
- [ ] Repository: no secrets in history; `.gitignore` present; `main` protected; 2SV on GitHub.
- [ ] **Backups**: periodic export of Firestore (`gcloud firestore export` or scheduled backup) and a copy of the original photos held by the SU (Cloudinary is not a backup).
- [ ] Usage alerts configured on all providers.
- [ ] Contact sheet printed; incident template available.

## Appendix C — Incident record and contact sheet

**Incident record (copy per incident)**

| Field | Entry |
|---|---|
| Incident ID / date-time (HKT) | |
| Reported by / how | |
| Category (Section 4.1 ID) | |
| What happened (facts only) | |
| Systems/data affected | |
| People affected (number, group) | |
| Containment actions + time | |
| Evidence stored where | |
| Notified (school / platform / PCPD / parents) | |
| Root cause | |
| Fix / follow-up tasks + owners + dates | |
| Closed by / date | |

**Contact sheet (fill in)**: Incident lead · Technical lead (+ backup) · Teacher-in-charge · School IT · Social worker/counsellor · School data protection contact · Instagram account owner · Provider account owners (Google/Firebase, Vercel, Cloudinary, Gmail, GitHub, domain).

## Appendix D — Photo-trace quick card

1. Preserve evidence → 2. Read REF/masked email/time on the image → 3. Search Admin → Photo Downloads (or Firebase Console on `watermarkRef`) → 4. Verify photo ID + time ordering → 5. Rule out shared/compromised account → 6. Escalate to the school with an evidence pack → 7. Platform take-down → 8. Legal hold on log rows → 9. Record and learn.

## Appendix E — Short student-facing notice (draft)

> **About photo downloads.** To protect everyone in our photos, each download is watermarked with a masked version of your school email, the time, and a reference code, and the Student Union keeps a secure record of downloads for up to 12 months. Only a few named SU admins can see these records, and they are used only to investigate misuse. Please don't edit photos to embarrass, harass or misrepresent anyone. If you'd like a photo of you removed, contact us at *(contact)* and we will remove it within 48 hours. Some service providers that help run this site operate outside Hong Kong.

## Appendix F — Secret rotation cheat-sheet

| Secret | Where to rotate | Side effects |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Google Cloud → IAM → Service accounts → create new key, delete old | None after redeploy; delete the old key |
| `CLOUDINARY_API_SECRET` / key | Cloudinary Console → API keys | Uploads and downloads fail until Vercel is updated |
| `GMAIL_APP_PASSWORD` | Google Account → App passwords → revoke & recreate | Emails stop until updated |
| `OPENROUTER_API_KEY` | OpenRouter dashboard | Feedback checks fall back to local filter; translation unavailable |
| `ANALYTICS_HMAC_SECRET` | Vercel env var | In-flight analytics sessions invalid; **quota counters and "unique accounts" totals use account hashes keyed by this secret and will restart** |
| `IP_HASH_SECRET` | Vercel env var | IP hashes and cooldown keys change; old hashes cannot be matched to new ones |
| `NEWS_UNSUBSCRIBE_SECRET` | Vercel env var | Unsubscribe links in earlier emails stop working |

After every change: **redeploy** (`vercel --prod`) and run the download and news-email tests.

## Appendix G — Scope, assumptions and what I could not verify

- **Static review only.** I did not run the application, call the live APIs, load-test, or inspect the Firebase, Vercel, Cloudinary or Google account consoles. Anything that depends on live settings (TTL active, 2-Step Verification, env var values, API key restrictions, Cloudinary account settings) is **unverified**.
- **Cloudinary behaviour** (how the layer overlay renders, whether metadata is preserved, exact byte sizes) was read from code, not tested. I did not test whether real photos exceed 4.5 MB; I only confirmed the platform limit **[Doc]** and the parameters (3000 px, quality 88).
- **Watermark robustness numbers** are not claimed: the invisible-watermark survival rate must be measured on your own photos (Section 3.5, tier B).
- **Legal points** are general pointers, not legal advice. I could not retrieve the PCPD pages during this review; confirm PDPO obligations (notification, retention, minors' images) with the school's legal adviser or data protection officer.
- **Helpline names** are given without phone numbers on purpose; verify current numbers before publishing.
- The README states some controls (for example "hash-based CSP", TTL, headers) — I checked these against the configuration files where possible, and the CSP hashes were **not** recomputed against the pages' inline scripts.
- Gmail's sending cap and Vercel Hobby terms can change; check the vendors' current documentation.

### Sources
- Vercel — [Functions limits](https://vercel.com/docs/functions/limitations) (4.5 MB request/response body; Hobby limits) and [FUNCTION_PAYLOAD_TOO_LARGE](https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE)
- Office of the Privacy Commissioner for Personal Data, Hong Kong — [PDPO overview materials](https://www.pcpd.org.hk/english/education_training/individuals/public_seminars/files/PDPO_eng_2026.pdf) (search result only; content not retrieved in this review)
- Project source files: `README.md`, `firestore.rules`, `firestore.indexes.json`, `vercel.json`, `firebase.json`, `api/**`, `public/**`, `scripts/set-admin-claims.js`