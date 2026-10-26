import { createHmac } from 'node:crypto';

// The portal's own page JS signs "METHOD\nPATH\nQUERY\nTIMESTAMP" with HMAC-SHA256 (hex).
// Kept as a pure function so it can be unit-tested without the network.
export function signRequest(secret, method, path, query, timestamp) {
  const message = [method, path, query, timestamp].join('\n');
  return createHmac('sha256', secret).update(message).digest('hex');
}