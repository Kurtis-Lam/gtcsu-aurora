// firebase-config.js
// These values are NOT secrets: they identify the Firebase project and ship
// to every browser. Access is enforced by firestore.rules, not by hiding them.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

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
export const db = getFirestore(app);
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