import { getServices } from './firebase.js';

const MAX_APP_CHECK_TOKEN_LENGTH = 4096;

export async function verifyRequestAppCheck(req, res) {
  const configuredMode = String(process.env.APP_CHECK_MODE || 'monitor').trim().toLowerCase();
  if (configuredMode === 'off') return true;

  const enforce = configuredMode !== 'monitor';
  const token = req.headers['x-firebase-appcheck'];
  const validShape = typeof token === 'string'
    && token.length >= 20
    && token.length <= MAX_APP_CHECK_TOKEN_LENGTH;

  if (!validShape) {
    if (enforce) {
      res.status(401).json({ error: 'A valid app attestation is required.', code: 'APP_CHECK_REQUIRED' });
      return false;
    }
    return true;
  }

  try {
    await getServices().appCheck.verifyToken(token);
    return true;
  } catch (error) {
    console.warn('App Check token verification failed:', error?.code || 'verification-failed');
    if (enforce) {
      res.status(401).json({ error: 'A valid app attestation is required.', code: 'APP_CHECK_INVALID' });
      return false;
    }
    return true;
  }
}
