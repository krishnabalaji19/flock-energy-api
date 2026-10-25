import 'dotenv/config';

const BASE = process.env.PORTAL_URL;

async function login() {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    redirect: 'manual',                       // don't auto-follow; we want to see the raw reply
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BASE,                            // SvelteKit usually checks this on form posts
    },
    body: new URLSearchParams({
      email: process.env.PORTAL_EMAIL,
      password: process.env.PORTAL_PASSWORD,
    }),
  });
  console.log('login status:', res.status, '| location:', res.headers.get('location'));
  console.log('login body:', (await res.text()).slice(0, 200));
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
  console.log('cookie names:', cookies.map((c) => c.split('=')[0]));
  return cookies.join('; ');
}

const cookie = await login();

// 1) with the session cookie
let r = await fetch(`${BASE}/portal/meters/search?q=&page=1`, { headers: { cookie }, redirect: 'manual' });
console.log('\nWITH cookie  ->', r.status, r.headers.get('content-type'));
const j = await r.json();
console.log('total:', j.total, '| first:', j.data?.[0]?.meterId);

// 2) without a cookie: this is how an expired session will look
r = await fetch(`${BASE}/portal/meters/search?q=&page=1`, { redirect: 'manual' });
console.log('\nNO cookie    ->', r.status, r.headers.get('content-type'), '| location:', r.headers.get('location'));
console.log((await r.text()).slice(0, 200));

// 3) edge cases, still read-only
for (const path of ['/portal/meters/search?q=&page=22', '/portal/meters/search?q=&page=0',
                    '/portal/meters/search?q=&page=abc', '/portal/meters/J999999/energy']) {
  r = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' });
  console.log('\n' + path, '->', r.status);
  console.log((await r.text()).slice(0, 150));
}