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
import { 
  getAuth, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

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

onAuthStateChanged(auth, (user) => {
  if (user) {
    updateDoc(pageviewRef, {
      userEmail: user.email || "",
      userName: user.displayName || user.email || ""
    }).catch(err => console.error("Analytics user update failed:", err));
  }
});

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

window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    updateDuration();
  }
});

window.addEventListener("pagehide", () => {
  sendExitUpdate({
    durationSeconds: currentDurationSeconds(),
    lastActiveAt: new Date(),
    closedAt: new Date()
  });
});

// ---------------------------------------------------------------------------
// Solution 1: Hardware Browser Fingerprinting Engine (No Sign-In Required)
// ---------------------------------------------------------------------------

export const SUPPORT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes 

export async function generateFingerprint() {
  const components = [];

  // 1. Screen resolution, color depth & pixel density
  components.push(`${screen.width}x${screen.height}x${screen.colorDepth}`);
  components.push(`pixelRatio:${window.devicePixelRatio || 1}`);

  // 2. Core hardware specs & locale parameters
  components.push(`concurrency:${navigator.hardwareConcurrency || 'unknown'}`);
  components.push(`deviceMemory:${navigator.deviceMemory || 'unknown'}`);
  components.push(`maxTouchPoints:${navigator.maxTouchPoints || 0}`);
  components.push(`platform:${navigator.platform || ''}`);
  components.push(`language:${navigator.language || ''}`);
  components.push(`timezone:${Intl.DateTimeFormat().resolvedOptions().timeZone || ''}`);

  // 3. WebGL GPU Vendor & Renderer
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        components.push(`gpuVendor:${gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)}`);
        components.push(`gpuRenderer:${gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)}`);
      }
      components.push(`glVersion:${gl.getParameter(gl.VERSION)}`);
    }
  } catch (e) {}

  // 4. Canvas Rendering Fingerprint
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial', sans-serif";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("AuroraFP,123", 2, 15);
      ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
      ctx.fillText("AuroraFP,123", 4, 17);
      components.push(`canvas:${canvas.toDataURL()}`);
    }
  } catch (e) {}

  // 5. Audio Stack Fingerprint
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const audioCtx = new AudioContext();
      components.push(`audioRate:${audioCtx.sampleRate}`);
      components.push(`audioChannels:${audioCtx.destination.maxChannelCount}`);
      if (audioCtx.state !== 'closed') {
        audioCtx.close().catch(() => {});
      }
    }
  } catch (e) {}

  // 6. Installed Fonts Probing
  try {
    const fontList = ['Arial', 'Courier New', 'Georgia', 'Helvetica', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Segoe UI', 'Roboto'];
    const availableFonts = [];
    const container = document.body || document.documentElement;
    if (container) {
      const span = document.createElement('span');
      span.style.position = 'absolute';
      span.style.left = '-9999px';
      span.style.fontSize = '72px';
      span.innerHTML = 'mmmmmmmmmlli';
      container.appendChild(span);

      span.style.fontFamily = 'monospace';
      const baseWidth = span.offsetWidth;

      for (const font of fontList) {
        span.style.fontFamily = `'${font}', monospace`;
        if (span.offsetWidth !== baseWidth) {
          availableFonts.push(font);
        }
      }
      container.removeChild(span);
      components.push(`fonts:${availableFonts.join(',')}`);
    }
  } catch (e) {}

  // 7. Installed Plugins Count
  try {
    components.push(`plugins:${navigator.plugins ? navigator.plugins.length : 0}`);
  } catch (e) {}

  // Generate deterministic SHA-256 fingerprint hash string
  const str = components.join('||');
  if (crypto && crypto.subtle && crypto.subtle.digest) {
    const msgBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return 'fp_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 24);
  } else {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return 'fp_' + Math.abs(hash).toString(16);
  }
}

export async function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem("aurora_device_id");
  if (!deviceId) {
    deviceId = await generateFingerprint();
    localStorage.setItem("aurora_device_id", deviceId);
  }
  return deviceId;
}

export function maskDeviceId(id) {
  const str = String(id);
  return str.length > 12 ? str.slice(0, 12) + "..." : str;
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