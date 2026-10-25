import { PortalClient } from './client.js';

const c = new PortalClient();
const { data: meters } = await c.get('/portal/meters/search?q=&page=1'); // just to warm the session
const ids = [];
for (let p = 1; p <= 21; p++) {
  const r = await c.get(`/portal/meters/search?q=&page=${p}`);
  ids.push(...r.data.map(m => m.meterId));
}
console.log('meters listed via search:', ids.length, '| unique:', new Set(ids).size);

const STEP = 30 * 60 * 1000;
const parse = s => { const m = /^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d)$/.exec(s); return m ? Date.UTC(+m[3], +m[2]-1, +m[1], +m[4], +m[5]) : NaN; };
const issues = {};
const note = (k, id) => (issues[k] ??= []).push(id);
const rowCounts = {};

for (const id of ids) {
  try {
    const { data } = await c.get(`/portal/meters/${id}/energy`);
    rowCounts[data.length] = (rowCounts[data.length] ?? 0) + 1;
    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      if (!Number.isFinite(parse(r.timestamp))) note('bad timestamp format', id);
      for (const k of ['kwh', 'kvah', 'voltR']) {
        if (r[k] === null || r[k] === '' || !Number.isFinite(Number(r[k]))) note(`bad ${k}`, id);
      }
      if (Number(r.voltR) > 300 || Number(r.voltR) < 100) note('voltage outlier', id);
      if (Number(r.kvah) < Number(r.kwh)) note('kvah < kwh', id);
      if (i > 0) {
        const dt = parse(r.timestamp) - parse(data[i-1].timestamp);
        if (dt !== STEP) note(dt === 0 ? 'duplicate ts' : dt < 0 ? 'out of order' : 'gap', id);
        if (Number(r.kwh) < Number(data[i-1].kwh)) note('kwh decrease', id);
      }
    }
  } catch (e) { note(`error ${e.code ?? e.message}`, id); }
  await new Promise(r => setTimeout(r, 30));
}
console.log('row counts:', rowCounts);
for (const [k, v] of Object.entries(issues)) console.log(k, '->', new Set(v).size, 'meters, e.g.', [...new Set(v)].slice(0, 5));
if (!Object.keys(issues).length) console.log('no issues found');