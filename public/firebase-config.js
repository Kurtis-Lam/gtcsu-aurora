// ---------------------------------------------------------------------------
// Aurora — single source of truth for Firebase setup.
//
// Every page imports app/db/auth from HERE instead of redeclaring
// firebaseConfig. If you ever need to point the site at a different
// Firebase project, this is the ONLY file you need to edit.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Cloudinary config (used by photos.html + admin.html "Upload Photos" tab).
// Cloud name is public/safe to expose. The upload preset must be created as
// "unsigned" in your Cloudinary dashboard — see the setup guide you were
// given for the exact steps. NEVER put your Cloudinary API *secret* here or
// in any client-side file.
// ---------------------------------------------------------------------------
export const cloudinaryConfig = {
  cloudName: "YOUR_CLOUD_NAME",        // <-- replace after step 2 of the guide
  uploadPreset: "aurora_unsigned"      // <-- replace if you name your preset differently
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();