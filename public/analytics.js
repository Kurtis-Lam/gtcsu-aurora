import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ---------------------------------------------------------------------------
// Aurora page-view analytics.
//
// This file has ONE job: record that someone opened this page, and how
// long they were actually looking at it. It does not identify visitors
// in any way (no fingerprinting, no device info, no IP).
//
// The separate, much more minimal identity check used to rate-limit the
// "Support Us" counter (a salted hash of the visitor's public IP) lives
// entirely in supportus.html now, since it's a concern specific to that
// one page, not general site analytics.
// ---------------------------------------------------------------------------

const firebaseConfig = {
  apiKey: "AIzaSyB-Uo9IaoMgXK5Kujj4c4idqUImpz_P5WY",
  authDomain: "gtcsu-aurora.firebaseapp.com",
  projectId: "gtcsu-aurora",
  storageBucket: "gtcsu-aurora.firebasestorage.app",
  messagingSenderId: "961705164297",
  appId: "1:961705164297:web:34331ed1cf626ec4e5c2d8"
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

function getHKTDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(date);
}

const path = window.location.pathname || '/';
const pageviewRef = doc(collection(db, "pageviews"));

const FIRESTORE_COMMIT_URL =
  `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}` +
  `/databases/(default)/documents:commit?key=${firebaseConfig.apiKey}`;

const PAGEVIEW_DOC_PATH =
  `projects/${firebaseConfig.projectId}/databases/(default)/documents/pageviews/${pageviewRef.id}`;

function toFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: value } : { doubleValue: value };
  }
  return { stringValue: String(value) };
}

// Fired from `pagehide`, where we can no longer rely on an async SDK call
// completing. sendBeacon (with a manual REST fallback) guarantees the
// write is queued before the page is torn down.
function sendExitUpdate(fields) {
  const fieldPaths = Object.keys(fields);
  const fieldsPayload = {};
  fieldPaths.forEach((key) => {
    fieldsPayload[key] = toFirestoreValue(fields[key]);
  });

  const body = JSON.stringify({
    writes: [
      {
        updateMask: { fieldPaths },
        update: { name: PAGEVIEW_DOC_PATH, fields: fieldsPayload }
      }
    ]
  });

  let sent = false;
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    sent = navigator.sendBeacon(FIRESTORE_COMMIT_URL, blob);
  }

  if (!sent) {
    fetch(FIRESTORE_COMMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    }).catch((err) => console.error("Analytics exit beacon fallback failed:", err));
  }
}

// ---------------------------------------------------------------------------
// Engagement time tracking.
//
// A page only counts as "being viewed" while its tab is the visible tab
// AND the browser window has focus. That means:
//   - switching to another tab pauses the clock
//   - switching to another application (alt-tab) pauses the clock, even
//     though the tab itself is technically still "visible" according to
//     the Page Visibility API
//   - coming back to the tab resumes the clock
// Previously only tab-visibility was tracked, so a tab left open (but
// unfocused, e.g. behind another window) all day kept accumulating time,
// which is almost certainly why some pages showed multi-thousand-second
// "average" durations - a handful of forgotten open tabs were dragging
// the average way up.
// ---------------------------------------------------------------------------

function isEngaged() {
  return document.visibilityState === "visible" && document.hasFocus();
}

let accumulatedMs = 0;
let engagedSince = isEngaged() ? Date.now() : null;

function flushEngagedTime() {
  if (engagedSince !== null) {
    accumulatedMs += Date.now() - engagedSince;
    engagedSince = null;
  }
}

function refreshEngagementState() {
  const engaged = isEngaged();
  if (engaged && engagedSince === null) {
    engagedSince = Date.now();
  } else if (!engaged && engagedSince !== null) {
    flushEngagedTime();
  }
}

function currentDurationSeconds() {
  const liveMs = accumulatedMs + (engagedSince !== null ? Date.now() - engagedSince : 0);
  return Math.max(1, Math.round(liveMs / 1000));
}

function updateDuration() {
  return updateDoc(pageviewRef, {
    durationSeconds: currentDurationSeconds(),
    lastActiveAt: serverTimestamp()
  }).catch(err => console.error("Analytics duration update failed:", err));
}

document.addEventListener("visibilitychange", () => {
  refreshEngagementState();
  if (!isEngaged()) updateDuration();
});

window.addEventListener("focus", refreshEngagementState);
window.addEventListener("blur", () => {
  refreshEngagementState();
  updateDuration();
});

setDoc(pageviewRef, {
  path: path,
  durationSeconds: 0,
  dateStr: getHKTDateString(),
  timestamp: serverTimestamp(),
  openedAt: serverTimestamp(),
  lastActiveAt: serverTimestamp()
}).catch(err => console.error("Analytics open logging failed:", err));

onAuthStateChanged(auth, (user) => {
  if (user) {
    updateDoc(pageviewRef, {
      userEmail: user.email || "",
      userName: user.displayName || user.email || ""
    }).catch(err => console.error("Analytics user update failed:", err));
  }
});

const HEARTBEAT_INTERVAL_MS = 3000;
setInterval(() => {
  if (isEngaged()) updateDuration();
}, HEARTBEAT_INTERVAL_MS);

window.addEventListener("pagehide", () => {
  sendExitUpdate({
    durationSeconds: currentDurationSeconds(),
    lastActiveAt: new Date(),
    closedAt: new Date()
  });
});