import { PortalClient } from './client.js';
import { MeterStore } from './store.js';

const s = await new MeterStore(new PortalClient()).get();
const fixed = s.meters.filter((m) => m.repairs.length);
console.log('meters:', s.meters.length, '| with repairs:', fixed.length);
const kinds = {};
fixed.forEach((m) => m.repairs.forEach((r) => { const k = r.replace(/".*"/, '"…"'); kinds[k] = (kinds[k] ?? 0) + 1; }));
console.log(kinds);
console.log('still missing a code:', s.meters.filter((m) => Object.values(m.hierarchy).some((h) => !h.code)).length);