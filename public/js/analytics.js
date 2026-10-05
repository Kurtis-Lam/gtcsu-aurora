import {
  collection,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { db, auth, firebaseConfig } from './firebase-config.js';

// List of allowed page routes
const VALID_ROUTES = new Set([
  '/',
  '/aboutus',
  '/activities',
  '/welfare',
  '/schedule',
  '/financial',
  '/feedbacks',
  '/news',
  '/supportus',
  '/photos',
  '/admin'
]);

function getHKTDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(date);
}

let path = (window.location.pathname || '/').toLowerCase().replace(/\.html$/, '');
if (path === '/index' || path === '') path = '/';

// Only initiate pageview tracking if the route is valid
if (VALID_ROUTES.has(path)) {
  const pageviewRef = doc(collection(db, "pageviews"));

  const FIRESTORE_COMMIT_URL =
    `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}` +
    `/databases/(default)/documents:commit?key=${firebaseConfig.apiKey}`;

  const PAGEVIEW_DOC_PATH =
    `projects/${firebaseConfig.projectId}/databases/(default)/documents/pageviews/${pageviewRef.id}`;

  function toFirestoreValue(value) {
    if (value === null) return { nullValue: "NULL_VALUE" };
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

  const HEARTBEAT_INTERVAL_MS = 15000;
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
}