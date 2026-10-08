import { getServices } from './firebase.js';

export const SCHOOL_DOMAIN = 'gtcollege.edu.hk';

function isSchoolEmail(email) {
  return typeof email === 'string'
    && email.length <= 254
    && /^[^@\s]+@gtcollege[.]edu[.]hk$/i.test(email);
}

// Verifies a Firebase ID token and returns the decoded token, but only when it
// belongs to a verified Google account on the school domain. Otherwise null.
export async function verifySchoolUser(idToken) {
  if (!idToken) return null;
  try {
    const decoded = await getServices().auth.verifyIdToken(idToken);
    const ok =
      decoded.email_verified === true &&
      decoded.firebase?.sign_in_provider === 'google.com' &&
      isSchoolEmail(decoded.email);
    return ok ? decoded : null;
  } catch {
    return null;
  }
}

// Admins are defined ONLY in firestore.rules (isAdmin()). To ask "is this
// caller an admin?" without duplicating that list, we read a doc that only
// isAdmin() may read, using the caller's own ID token. The Firestore REST API
// evaluates the rules for that user:
//   200 / 404 (doc simply doesn't exist) -> rules allowed the read -> admin
//   403                                  -> rules denied           -> not admin
export async function isAdminByRules(idToken) {
  if (!idToken) return false;
  const { projectId } = getServices();
  const url =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/adminCheck/ping`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
      signal: AbortSignal.timeout(6000)
    });
    return res.status === 200 || res.status === 404;
  } catch {
    return false;
  }
}