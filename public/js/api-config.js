export const API_BASE = 'https://gtcsu-aurora.vercel.app';
const API_ORIGIN = new URL(API_BASE).origin;

export async function apiFetch(input, init = {}) {
  const url = new URL(input, API_BASE);
  if (url.origin !== API_ORIGIN) {
    throw new TypeError('apiFetch only permits requests to the configured Aurora API origin.');
  }

  const headers = new Headers(init.headers || {});
  try {
    const { getAppCheckToken } = await import('./firebase-config.js');
    const appCheckToken = await getAppCheckToken();
    if (appCheckToken) headers.set('X-Firebase-AppCheck', appCheckToken);
  } catch (error) {
    console.warn('Could not obtain Firebase App Check token:', error?.message || error);
  }

  return fetch(url.toString(), { ...init, headers });
}
