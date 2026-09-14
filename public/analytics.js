import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js"; 
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc,
  setDoc, 
  updateDoc, 
  onSnapshot,
  runTransaction,
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

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig); 
const db = getFirestore(app); 

function getHKTDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(date);
} 

const startTime = Date.now(); 
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

function currentDurationSeconds() {
  return Math.max(1, Math.round((Date.now() - startTime) / 1000));
} 

setDoc(pageviewRef, {
  path: path,
  durationSeconds: 0,
  dateStr: getHKTDateString(),
  timestamp: serverTimestamp(),
  openedAt: serverTimestamp(),
  lastActiveAt: serverTimestamp()
}).catch(err => console.error("Analytics open logging failed:", err)); 

function updateDuration() {
  const durationSeconds = currentDurationSeconds(); 

  return updateDoc(pageviewRef, {
    durationSeconds: durationSeconds,
    lastActiveAt: serverTimestamp()
  }).catch(err => console.error("Analytics duration update failed:", err)); 
}

const HEARTBEAT_INTERVAL_MS = 3000; 
setInterval(() => {
  if (document.visibilityState === "visible") {
    updateDuration();
  }
}, HEARTBEAT_INTERVAL_MS); 

// Sync duration when switching away, without recording a closed event
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    updateDuration();
  }
});

// Record closedAt ONLY on actual tab close, browser close, or page navigation
window.addEventListener("pagehide", () => {
  sendExitUpdate({
    durationSeconds: currentDurationSeconds(),
    lastActiveAt: new Date(),
    closedAt: new Date()
  });
});

// ---------------------------------------------------------------------------
// "Support Us" click tracking, rate-limited per Device ID
// ---------------------------------------------------------------------------

export const SUPPORT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes 

export function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem("aurora_device_id");
  if (!deviceId) {
    deviceId = typeof crypto !== "undefined" && crypto.randomUUID 
      ? crypto.randomUUID() 
      : 'device_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    localStorage.setItem("aurora_device_id", deviceId);
  }
  return deviceId;
}

export function maskDeviceId(id) {
  const str = String(id);
  return str.length > 8 ? str.slice(0, 8) + "..." : str;
}

export function maskIP(ip) {
  const str = String(ip);
  return str.length > 8 ? str.slice(0, 8) + "..." : str;
} 

export async function getSupportStatus(deviceId) {
  const supporterRef = doc(db, "supporters", deviceId);
  const snap = await getDoc(supporterRef);
  if (!snap.exists()) return { remainingMs: 0, clicks: 0 };

  const data = snap.data();
  const last = data.lastClickAtMillis || 0;
  const remainingMs = Math.max(0, SUPPORT_COOLDOWN_MS - (Date.now() - last));
  return { remainingMs, clicks: data.clicks || 0 };
}

export function subscribeSupportCounter(callback) {
  const counterRef = doc(db, "counters", "supportCounter");
  return onSnapshot(counterRef, (snap) => {
    callback(snap.exists() ? (snap.data().count || 0) : 0);
  }, (err) => {
    console.error("Support: counter subscription failed:", err);
  });
} 

export async function registerSupportClick(deviceId) {
  const supporterRef = doc(db, "supporters", deviceId);
  const counterRef = doc(db, "counters", "supportCounter");

  return runTransaction(db, async (tx) => {
    const supporterSnap = await tx.get(supporterRef);
    const now = Date.now();
    const prevClicks = supporterSnap.exists() ? (supporterSnap.data().clicks || 0) : 0;

    if (supporterSnap.exists()) {
      const last = supporterSnap.data().lastClickAtMillis || 0;
      const remainingMs = SUPPORT_COOLDOWN_MS - (now - last);
      if (remainingMs > 0) {
        return { success: false, remainingMs, clicks: prevClicks };
      }
    }

    const counterSnap = await tx.get(counterRef);
    const prevTotal = counterSnap.exists() ? (counterSnap.data().count || 0) : 0;
    const newTotal = prevTotal + 1;
    const newClicks = prevClicks + 1;

    tx.set(counterRef, { count: newTotal }, { merge: true });
    tx.set(supporterRef, {
      deviceId: String(deviceId),
      lastClickAtMillis: now,
      clicks: newClicks,
      dateStr: getHKTDateString()
    }, { merge: true });

    return { success: true, remainingMs: SUPPORT_COOLDOWN_MS, clicks: newClicks, totalSupporters: newTotal };
  });
}