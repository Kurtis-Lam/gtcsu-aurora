# Contributing to GTCSU Aurora

Thanks for taking the time to contribute! 💫
This is the website for the **G.T. (Ellen Yeung) College 2026–27 Candidate Cabinet No. 1 – Aurora**, and I'd love for people to help make it better. Bug fixes, translation fixes, accessibility improvements, new ideas, and documentation tweaks are all welcome.

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
3. **Run the site locally.** The site is plain HTML, CSS and JavaScript (ES modules), so it needs to be served over HTTP. Opening the files directly with `file://` will not work.
   ```bash
   # from the repository root
   python3 -m http.server 3000 --directory public
   # or
   npx serve public
   ```
   Then open <http://localhost:3000>.
4. Make your changes, test them (see checklist below), then commit and push.
5. Open a **pull request** against `main` and fill in what you changed and why.

## Project structure

```
public/
├── index.html, aboutus.html, activities.html, ...   # pages
├── panel.html        # shared navigation bar + language and info buttons
├── background.html   # shared video background
├── info.html         # "About this site" popup (version, contributing)
├── assets/           # images and other static files
└── js/
    ├── load-components.js   # mounts panel/background/info, sign-in, language switching
    ├── info.js              # info popup logic + APP_VERSION / LAST_UPDATED
    ├── analytics.js         # page-view tracking
    ├── firebase-config.js   # Firebase project config
    └── api-config.js        # API base URL
```

## Guidelines

**Keep it bilingual.** Any visible text should have both languages:

```html
<p class="i18n" data-en="Hello" data-zh="你好">Hello</p>
```

If your page renders content dynamically, re-render it inside a `window.setLanguage(lang)` function. The shared language button calls it automatically. You don't need to add a language button to your page.

**Shared components.** The navigation bar, language button and info button live in `panel.html`. Don't copy them into individual pages. Add a `<div id="panel-container"></div>`, a `<div id="background-container"></div>` and load `js/load-components.js`.

**Style.**
- Match the existing look: colours and fonts are defined by the CSS variables at the top of each page.
- Keep the layout responsive (check at phone width) and keep visible keyboard focus.
- Respect `prefers-reduced-motion`.
- No new dependencies or build tools unless discussed in an issue first.

**Security and privacy.**
- **Never commit secrets** (API keys, service-account files, `.env` files, tokens). The Firebase web config in `js/firebase-config.js` is public by design; access is enforced by the Firestore rules and server-side checks, not by hiding it.
- Don't add trackers or collect extra personal data.
- Found a security problem? Please **don't** open a public issue. Use GitHub's private vulnerability reporting (the repository's *Security* tab) or contact the maintainer directly.

**Versioning.** If your change is user-visible, bump `APP_VERSION` and `LAST_UPDATED` in `public/js/info.js` (the maintainer may do this when merging).

## Pull request checklist

- [ ] The change does one thing and the PR description explains why
- [ ] Tested locally in English **and** 繁體中文
- [ ] Checked on a narrow (mobile) screen
- [ ] No console errors
- [ ] No secrets or large binary files added (the repo is not the place for big videos)

## Commit messages

Short, present tense, and specific. For example:

```
Fix support button cooldown text in Chinese
Add alt text to gallery images
```

## Code of conduct

Be kind and respectful. Feedback on code is about the code, not the person. Harassment or discrimination of any kind isn't tolerated.

---

Made with ❤️ by Kurtis