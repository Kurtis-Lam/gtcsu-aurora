# Contributing to GTCSU Aurora

Thanks for taking the time to contribute! 💫
This is the website for the **G.T. (Ellen Yeung) College 2026–27 Candidate Cabinet No. 1 – Aurora**, and I'd love for people to help make it better. Bug fixes, translation fixes, accessibility improvements, performance work, new ideas, and documentation tweaks are all welcome.

## Ways to contribute

- **Report a bug**: open an [issue](https://github.com/Kurtis-Lam/gtcsu-aurora/issues) with what you expected, what happened, and your browser/device. Screenshots help.
- **Suggest a feature or improvement**: open an issue and describe the problem you want solved before writing code, so we can agree on the direction.
- **Fix something yourself**: submit a pull request (steps below).
- **Improve translations**: the site is bilingual (English / 繁體中文). Wording fixes are very welcome.

## Getting started

1. **Fork** the repository and clone your fork:
   ```bash
   git clone https://github.com/<your-username>/gtcsu-aurora.git
   cd gtcsu-aurora
   ```
2. **Create a branch** from `main`:
   ```bash
   git checkout -b fix/short-description
   ```
3. **Run the site locally.** The front end is plain HTML, CSS and JavaScript (ES modules), so it must be served over HTTP. Opening files with `file://` will not work.
   ```bash
   # from the repository root
   python3 -m http.server 3000 --directory public
   # or
   npx serve public
   ```
   Then open <http://localhost:3000>.
4. Make your changes, test them (see the checklist below), then commit and push.
5. Open a **pull request** against `main` and fill in what you changed and why.

### What works locally

- Static pages, navigation, language switching, styling and animations work out of the box.
- The front end calls the production API configured in `public/js/api-config.js`, which only accepts known origins. Features that need it (feedback, support counter, photo gallery, admin portal, news publishing) may be refused from `localhost`. For those, mention in your PR that you could not test them, or run your own Firebase and Vercel projects and add your local origin to `ALLOWED_ORIGINS`.
- Google sign‑in needs `localhost` listed as an authorised domain in your Firebase project. Gallery and admin features also need a school account or the admin claim, so please don't expect to test them against the live project.
- To work on `api/`, run `npm install` (Node ≥ 20.3) and use your own Vercel project and credentials. Never use the production ones.

## Project structure

```
public/                        # served by Firebase Hosting
├── index.html, aboutus.html, news.html, activities.html,
│   financial.html, schedule.html, welfare.html, photos.html,
│   feedbacks.html, admin.html, security_report.html   # pages
├── panel.html                 # shared navigation bar, Info dropdown, sign-in, language and info buttons
├── background.html            # shared video background
├── info.html                  # "About this site" popup (version, contributing)
├── css/
│   └── aurora-fx.css          # shared visual layer (ripples, hover, motion, lite mode)
├── assets/                    # images and other static files
└── js/
    ├── load-components.js     # mounts panel/background/info, sign-in, language switching
    ├── fx.js                  # loads the shared visual effects, lite-mode detection
    ├── preload.js             # news and photo caching / prefetching
    ├── info.js                # info popup logic + APP_VERSION / LAST_UPDATED
    ├── analytics.js           # page-view tracking
    ├── news-page.js, news-reads.js          # public news and read receipts
    ├── photos.js                            # gallery, selection, consent, ZIP download
    ├── admin-news.js, admin-support-logs.js # admin portal modules
    ├── support-crypto.js                    # admin-side log decryption helpers
    ├── security-report.js                   # security report page
    ├── firebase-config.js     # Firebase project config (public by design)
    └── api-config.js          # API base URL

api/                           # Vercel serverless functions (feedback, support, news, photos, admin)
└── _lib/                      # shared helpers: auth, http/CORS, rate limits, Firebase, photos, crypto, watermark
scripts/                       # maintenance scripts (CSP hashes, admin claims, watermark extraction)
firestore.rules                # database access rules
firebase.json, vercel.json     # hosting config and security headers (incl. CSP)
```

## Guidelines

**Keep it bilingual.** Any visible text should have both languages:

```html
<p class="i18n" data-en="Hello" data-zh="你好">Hello</p>
```

If your page renders content dynamically, re-render it inside a `window.setLanguage(lang)` function. The shared language button calls it automatically (and fires an `aurora:langchange` event). You don't need to add a language button to your page.

**Shared components.** The navigation bar, language button and info button live in `panel.html`. Don't copy them into individual pages. Add a `<div id="panel-container"></div>`, a `<div id="background-container"></div>` and load `js/load-components.js`. To add a page to the navigation, edit `panel.html` (pages under the **Info** dropdown go inside `.nav-dropdown-menu`).

**Sign-in.** Use `AuroraAuth` from `load-components.js` instead of initialising Firebase Auth yourself. Only verified `@gtcollege.edu.hk` accounts count as signed in on the public site.

**Style and motion.**
- Match the existing look: colours and fonts come from the CSS variables at the top of each page and the tokens in `css/aurora-fx.css`.
- Keep the layout responsive (check at phone width) and keep visible keyboard focus.
- Respect `prefers-reduced-motion`, and keep the site usable in **lite mode** (add `fx-lite` to `<html>` to test it).
- Animate only `transform` and `opacity` so effects stay smooth over the background video.
- To get the shared press/ripple feedback on a new button class, add the selector to the list in `js/fx.js`.
- No new dependencies or build tools unless discussed in an issue first.

**Content Security Policy.** The site ships a strict CSP in `vercel.json` and `firebase.json`, and inline scripts and event handlers are allowed by hash. If you add or change an inline `<script>` or an `on…=` attribute, run this from the repository root and commit the updated config files:

```bash
python3 scripts/update-csp-hashes.py
```

Otherwise the browser will block your code in production. Prefer external scripts in `js/` where you can. New third‑party hosts must be discussed first.

**Security and privacy.**
- **Never commit secrets** (API keys, service-account files, `credentials/`, `.env` files, tokens, encryption or watermark keys). The Firebase web config in `js/firebase-config.js` is public by design; access is enforced by `firestore.rules` and server-side checks, not by hiding it.
- Don't loosen `firestore.rules`, rate limits or the school-domain checks to make something easier. If a change needs it, open an issue first.
- Don't add trackers or collect extra personal data. Features that record visitor details (feedback, support votes, photo downloads) must keep their on-page privacy or consent notice accurate. If you change what is stored, update the notice in both languages.
- Don't commit real photos, member data or exports from the admin portal.
- Found a security problem? Please **don't** open a public issue. Use GitHub's private vulnerability reporting (the repository's *Security* tab) or contact the maintainer directly.

**Versioning.** If your change is user-visible, bump `APP_VERSION` and `LAST_UPDATED` in `public/js/info.js` (the maintainer may do this when merging). The version also busts the cache of the shared components, so a bump is needed for edits to `panel.html`, `background.html` or `info.html` to reach returning visitors.

## Pull request checklist

- [ ] The change does one thing and the PR description explains why
- [ ] Tested locally in English **and** 繁體中文
- [ ] Checked on a narrow (mobile) screen, with keyboard navigation, and with reduced motion
- [ ] No console errors, including CSP violations (`python3 scripts/update-csp-hashes.py` run if inline scripts changed)
- [ ] No secrets, personal data, or large binary files added (the repo is not the place for big videos or photo sets)
- [ ] `APP_VERSION` / `LAST_UPDATED` bumped if user-visible (or left for the maintainer)

## Commit messages

Short, present tense, and specific. For example:

```
Fix support button cooldown text in Chinese
Add alt text to gallery images
```

## Code of conduct

Be kind and respectful. Feedback on code is about the code, not the person. Harassment or discrimination of any kind isn't tolerated.

---

Built with ❤️ by Kurtis