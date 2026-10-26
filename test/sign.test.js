import test from 'node:test';
import assert from 'node:assert/strict';
import { signRequest } from '../src/sign.js';

// Golden value, computed independently with:
//   printf 'GET\n/portal/export\npage=1\n1792946450' | openssl dgst -sha256 -hmac test-secret
const GOLDEN = 'ebef22e25fc98ead824ae58e95334121ba5520cef2f00acc8acf6176cd05e7af';

test('signRequest matches an independently computed HMAC-SHA256 hex value', () => {
  assert.equal(signRequest('test-secret', 'GET', '/portal/export', 'page=1', '1792946450'), GOLDEN);
});

test('signature is 64 lowercase hex characters', () => {
  assert.match(signRequest('k', 'GET', '/p', 'q=1', '1'), /^[0-9a-f]{64}$/);
});

test('every part of the request changes the signature', () => {
  const base = signRequest('k', 'GET', '/portal/export', 'page=1', '100');
  assert.notEqual(base, signRequest('other', 'GET', '/portal/export', 'page=1', '100'));
  assert.notEqual(base, signRequest('k', 'POST', '/portal/export', 'page=1', '100'));
  assert.notEqual(base, signRequest('k', 'GET', '/portal/other', 'page=1', '100'));
  assert.notEqual(base, signRequest('k', 'GET', '/portal/export', 'page=2', '100'));
  assert.notEqual(base, signRequest('k', 'GET', '/portal/export', 'page=1', '101'));
});