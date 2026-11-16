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

// Admins are defined by the signed admin claim plus verified Google-account
// requirements, the same conditions firestore.rules (isAdmin()) enforces. The
// ID token is verified with revocation and disabled-account checks above.
export async function verifiedAdmin(idToken) {
  const decoded = await verifyActiveToken(idToken);
  if (
    !decoded
    || decoded.admin !== true
    || decoded.email_verified !== true
    || decoded.firebase?.sign_in_provider !== 'google.com'
  ) return null;
  return decoded;
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