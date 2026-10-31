import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Encrypts secrets (WhatsApp access tokens) before they go into the database, with AES-256-GCM.
 * Key comes from ENCRYPTION_KEY. If the key is lost, saved tokens cannot be read and must be
 * entered again, so back it up with your other server secrets.
 */
function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.startsWith('change-me') || raw.length < 32) {
    throw new Error('Set ENCRYPTION_KEY in .env (generate with: openssl rand -hex 32)');
  }
  return createHash('sha256').update(raw).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(stored: string): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1') throw new Error('Unknown encryption format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/** Shows only the last 4 characters, for display. */
export const maskSecret = (s: string) => (s.length <= 4 ? '****' : `****${s.slice(-4)}`);
