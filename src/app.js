import express from 'express';
import { PortalClient, PortalError } from './client.js';
import { normalizeReading, normalizeMeterSummary } from './normalize.js';

export const app = express();
const portal = new PortalClient();

class BadRequest extends Error {}

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
function meterId(req) {
  if (!ID_RE.test(req.params.id)) throw new BadRequest('Invalid meter id');
  return req.params.id;
}

// Unlike the portal, we do NOT silently coerce bad input: ?page=abc is a 400.
function pageParam(raw) {
  if (raw === undefined) return 1;
  if (!/^[1-9]\d*$/.test(String(raw))) throw new BadRequest('page must be a positive integer');
  return Number(raw);
}

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

app.get('/api/v1/meters', wrap(async (req, res) => {
  const page = pageParam(req.query.page);
  const q = String(req.query.q ?? '');
  const r = await portal.get(`/portal/meters/search?q=${encodeURIComponent(q)}&page=${page}`);
  res.json({
    data: r.data.map(normalizeMeterSummary),
    page: r.page, pageSize: r.pageSize, total: r.total,
  });
}));

app.get('/api/v1/meters/:id/consumption', wrap(async (req, res) => {
  const id = meterId(req);
  const r = await portal.get(`/portal/meters/${id}/energy`);
  const readings = r.data.map(normalizeReading);
  res.json({ meterId: id, count: readings.length, readings });
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