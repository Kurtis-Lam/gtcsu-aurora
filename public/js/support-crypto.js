const VERSION = 'v1';

function base64ToBytes(value, urlSafe) {
  let text = String(value || '').replace(/\s+/g, '');
  if (urlSafe || /[-_]/.test(text)) text = text.replace(/-/g, '+').replace(/_/g, '/');
  while (text.length % 4) text += '=';
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function parseEncryptionKey(raw) {
  const value = String(raw || '').trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
  if (!value) throw new Error('Paste the SUPPORT_ENCRYPTION_KEY value first.');

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }

  let bytes;
  try {
    bytes = base64ToBytes(value, false);
  } catch {
    throw new Error('The key is not valid hex or base64.');
  }
  if (bytes.length !== 32) {
    throw new Error('The key must be 32 bytes: 64 hex characters or base64 from "openssl rand -base64 32".');
  }
  return bytes;
}

export async function importAesKey(keyBytes) {
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
}

export async function decryptField(cryptoKey, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Unrecognised ciphertext format');
  const iv = base64ToBytes(parts[1], true);
  const tag = base64ToBytes(parts[2], true);
  const data = base64ToBytes(parts[3], true);
  const joined = new Uint8Array(data.length + tag.length);
  joined.set(data, 0);
  joined.set(tag, data.length);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, cryptoKey, joined);
  return new TextDecoder().decode(plain);
}
