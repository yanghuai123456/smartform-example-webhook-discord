// lib/verify.ts — HMAC-SHA256 verification of SmartForm webhook signatures.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const m = header.match(/^sha256=([a-f0-9]{64})$/i);
  if (!m) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(m[1], 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
