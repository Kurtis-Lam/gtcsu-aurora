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

const pageviewRef = doc(collection(db, "pageviews")); 

// ---------------------------------------------------------------------------
// Reliable "exit" writes via navigator.sendBeacon
//
// The Firestore SDK's updateDoc() is NOT sent with `keepalive`, so when a tab
// is actually closed (as opposed to just backgrounded) the browser can tear
// down the page's network stack before the write reaches the server. This is
// most visible on pages people look at briefly and close fast (e.g. an admin
// panel or a feedback form) - there just isn't enough time for the async SDK
// call to complete before the tab disappears, so "closedAt" silently never
// gets written.
//
// navigator.sendBeacon() is the browser-guaranteed way to fire a request that
// survives page unload, but it only supports simple POST requests with no
// custom headers, so it can't go through the Firestore SDK. Instead we POST
// straight to Firestore's REST `:commit` endpoint, which accepts plain POST.
// ---------------------------------------------------------------------------

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

// Fire-and-forget update that is safe to call during pagehide/hidden.
// Uses sendBeacon (survives unload); falls back to a keepalive fetch if the
// beacon queue is full or unavailable.
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
    // Beacon queue full, blocked, or unsupported - keepalive fetch is the
    // next best thing for surviving unload.
    fetch(FIRESTORE_COMMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    }).catch((err) => console.error("Analytics exit beacon fallback failed:", err));
  }
}

function currentDurationSeconds() {
  return Math.max(1, Math.round((Date.now() - startTime) / 1000));
}

// 1. Log visit immediately on page load
setDoc(pageviewRef, {
  path: path,
  durationSeconds: 0,
  dateStr: getHKTDateString(),
  timestamp: serverTimestamp(),
  openedAt: serverTimestamp(),
  lastActiveAt: serverTimestamp()
}).catch(err => console.error("Analytics open logging failed:", err)); 

// Helper function to update duration without setting closedAt
function updateDuration() {
  const durationSeconds = currentDurationSeconds(); 

  return updateDoc(pageviewRef, {
    durationSeconds: durationSeconds,
    lastActiveAt: serverTimestamp()
  }).catch(err => console.error("Analytics duration update failed:", err)); 
}

// 2. Heartbeat Mechanism (3-second interval captures quick visits)
const HEARTBEAT_INTERVAL_MS = 3000;
setInterval(() => {
  if (document.visibilityState === "visible") {
    updateDuration();
  }
}, HEARTBEAT_INTERVAL_MS);

// 3. Save accumulated time on tab hide without marking tab as closed
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    // The tab may just be backgrounded, or it may be closing right now -
    // there's no way to tell which from this event alone, and on mobile the
    // page can be suspended/killed immediately after this fires with no
    // further chance to run JS. Use the beacon path so the write survives
    // either outcome.
    sendExitUpdate({
      durationSeconds: currentDurationSeconds(),
      lastActiveAt: new Date(),
      closedAt: new Date()
    });
  } else if (document.visibilityState === "visible") {
    // Tab is confirmed alive again - plenty of time for a normal SDK call.
    updateDoc(pageviewRef, {
      closedAt: null 
    }).catch(err => console.error("Analytics reopen logging failed:", err));
  }
});

// 4. Explicitly mark tab closure on page unload/close
window.addEventListener("pagehide", () => {
  sendExitUpdate({
    durationSeconds: currentDurationSeconds(),
    lastActiveAt: new Date(),
    closedAt: new Date()
  });
});