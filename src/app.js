import express from 'express';
import { PortalClient, PortalError } from './client.js';
import { normalizeReading } from './normalize.js';
import { MeterStore, buildTree } from './store.js';

export const app = express();
const portal = new PortalClient();
const store = new MeterStore(portal);

class BadRequest extends Error {}

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
function meterId(req) {
  if (!ID_RE.test(req.params.id)) throw new BadRequest('Invalid meter id');
  return req.params.id;
}

// We do NOT silently coerce bad input like the portal does: ?page=abc is a 400.
function intParam(raw, name, def, max) {
  if (raw === undefined) return def;
  if (!/^[1-9]\d*$/.test(String(raw))) throw new BadRequest(`${name} must be a positive integer`);
  const n = Number(raw);
  if (max && n > max) throw new BadRequest(`${name} must be <= ${max}`);
  return n;
}

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

function freshness(res, snap) {
  res.set('X-Data-Fetched-At', new Date(snap.fetchedAt).toISOString());
  if (snap.stale) res.set('X-Data-Stale', 'true');
}

const summary = (m) => ({
  meterId: m.meterId, serialNumber: m.serialNumber, make: m.make,
  phaseType: m.phaseType, installStatus: m.installStatus, dtCode: m.dtCode,
});

app.get('/', (req, res) => {
  res.json({ name: 'Urja Meter Ops API', version: '1.0.0', docs: '/docs' });
});

app.get('/api/v1/meters', wrap(async (req, res) => {
  const page = intParam(req.query.page, 'page', 1);
  const pageSize = intParam(req.query.pageSize, 'pageSize', 20, 100);
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const status = String(req.query.status ?? '').trim().toLowerCase();
  const make = String(req.query.make ?? '').trim().toLowerCase();
  const dt = String(req.query.dtCode ?? '').trim().toLowerCase();

  const snap = await store.get();
  const filtered = snap.meters.filter((m) =>
    (!q || m.meterId.toLowerCase().includes(q) || m.serialNumber.toLowerCase().includes(q)) &&
    (!status || m.installStatus.toLowerCase() === status) &&
    (!make || m.make.toLowerCase() === make) &&
    (!dt || m.dtCode.toLowerCase() === dt));
  const start = (page - 1) * pageSize;
  freshness(res, snap);
  res.json({ data: filtered.slice(start, start + pageSize).map(summary), page, pageSize, total: filtered.length });
}));

app.get('/api/v1/meters/:id', wrap(async (req, res) => {
  const id = meterId(req);
  const snap = await store.get();
  const m = snap.byId.get(id);
  if (!m) throw new PortalError('Not found', 'not_found', 404);
  freshness(res, snap);
  res.json(m);
}));

app.get('/api/v1/meters/:id/consumption', wrap(async (req, res) => {
  const id = meterId(req);
  const r = await portal.get(`/portal/meters/${id}/energy`);
  const readings = r.data.map(normalizeReading);
  res.json({ meterId: id, count: readings.length, readings });
}));

app.get('/api/v1/hierarchy', wrap(async (req, res) => {
  const snap = await store.get();
  freshness(res, snap);
  res.json({ data: buildTree(snap.meters), meterCount: snap.meters.length });
}));

app.use((err, req, res, _next) => {
  if (err instanceof BadRequest) return res.status(400).json({ error: 'bad_request', message: err.message });
  if (err instanceof PortalError) {
    const map = { not_found: 404, timeout: 504, unreachable: 502, login_failed: 502, bad_response: 502 };
    const status = map[err.code] ?? 502;
    const message = err.code === 'not_found' ? 'Meter not found' : 'Upstream portal problem';
    return res.status(status).json({ error: err.code, message });
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: 'Unexpected error' });
});