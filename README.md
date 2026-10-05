# Aurora — Student Union Candidate Cabinet Website

Official website for **Aurora**, the No. 1 candidate cabinet for the Student Union of G.T. (Ellen Yeung) College, 2026–27.

This is a multi‑page, bilingual (English / Traditional Chinese) static website with dynamic features such as school-account-only news, anonymous feedback submission, a real‑time support counter, and a detailed financial budget breakdown.

---

## ✨ Features

- **Bilingual Interface** – Toggle between English and Traditional Chinese on every page. Language preference is saved in `localStorage`.
- **Immersive Design** – Animated video background, glass‑morphism cards, and smooth scroll‑reveal effects.
- **Dynamic Navigation** – A shared navigation panel (`panel.html`) is injected via `load-components.js` for consistent headers across pages.
- **Latest News** – Verified school Google accounts can read bilingual announcements and mark each update as read. Admins can draft, edit, publish, delete, and restore announcements, with an activity log for each item.
- **Support Us Counter** – Real‑time global support counter with IP‑based cooldown (10 minutes). Uses Firebase Firestore.
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
| `news.html` | Latest bilingual announcements (verified school Google account required). |
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

Deploy Firestore access-control changes from the repository root with `firebase deploy --only firestore:rules`. News translation uses the existing `OPENROUTER_API_KEY` server environment variable; the key is never sent to the browser.

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

---

## 🙌 Acknowledgements

Built with ❤️ by Kurtis

---

*Sparked by Aurora, united with Harmonia.*