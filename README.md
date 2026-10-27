# Urja Meter Ops API

A clean, documented REST API in front of the legacy **Urja Meter Ops** web portal (no API of its own). Callers get typed JSON; login, session handling and request signing happen inside this service.

- How the portal works: [PROTOCOL.md](./PROTOCOL.md)
- API description: [openapi.json](./openapi.json), also served at `/openapi.json`, with Swagger UI at `/docs`
- Reflection: [REFLECTION.md](./REFLECTION.md)

## What it does

| Endpoint | Description |
|---|---|
| `GET /api/v1/meters` | Paginated list. Filters: `q` (meter ID or serial substring), `status`, `make`, `dtCode`, `page`, `pageSize` (max 100) |
| `GET /api/v1/meters/{id}` | One meter with hierarchy, location and a `repairs` list |
| `GET /api/v1/meters/{id}/consumption` | Readings oldest first, with typed numbers and ISO 8601 timestamps (half-hourly for some meters, daily for others) |
| `GET /api/v1/hierarchy` | Zone > circle > division > subdivision > substation > feeder > DT tree with meter counts |

## Structure

```
src/
  client.js     portal client: login, cookie session, re-login on expiry, timeouts, typed errors, signed requests
  sign.js       request signature (HMAC-SHA256), a pure function
  store.js      in-memory snapshot of the portal's bulk export, hierarchy repair, hierarchy tree
  normalize.js  strings to numbers, DD/MM/YYYY HH:mm to ISO 8601
  app.js        Express routes, input validation, error mapping, /docs
  server.js     starts the server
test/           unit tests (node:test)
```

Request flow: `caller -> Express (app.js) -> store.js / client.js -> portal`.

## Run it

Requires **Node 20+** (built-in `fetch`; developed on Node 24).

```bash
git clone https://github.com/krishnabalaji19/flock-energy-api.git
cd flock-energy-api
npm install
cp .env.example .env     # then put the password from the assignment brief into .env
npm start                # http://localhost:3000   (docs at /docs)
npm test                 # 18 unit tests, no network needed
```

Configuration (`.env`): `PORTAL_URL`, `PORTAL_EMAIL`, `PORTAL_PASSWORD`, optional `PORT` (3000) and `EXPORT_TTL_MS` (600000, how long the bulk snapshot is reused).

## Sample request

```bash
curl -s localhost:3000/api/v1/meters/J100001
```

```json
{
  "meterId": "J100001", "serialNumber": "GE84132", "make": "L&T", "phaseType": "single",
  "installStatus": "Installed", "installType": "CT Operated", "build": "legacy", "dtCode": "DT-002",
  "hierarchy": {
    "zone": {"code": "Z-02", "name": "Jaipur Zone 2"}, "circle": {"code": "C-02", "name": "Circle 2"},
    "division": {"code": "D-02", "name": "Division 2"}, "subdivision": {"code": "SD-02", "name": "Subdivision 2"},
    "substation": {"code": "SS-02", "name": "Substation 2"}, "feeder": {"code": "F-002", "name": "Feeder 2"},
    "dt": {"code": "DT-002", "name": "Mansarovar DT 2"}
  },
  "geo": {"latitude": 26.822136543835608, "longitude": 75.90718190602279},
  "repairs": []
}
```

More: `curl "localhost:3000/api/v1/meters?status=faulty&make=hpl&pageSize=3"`, `curl localhost:3000/api/v1/meters/J100001/consumption`, `curl localhost:3000/api/v1/hierarchy`.

Errors are JSON `{"error", "message"}`: **400** bad input (for example `?page=abc`, `pageSize=500`), **404** unknown meter, **502** portal unreachable or rejected our request, **504** portal timed out.

## Design decisions and trade-offs

- **Use the portal's bulk export for everything except consumption.** `/portal/export` returns all 403 meters with hierarchy and location in one call, against 21 search pages plus 403 `/geo` calls. The cost is that it needs a signed request (see PROTOCOL.md), which I reproduced from the portal's own page JavaScript.
- **Snapshot cache with a TTL (10 min, configurable).** One refresh at a time even when many requests arrive together; if a refresh fails, the old snapshot is served with `X-Data-Stale: true`. `X-Data-Fetched-At` tells callers how old the data is. Consumption is **not** cached and is fetched live. The data I saw ends in June 2026, so a longer TTL would likely be safe; I kept 10 minutes because I could not tell how often the portal changes.
- **Session handling.** Login on first use, one shared login when several requests need it, and one re-login when the portal answers `unauthorized`. A rejected signature is deliberately **not** treated as an expired session, since logging in again cannot fix it.
- **Strict inputs, honest errors.** The portal silently accepts bad `page` values; this API returns 400. Portal 404 becomes 404, and upstream trouble becomes 502 or 504, so callers can tell their mistake from ours.
- **Repair messy hierarchy data, visibly.** 25 of 403 meters had a missing hierarchy name or code, and one transformer (DT-007) had two names. Gaps are filled from other rows with the same code or name, and the majority name wins. Every repair is listed in the meter's `repairs`. The majority choice for DT-007 matches the portal's own transformer list.
- **Normalised types.** Numbers are numbers; empty values become `null`, not `0`.
- **Hand-written OpenAPI.** Simpler than adding a generator for four endpoints, but it can drift from the code, so I checked each endpoint against real responses in `/docs`.

## Assumptions

- Portal timestamps have no timezone; I assume **IST (+05:30)** since the utility is in Jaipur.
- `kwh` and `kvah` are cumulative register readings (they never decreased in sampled meters), so usage over a period is a difference.
- The portal data is a static snapshot (readings end 30/06/2026).
- Substring, case-insensitive matching for `q` (I did not verify how the portal's own search matches).
- The export ignores `page` and always returns everything.
- Readings are passed through as the portal reports them: empty values become null, but duplicates, gaps and outliers are not corrected.

## Intentionally skipped

- No authentication or rate limiting on this API (a real deployment needs both).
- No persistent database or cache; the snapshot lives in memory and is lost on restart.
- No transformer endpoint (`/portal/dts`), no consumption caching, no date filtering of readings (the portal has no parameters for it).
- No HTTP-level (route) tests; unit tests cover normalising, signing, repair, caching and the hierarchy tree.
- No Docker, no CI, no web client.
- Not investigated: what `build: legacy|v2` means, session expiry time, wrong-password response, whether the `Origin` header is required for login.
- Data-quality handling for readings (for example J100089’s duplicate row).

## What I would improve with more time

- Route tests against a fake portal, and a test that checks the OpenAPI file against real responses.
- Generate `openapi.json` from validation schemas so it cannot drift.
- Persist the snapshot, and refresh in the background before it goes stale.
- A `/health` endpoint and structured logging.
- Date filtering and interval usage (differences of `kwh`) for consumption.
- A local index for "meters near this location", noting that the in-memory scan I use is fine for hundreds of meters and would need an index at hundreds of thousands.

## Reflection

See [REFLECTION.md](./REFLECTION.md).