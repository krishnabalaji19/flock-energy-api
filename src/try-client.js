import { PortalClient, PortalError } from './client.js';

const c = new PortalClient();
const a = await c.get('/portal/meters/search?q=&page=1');
console.log('1. normal:', a.total);

c.simulateExpiredSession();                       // pretend the session died
const b = await c.get('/portal/meters/search?q=&page=1');
console.log('2. after fake expiry (auto re-login):', b.total);

try { await c.get('/portal/meters/J999999/energy'); }
catch (e) { console.log('3. missing meter ->', e instanceof PortalError, e.code); }