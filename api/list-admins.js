import { guard, bearerToken } from './_lib/http.js';
import { isAdminByRules } from './_lib/auth.js';
import { getServices } from './_lib/firebase.js';

// Lists every Firebase account that carries the `admin: true` custom claim.
// Admins only: the caller is verified through the same Firestore-rules check
// the other admin APIs use. Read-only; grant or revoke with
// scripts/set-admin-claims.js.
export default async function handler(req, res) {
  if (!guard(req, res, 'GET')) return;

  try {
    if (!(await isAdminByRules(bearerToken(req)))) {
      return res.status(403).json({ error: 'Admins only.' });
    }

    const { auth } = getServices();
    const admins = [];
    let pageToken;
    do {
      const page = await auth.listUsers(1000, pageToken);
      for (const u of page.users) {
        if (u.customClaims?.admin !== true) continue;
        admins.push({
          uid: u.uid,
          email: u.email || '',
          displayName: u.displayName || '',
          emailVerified: u.emailVerified === true,
          disabled: u.disabled === true,
          // The Firestore rules need a verified email in addition to the claim.
          active: u.emailVerified === true && u.disabled !== true,
          createdAt: u.metadata?.creationTime || null,
          lastSignInAt: u.metadata?.lastSignInTime || null
        });
      }
      pageToken = page.pageToken;
    } while (pageToken);

    admins.sort((a, b) => a.email.localeCompare(b.email));
    return res.status(200).json({ admins });
  } catch (err) {
    console.error('list-admins error:', err.message);
    return res.status(500).json({ error: 'Could not load admins.' });
  }
}
