import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '../config/env';
import { AppError } from './errors';

function key(): Buffer {
  const hex = env.SLACK_TOKEN_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new AppError(
      503,
      'SLACK_TOKEN_ENCRYPTION_KEY must be 64 hex characters (generate with: openssl rand -hex 32)',
      'misconfigured',
    );
  }
  return Buffer.from(hex, 'hex');
}

/** AES-256-GCM. Output format: v1.<iv>.<authTag>.<ciphertext> (all base64). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

export function decrypt(payload: string): string {
  const [v, iv, tag, ct] = payload.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported ciphertext format');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
