// firebase-config.js
// These values are NOT secrets: they identify the Firebase project and ship
// to every browser. Access is enforced by firestore.rules, not by hiding them.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app-check.js";

export const firebaseConfig = {
  apiKey: "AIzaSyB-Uo9IaoMgXK5Kujj4c4idqUImpz_P5WY",
  authDomain: "gtcsu-aurora.firebaseapp.com",
  projectId: "gtcsu-aurora",
  storageBucket: "gtcsu-aurora.firebasestorage.app",
  messagingSenderId: "961705164297",
  appId: "1:961705164297:web:34331ed1cf626ec4e5c2d8",
  measurementId: "G-ZWE0Z6VTZK"
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// reCAPTCHA Enterprise site keys are public. Set this after registering the
// web app in Firebase App Check; leave blank until that setup is complete.
export const APP_CHECK_SITE_KEY = '6LfXqCEuAAAAAMbjXsVA7oZS3lJhRr2MvT-1VGtC';
export const appCheck = APP_CHECK_SITE_KEY.trim()
  ? initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY.trim()),
      isTokenAutoRefreshEnabled: true
    })
  : null;

// App Check must never block a request: if reCAPTCHA cannot load (blocked by CSP,
// offline, ad blocker) give up after a few seconds and let the caller continue.
const APP_CHECK_TIMEOUT_MS = 5000;

export async function getAppCheckToken() {
  if (!appCheck) return null;
  const result = await Promise.race([
    getToken(appCheck, false),
    new Promise((_, reject) => setTimeout(() => reject(new Error('App Check token request timed out')), APP_CHECK_TIMEOUT_MS))
  ]);
  return result.token || null;
}

// Use Firestore's HTTP long-polling transport on networks that interrupt WebChannel streams.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true
});
export const auth = getAuth(app);

// Used by the admin portal only. Who counts as an admin is decided by
// firestore.rules (isAdmin()), never by this file.
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const ALLOWED_DOMAIN = "gtcollege.edu.hk";

// A Firebase user counts as "school" only with a verified school email.
// (The `hd` sign-in hint alone is not a security check, so we verify here,
// and firestore.rules / the API routes re-verify on the server side.)
export function isSchoolUser(user) {
  return !!user
    && user.emailVerified === true
    && typeof user.email === 'string'
    && user.email.toLowerCase().endsWith("@" + ALLOWED_DOMAIN);
}