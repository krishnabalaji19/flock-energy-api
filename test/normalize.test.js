import test from 'node:test';
import assert from 'node:assert/strict';
import { toNumber, toIsoTimestamp, normalizeReading } from '../src/normalize.js';

test('toNumber converts numeric strings', () => {
  assert.equal(toNumber('124.50'), 124.5);
  assert.equal(toNumber('226'), 226);
});

test('toNumber keeps zero as 0 (a zero reading is not "no reading")', () => {
  assert.equal(toNumber('0'), 0);
});

test('toNumber returns null for empty or non-numeric input', () => {
  for (const bad of ['', '   ', null, undefined, 'abc', 'NaN']) {
    assert.equal(toNumber(bad), null, `input: ${String(bad)}`);
  }
});

test('toIsoTimestamp converts DD/MM/YYYY HH:mm to ISO 8601 with IST offset', () => {
  assert.equal(toIsoTimestamp('23/06/2026 23:30'), '2026-06-23T23:30:00+05:30');
  assert.equal(toIsoTimestamp(' 01/02/2026 00:00 '), '2026-02-01T00:00:00+05:30');
});

test('toIsoTimestamp returns null for unexpected formats', () => {
  for (const bad of ['2026-06-23 23:30', '23/06/2026', '', null, undefined]) {
    assert.equal(toIsoTimestamp(bad), null, `input: ${String(bad)}`);
  }
});

test('normalizeReading turns the portal string row into typed values', () => {
  const out = normalizeReading({ timestamp: '23/06/2026 23:30', kwh: '42594.05', kvah: '46001.58', voltR: '231' });
  assert.deepEqual(out, { timestamp: '2026-06-23T23:30:00+05:30', kwh: 42594.05, kvah: 46001.58, voltR: 231 });
});