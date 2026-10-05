# Aurora — Student Union Candidate Cabinet Website

Official website for **Aurora**, the No. 1 candidate cabinet for the Student Union of G.T. (Ellen Yeung) College, 2026–27.

This is a multi‑page, bilingual (English / Traditional Chinese) static website with dynamic features such as authenticated Aurora news, a real‑time support counter, anonymous feedback submission, and a detailed financial budget breakdown.

---

## ✨ Features

- **Bilingual Interface** – Toggle between English and Traditional Chinese on every page. Language preference is saved in `localStorage`.
- **Immersive Design** – Animated video background, glass‑morphism cards, and smooth scroll‑reveal effects.
- **Dynamic Navigation** – A shared navigation panel (`panel.html`) includes an Info dropdown and per-account unread news indicator.
- **Latest News** – Verified school Google accounts can read announcements and mark each revision as read. Admins can publish, edit, delete, restore, and inspect audit logs.
- **Bilingual News Authoring** – News requires English and Traditional Chinese titles and content; admins can request translations via the server-side OpenRouter API.
- **Support Counter** – The real‑time support counter appears below the feedback form on `feedbacks.html`, with a 10-minute cooldown.
- **Anonymous Feedback** – Submit feedback with title and description (word‑count validation). Content is moderated via an external API before saving to Firestore.
- **Activities & Schedule** – Expandable cards detailing festive, regular, and post‑exam activities; month‑by‑month calendar.
- **Welfare & Discounts** – Curated list of student benefits, merchant discounts, and campus welfares.
- **Financial Transparency** – Full budget breakdown for all planned activities and election expenses.
- **Admin / Analytics** – Includes `analytics.js` for tracking (e.g., device info, IP hashing) and a moderation endpoint.

---

## 📄 Pages

| File | Description |
|------|-------------|
| `index.html` | Landing page with cabinet name, slogan, and Instagram link. |
| `aboutus.html` | Vision, promotion video, and cabinet member profiles. |
| `news.html` | Latest Aurora announcements (verified school Google account required). |
| `activities.html` | Detailed descriptions of all planned activities (festive, regular, post‑exam, inter‑school). |
| `welfare.html` | Student welfare offers, merchant discounts, and external benefits. |
| `schedule.html` | Month‑by‑month calendar of events for the 2026–27 academic year. |
| `feedbacks.html` | Anonymous feedback form, FAQ, and support counter. |
| `financial.html` | Complete budget breakdown with itemised costs. |
| `supportus.html` | Legacy URL that redirects to the support counter on `feedbacks.html`. |

The news translation action requires `OPENROUTER_API_KEY` in the Vercel backend environment. News content and audit records are written through the authenticated `/api/news` endpoint; student reads require a verified `@gtcollege.edu.hk` Google account, and admin changes are checked against the existing Firestore `adminCheck` rules.

---

## 🌐 Deployment

The webpage is hosted on:
- **Firebase Hosting**: Frontend
- **Vercel**: Backend and Cloud Functions

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