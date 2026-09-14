import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  doc,
  setDoc, 
  updateDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB-Uo9IaoMgXK5Kujj4c4idqUImpz_P5WY",
  authDomain: "gtcsu-aurora.firebaseapp.com",
  projectId: "gtcsu-aurora",
  storageBucket: "gtcsu-aurora.firebasestorage.app",
  messagingSenderId: "961705164297",
  appId: "1:961705164297:web:34331ed1cf626ec4e5c2d8"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function getHKTDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(date);
}

const startTime = Date.now();
const path = window.location.pathname || '/';
let closedLogged = false;

// Synchronously generate document reference with an auto-id
const pageviewRef = doc(collection(db, "pageviews"));

// 1. Log visit immediately on page load
setDoc(pageviewRef, {
  path: path,
  durationSeconds: 0,
  dateStr: getHKTDateString(),
  timestamp: serverTimestamp(),
  openedAt: serverTimestamp()
}).catch(err => console.error("Analytics open logging failed:", err));

// 2. Update existing document on page exit or tab hide
function logPageClose() {
  if (closedLogged) return;
  closedLogged = true;

  const durationSeconds = Math.max(1, Math.round((Date.now() - startTime) / 1000));

  updateDoc(pageviewRef, {
    durationSeconds: durationSeconds,
    closedAt: serverTimestamp()
  }).catch(err => console.error("Analytics close logging failed:", err));
}

window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    logPageClose();
  } else if (document.visibilityState === "visible") {
    // Reset flag if user returns to tab after switching away
    closedLogged = false;
  }
});

window.addEventListener("pagehide", logPageClose);