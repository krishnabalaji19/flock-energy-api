// Portal sends every number as a string and timestamps as "DD/MM/YYYY HH:mm" with no timezone.
// ASSUMPTION: times are Indian Standard Time (utility is in Jaipur) -> +05:30.

export function toNumber(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  
  export function toIsoTimestamp(s) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(String(s ?? '').trim());
    if (!m) return null;
    const [, dd, mm, yyyy, hh, min] = m;
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:00+05:30`;
  }
  
  export function normalizeReading(r) {
    return {
      timestamp: toIsoTimestamp(r.timestamp),
      kwh: toNumber(r.kwh),
      kvah: toNumber(r.kvah),
      voltR: toNumber(r.voltR),
    };
  }
  
  export function normalizeMeterSummary(m) {
    return {
      meterId: m.meterId,
      serialNumber: m.serialNo,
      make: m.make,
      phaseType: m.phaseType,
      installStatus: m.installStatus,
      dtCode: m.dtCode,
    };
  }