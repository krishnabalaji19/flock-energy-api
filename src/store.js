const TTL_MS = Number(process.env.EXPORT_TTL_MS ?? 10 * 60 * 1000);
const LEVELS = ['zone', 'circle', 'division', 'subdivision', 'substation', 'feeder', 'dt'];

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v) => String(v ?? '').trim();

// count how often each (code, name) pairing appears, so we can pick the majority value
function buildStats(rows) {
  const stats = Object.fromEntries(LEVELS.map((l) => [l, { nameByCode: new Map(), codeByName: new Map() }]));
  const tally = (map, key, val) => {
    const inner = map.get(key) ?? new Map();
    inner.set(val, (inner.get(val) ?? 0) + 1);
    map.set(key, inner);
  };
  for (const r of rows) {
    for (const l of LEVELS) {
      const code = str(r.hierarchy?.[l]?.code);
      const name = str(r.hierarchy?.[l]?.name);
      if (code && name) {
        tally(stats[l].nameByCode, code, name);
        tally(stats[l].codeByName, name, code);
      }
    }
  }
  return stats;
}

const majority = (map, key) => {
  const inner = map.get(key);
  return inner ? [...inner.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
};

function cleanMeter(r, stats) {
  const repairs = [];
  const hierarchy = {};
  for (const l of LEVELS) {
    let code = str(r.hierarchy?.[l]?.code);
    let name = str(r.hierarchy?.[l]?.name);
    if (!code && name) {
      const c = majority(stats[l].codeByName, name);
      if (c) { code = c; repairs.push(`${l}.code inferred from name`); }
    }
    if (code && !name) {
      const n = majority(stats[l].nameByCode, code);
      if (n) { name = n; repairs.push(`${l}.name inferred from code`); }
    }
    if (code) {
      const n = majority(stats[l].nameByCode, code);
      if (n && name !== n) { repairs.push(`${l}.name "${name}" replaced by majority name`); name = n; }
    }
    hierarchy[l] = { code: code || null, name: name || null };
  }
  const latitude = num(r.geo?.lat);
  const longitude = num(r.geo?.lng);
  return {
    meterId: str(r.meterId),
    serialNumber: str(r.serialNo),
    make: str(r.make),
    phaseType: str(r.phaseType),
    installStatus: str(r.installStatus),
    installType: str(r.installType),
    build: str(r.build),
    dtCode: str(r.dtCode),
    hierarchy,
    geo: latitude === null || longitude === null ? null : { latitude, longitude },
    repairs,
  };
}

export function buildTree(meters) {
  const root = { children: new Map() };
  for (const m of meters) {
    let node = root;
    for (const l of LEVELS) {
      const h = m.hierarchy[l];
      const key = h.code ?? `unknown:${h.name ?? '?'}`;
      if (!node.children.has(key)) {
        node.children.set(key, { level: l, code: h.code, name: h.name, meterCount: 0, children: new Map() });
      }
      node = node.children.get(key);
      node.meterCount++;
    }
  }
  const toArray = (n) => [...n.children.values()].map((c) => ({
    level: c.level, code: c.code, name: c.name, meterCount: c.meterCount, children: toArray(c),
  }));
  return toArray(root);
}

export class MeterStore {
  #portal;
  #snapshot = null;
  #inflight = null;

  constructor(portal) { this.#portal = portal; }

  async get() {
    if (this.#snapshot && Date.now() - this.#snapshot.fetchedAt < TTL_MS) return this.#snapshot;
    try {
      return await this.#refresh();
    } catch (err) {
      if (this.#snapshot) {
        console.warn('export refresh failed, serving stale data:', err.message);
        return { ...this.#snapshot, stale: true };
      }
      throw err;
    }
  }

  #refresh() {
    this.#inflight ??= this.#build().finally(() => { this.#inflight = null; });
    return this.#inflight;
  }

  async #build() {
    const raw = await this.#portal.signedGet('/portal/export', 'page=1');
    const stats = buildStats(raw.data);
    const meters = raw.data.map((r) => cleanMeter(r, stats));
    this.#snapshot = { meters, byId: new Map(meters.map((m) => [m.meterId, m])), fetchedAt: Date.now(), stale: false };
    return this.#snapshot;
  }
}