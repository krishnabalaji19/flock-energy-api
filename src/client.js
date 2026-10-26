import 'dotenv/config';
import { createHmac } from 'node:crypto';

const BASE = process.env.PORTAL_URL ?? 'https://urja-ops.flockenergy.tech';
const TIMEOUT_MS = 10_000;

// One error type for everything that goes wrong talking to the portal.
// `code` is what our API layer will map to an HTTP status later.
export class PortalError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'PortalError';
    this.code = code;     // 'not_found' | 'login_failed' | 'timeout' | 'unreachable' | 'bad_response'
    this.status = status; // the portal's HTTP status, if there was one
  }
}

export class PortalClient {
  #cookie = null;
  #loginInFlight = null;

  // If 5 requests arrive at once with no session, they share ONE login.
  #login() {
    this.#loginInFlight ??= this.#doLogin().finally(() => { this.#loginInFlight = null; });
    return this.#loginInFlight;
  }

  async #doLogin() {
    const res = await this.#fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE },
      body: new URLSearchParams({
        email: process.env.PORTAL_EMAIL,
        password: process.env.PORTAL_PASSWORD,
      }),
    });
    const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
    const body = await res.json().catch(() => null);
    // Success is NOT just "status 200": the body must say redirect AND we must get a cookie.
    if (!res.ok || body?.type !== 'redirect' || cookies.length === 0) {
      throw new PortalError('Portal login failed', 'login_failed', res.status);
    }
    this.#cookie = cookies.join('; ');
  }

  // fetch with a timeout, and network problems turned into PortalError
  async #fetch(path, options = {}) {
    try {
      return await fetch(BASE + path, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...options,
      });
    } catch (err) {
      if (err.name === 'TimeoutError') throw new PortalError('Portal timed out', 'timeout');
      throw new PortalError(`Portal unreachable: ${err.cause?.code ?? err.message}`, 'unreachable');
    }
  }

  #send(path, headers) {
    return this.#fetch(path, { headers: { cookie: this.#cookie, ...headers } });
  }

  async #errorCode(res) {
    try { return (await res.clone().json()).error ?? 'unknown'; } catch { return 'unknown'; }
  }

  async get(path, headers = {}) {
    if (!this.#cookie) await this.#login();
    let res = await this.#send(path, headers);
    // Only log in again when the SESSION is the problem, not for any 401.
    if (res.status === 401 && (await this.#errorCode(res)) === 'unauthorized') {
      await this.#login();
      res = await this.#send(path, headers);
    }
    if (res.status === 404) throw new PortalError('Not found', 'not_found', 404);
    if (res.status === 401 || res.status === 403) {
      throw new PortalError(`Portal rejected the request: ${await this.#errorCode(res)}`, 'rejected', res.status);
    }
    if (!res.ok) throw new PortalError(`Portal returned ${res.status}`, 'bad_response', res.status);
    try {
      return await res.json();
    } catch {
      throw new PortalError('Portal returned non-JSON', 'bad_response', res.status);
    }
  }

  async signedGet(path, query) {
    const { data } = await this.get('/portal/keys');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const message = ['GET', path, query, timestamp].join('\n');
    const signature = createHmac('sha256', data.signingSecret).update(message).digest('hex');
    return this.get(`${path}?${query}`, { 'x-timestamp': timestamp, 'x-signature': signature });
  }


  // For testing the re-login path only.
  simulateExpiredSession() {
    this.#cookie = '__Secure-better-auth.session_token=bogus';
  }
}