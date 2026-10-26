import test from 'node:test';
import assert from 'node:assert/strict';
import { MeterStore, buildTree } from '../src/store.js';

// Build a raw export row. `circle` and `dt` can be overridden to create messy data.
const row = (id, { circle = { code: 'C-01', name: 'Circle 1' }, dt = { code: 'DT-001', name: 'DT One' }, geo = { lat: 26.8, lng: 75.9 } } = {}) => ({
  meterId: id, serialNo: `S${id}`, make: 'HPL', phaseType: 'single', installStatus: 'Installed',
  installType: 'CT Operated', build: 'v2', dtCode: dt.code, geo,
  hierarchy: {
    zone: { code: 'Z-01', name: 'Zone 1' }, circle,
    division: { code: 'D-01', name: 'Division 1' }, subdivision: { code: 'SD-01', name: 'Subdivision 1' },
    substation: { code: 'SS-01', name: 'Substation 1' }, feeder: { code: 'F-01', name: 'Feeder 1' }, dt,
  },
});

const fakePortal = (rows) => {
  const p = { calls: 0, fail: false };
  p.signedGet = async () => {
    p.calls++;
    await new Promise((r) => setTimeout(r, 5));
    if (p.fail) throw new Error('portal down');
    return { data: rows, total: rows.length };
  };
  return p;
};

test('fills a missing circle code from the circle name', async () => {
  const rows = [row('A'), row('B'), row('C', { circle: { code: '', name: 'Circle 1' } })];
  const snap = await new MeterStore(fakePortal(rows)).get();
  const c = snap.byId.get('C');
  assert.equal(c.hierarchy.circle.code, 'C-01');
  assert.deepEqual(c.repairs, ['circle.code inferred from name']);
  assert.deepEqual(snap.byId.get('A').repairs, []);
});

test('fills a missing circle name from the circle code', async () => {
  const rows = [row('A'), row('B'), row('C', { circle: { code: 'C-01', name: '' } })];
  const snap = await new MeterStore(fakePortal(rows)).get();
  assert.equal(snap.byId.get('C').hierarchy.circle.name, 'Circle 1');
  assert.deepEqual(snap.byId.get('C').repairs, ['circle.name inferred from code']);
});

test('replaces a minority DT name with the majority name and records it', async () => {
  const odd = { code: 'DT-001', name: 'Old Xfmr' };
  const rows = [row('A'), row('B'), row('C'), row('D', { dt: odd })];
  const snap = await new MeterStore(fakePortal(rows)).get();
  assert.equal(snap.byId.get('D').hierarchy.dt.name, 'DT One');
  assert.match(snap.byId.get('D').repairs[0], /dt\.name "Old Xfmr" replaced by majority name/);
});

test('geo becomes numbers, or null when coordinates are missing', async () => {
  const rows = [row('A', { geo: { lat: '26.5', lng: '75.5' } }), row('B', { geo: { lat: null, lng: 75.9 } }), row('C', { geo: null })];
  const snap = await new MeterStore(fakePortal(rows)).get();
  assert.deepEqual(snap.byId.get('A').geo, { latitude: 26.5, longitude: 75.5 });
  assert.equal(snap.byId.get('B').geo, null);
  assert.equal(snap.byId.get('C').geo, null);
});

test('caches: two calls inside the TTL hit the portal once', async () => {
  const portal = fakePortal([row('A')]);
  const store = new MeterStore(portal, { ttlMs: 60_000 });
  await store.get();
  await store.get();
  assert.equal(portal.calls, 1);
});

test('concurrent callers share a single portal request', async () => {
  const portal = fakePortal([row('A')]);
  const store = new MeterStore(portal, { ttlMs: 60_000 });
  await Promise.all([store.get(), store.get(), store.get(), store.get(), store.get()]);
  assert.equal(portal.calls, 1);
});

test('serves stale data (flagged) when a refresh fails', async () => {
  const portal = fakePortal([row('A')]);
  const store = new MeterStore(portal, { ttlMs: 0 });   // always considered expired
  const first = await store.get();
  assert.equal(first.stale, false);
  portal.fail = true;
  const second = await store.get();
  assert.equal(second.stale, true);
  assert.equal(second.meters.length, 1);
});

test('throws when the first load fails (nothing to fall back on)', async () => {
  const portal = fakePortal([row('A')]);
  portal.fail = true;
  await assert.rejects(() => new MeterStore(portal).get(), /portal down/);
});

test('buildTree nests the hierarchy and counts meters at every node', async () => {
  const rows = [row('A'), row('B'), row('C', { circle: { code: 'C-02', name: 'Circle 2' } })];
  const snap = await new MeterStore(fakePortal(rows)).get();
  const tree = buildTree(snap.meters);
  assert.equal(tree.length, 1);                       // one zone
  assert.equal(tree[0].meterCount, 3);
  assert.deepEqual(tree[0].children.map((c) => [c.code, c.meterCount]), [['C-01', 2], ['C-02', 1]]);
});