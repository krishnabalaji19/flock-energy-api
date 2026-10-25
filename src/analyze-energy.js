import { PortalClient } from './client.js';

const c = new PortalClient();
for (const id of ['J100001', 'J100004', 'J100000']) {   // legacy, v2, decommissioned
  const { data } = await c.get(`/portal/meters/${id}/energy`);
  console.log(`\n== ${id}: ${data.length} rows`);
  console.log('first:', JSON.stringify(data[0]));
  console.log('last: ', JSON.stringify(data.at(-1)));
  console.log('keys: ', Object.keys(data[0]));
  const bad = data.filter(r => Object.values(r).some(v => v === null || v === '' || Number.isNaN(Number(v)) && !String(v).includes('/')));
  console.log('rows with null/empty/non-numeric:', bad.length, bad.slice(0, 2));
  let drops = 0, dup = 0;
  for (let i = 1; i < data.length; i++) {
    if (Number(data[i].kwh) < Number(data[i - 1].kwh)) drops++;
    if (data[i].timestamp === data[i - 1].timestamp) dup++;
  }
  console.log('kwh decreases:', drops, '| duplicate timestamps:', dup);
}