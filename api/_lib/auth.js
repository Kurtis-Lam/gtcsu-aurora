import { getServices } from './firebase.js';

export const SCHOOL_DOMAIN = 'gtcollege.edu.hk';

function isSchoolEmail(email) {
  return typeof email === 'string'
    && email.length <= 254
    && /^[^@\s]+@gtcollege[.]edu[.]hk$/i.test(email);
}

async function verifyActiveToken(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 4096) return null;
  try {
    return await getServices().auth.verifyIdToken(idToken, true);
  } catch {
    return null;
  }
}

// Verifies a Firebase ID token (including revocation and disabled-account
// checks) and returns the decoded token, but only when it belongs to a
// verified Google account on the school domain. Otherwise null.
export async function verifySchoolUser(idToken) {
  const decoded = await verifyActiveToken(idToken);
  if (!decoded) return null;
  const ok =
    decoded.email_verified === true &&
    decoded.firebase?.sign_in_provider === 'google.com' &&
    isSchoolEmail(decoded.email);
  return ok ? decoded : null;
}

// Admins are defined ONLY in firestore.rules (isAdmin()). To ask "is this
// caller an admin?" without duplicating that list, we read a doc that only
// isAdmin() may read, using the caller's own ID token. The Firestore REST API
// evaluates the rules for that user:
//   200 / 404 (doc simply doesn't exist) -> rules allowed the read -> admin
//   403                                  -> rules denied           -> not admin
// The token must also be unrevoked and carry the signed admin claim.
export async function verifiedAdmin(idToken) {
  const decoded = await verifyActiveToken(idToken);
  if (!decoded || decoded.admin !== true || decoded.email_verified !== true) return null;
  const { projectId } = getServices();
  const url =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/adminCheck/ping`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
      signal: AbortSignal.timeout(6000)
    });
    return res.status === 200 || res.status === 404 ? decoded : null;
  } catch {
    return null;
  }
}

export async function isAdminByRules(idToken) {
  return (await verifiedAdmin(idToken)) !== null;
}

// School accounts and administrators may use the gallery.
export async function authenticateGalleryUser(idToken) {
  const school = await verifySchoolUser(idToken);
  if (school) {
    const admin = school.admin === true ? await isAdminByRules(idToken) : false;
    return { decoded: school, admin };
  }
  const adminDecoded = await verifiedAdmin(idToken);
  return adminDecoded ? { decoded: adminDecoded, admin: true } : null;
}