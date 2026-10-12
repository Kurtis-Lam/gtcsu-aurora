import crypto from 'node:crypto';

const VERSION = 'v1';

function loadKey() {
  const raw = process.env.SUPPORT_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) throw new Error('SUPPORT_ENCRYPTION_KEY is not set');
  const value = raw.trim().replace(/^["']|["']$/g, '');

  // Accept the formats people commonly generate: 64 hex characters
  // (openssl rand -hex 32) or 32 bytes as base64 / base64url
  // (openssl rand -base64 32).
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');

  const key = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (key.length !== 32) {
    throw new Error('SUPPORT_ENCRYPTION_KEY must be 32 bytes, base64-encoded (or 64 hex characters)');
  }
  return key;
}

export function isEncryptionConfigured() {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptField(plaintext) {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptField(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Unrecognised ciphertext format');
  const [, iv, tag, data] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}