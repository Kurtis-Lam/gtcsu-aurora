# Aurora — Student Union Candidate Cabinet Website

Official website for **Aurora**, the No. 1 candidate cabinet for the Student Union of G.T. (Ellen Yeung) College, 2026–27.

This is a multi‑page, bilingual (English / Traditional Chinese) static website with dynamic features such as a real‑time support counter, anonymous feedback submission, and a detailed financial budget breakdown.

---

## ✨ Features

- **Bilingual Interface** – Toggle between English and Traditional Chinese on every page. Language preference is saved in `localStorage`.
- **Immersive Design** – Animated video background, glass‑morphism cards, and smooth scroll‑reveal effects.
- **Dynamic Navigation** – A shared navigation panel (`panel.html`) is injected via `load-components.js` for consistent headers across pages.
- **Support Us Counter** – Real‑time global support counter with IP‑based cooldown (10 minutes). Uses Firebase Firestore.
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
| `activities.html` | Detailed descriptions of all planned activities (festive, regular, post‑exam, inter‑school). |
| `welfare.html` | Student welfare offers, merchant discounts, and external benefits. |
| `schedule.html` | Month‑by‑month calendar of events for the 2026–27 academic year. |
| `feedbacks.html` | Anonymous feedback form + FAQ. |
| `financial.html` | Complete budget breakdown with itemised costs. |
| `supportus.html` | Real‑time support counter with a “Support Us” button. |

> **Note:** `panel.html` and `load-components.js` are used to inject the shared header/navigation. They are not standalone pages.

---

## 🛠️ Technology Stack

- **Frontend:** Vanilla HTML5, CSS3, JavaScript (ES modules)
- **Styling:** Custom CSS with CSS variables, backdrop‑filter, grid/flexbox
- **Animations:** CSS keyframes, Intersection Observer for scroll reveals
- **Backend / Database:** Firebase Firestore (for support counter and feedback storage)
- **Analytics:** Custom `analytics.js` for device fingerprinting, IP hashing, and event tracking
- **External Services:** Cloudinary (for image uploads – not used in all pages), OpenRouter (not used here, but present in some configurations)
- **Fonts:** Google Fonts (Cinzel, Manrope, Cormorant Garamond)

---

## 🚀 Getting Started

### Prerequisites

- A modern web browser (Chrome, Firefox, Safari, Edge)
- A Firebase project with Firestore enabled (for dynamic features)
- (Optional) A web server for local development (e.g., `live-server`, `python -m http.server`)

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/aurora-website.git
   cd aurora-website
   ```

2. **Add assets**  
   Place the following in the `assets/` folder:
   - `aurora-logo.png` – cabinet logo
   - `background.mp4` – background video
   - `promo_vid.mp4` – promotion video (for About Us page)
   - `profiles/` – member profile images (e.g., `samuel_w._so.jpg`)

3. **Configure Firebase**  
   Update the Firebase configuration in the relevant pages (`feedbacks.html`, `supportus.html`, etc.) with your own project credentials:
   ```javascript
   const firebaseConfig = {
     apiKey: "YOUR_API_KEY",
     authDomain: "YOUR_PROJECT.firebaseapp.com",
     projectId: "YOUR_PROJECT_ID",
     storageBucket: "YOUR_PROJECT.appspot.com",
     messagingSenderId: "YOUR_SENDER_ID",
     appId: "YOUR_APP_ID"
   };
   ```

4. **Set up Firestore collections**  
   Create the following collections:
   - `feedbacks` – stores submitted feedback (fields: `title`, `description`, `status`, `submittedAtHKT`, `createdAt`)
   - `support_meta/counter` – document with a `count` field for the total support count
   - `ip_cooldowns` – stores cooldown records keyed by IP hash or device ID

5. **Run locally**  
   Open `index.html` directly in a browser, or use a local server:
   ```bash
   npx live-server
   ```

---

## 🔧 Configuration

### Firebase

The website uses Firebase for:
- **Support counter** – real‑time updates via `onSnapshot`
- **Feedback storage** – moderation API call before saving to Firestore

Replace the `firebaseConfig` object in:
- `feedbacks.html`
- `supportus.html`
- Any other page that uses Firebase

### Moderation API

The feedback form sends a POST request to:
```
https://gtcsu-aurora.vercel.app/api/moderate
```
This endpoint should return `{ "isSpam": boolean, "reason": string }`. You can replace it with your own moderation service.

### Analytics

`analytics.js` is included as a module on most pages. It provides helper functions such as:
- `getOrCreateDeviceId()`
- `getPublicIP()`
- `getIpHash(ip)`
- `getDeviceInfo()`

These are used primarily on the Support Us page.

---

## 📁 Folder Structure

```
.
├── index.html
├── aboutus.html
├── activities.html
├── welfare.html
├── schedule.html
├── feedbacks.html
├── financial.html
├── supportus.html
├── panel.html                 # Shared navigation component
├── load-components.js         # Injects panel.html into pages
├── analytics.js               # Analytics & device fingerprinting
├── assets/
│   ├── aurora-logo.png
│   ├── background.mp4
│   ├── promo_vid.mp4
│   └── profiles/
│       ├── samuel_w._so.jpg
│       ├── xtshh_24.jpg
│       └── ...
└── README.md
```

---

## 🌐 Deployment

The site is a static website and can be hosted on any static hosting service:
- **Firebase Hosting**
- **Vercel**
- **Netlify**
- **GitHub Pages**

Ensure that all asset paths are correct and that Firebase security rules allow the required read/write operations.

---

## 🙌 Credits

- **Design & Development:** Aurora Cabinet 2026–27
- **Fonts:** Google Fonts – Cinzel, Manrope, Cormorant Garamond
- **Icons:** Custom SVG icons
- **Video Background:** Provided by the cabinet

---

## 📄 License

This project is for the internal use of G.T. (Ellen Yeung) College Student Union Candidate Cabinet No. 1 – Aurora.  
All rights reserved. Unauthorised reproduction or distribution is prohibited.

Licensed under MIT.

---

## 📬 Contact

For any enquiries, please reach out via Aurora's Official Instagram: [@gteyc_aurora2627](https://www.instagram.com/gteyc_aurora2627/) or me at: `kurtislam100@gmail.com`

---

## 🙌 Acknowledgements

Built with ❤️ by Kurtis.

---

*Sparked by Aurora, united with Harmonia.*