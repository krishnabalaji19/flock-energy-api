import { PortalClient } from './client.js';

const c = new PortalClient();
const r = await c.signedGet('/portal/export', 'page=1');
console.log('total:', r.total, '| rows:', r.data.length, '| first:', r.data[0].meterId);