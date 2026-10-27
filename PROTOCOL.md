# PROTOCOL.md: how the Urja Meter Ops portal works

Everything here was observed as a normal logged-in user: browser DevTools (Network and Sources tabs), then each request replayed from Node. Items marked *(untested)* are guesses.

## 1. Overview

- Base URL: `https://urja-ops.flockenergy.tech`
- It looks like a SvelteKit single-page app *(inferred from `__data.json?x-sveltekit-invalidated=...` requests and hashed `_app/immutable` assets)*. Pages render in the browser from **JSON endpoints under `/portal/`**, so no HTML scraping is needed.
- Pages: Meters (searchable, 20 per page), a meter detail page (nameplate, hierarchy breadcrumb, location, consumption), and Transformers (with an "Export all meters" button). "Ops Desk" in the nav is a plain label with no link and no request.
- The page number lives in client state, so the address bar does not change when paging.

## 2. Authentication

- `POST /login`, form-encoded body with fields `email` and `password` (not `username`).
- Success is **HTTP 200** with the JSON body `{"type":"redirect","status":303,"location":"/meters"}`. The redirect is described in the body, not performed. Treat login as successful only if that body is present **and** a cookie was set.
- The session is a cookie named `__Secure-better-auth.session_token` (HTTPS only). No CSRF token appeared in the login form.
- My client sends `Origin: https://urja-ops.flockenergy.tech` on login. Whether it is required: *(untested)*.
- Without a valid session, every `/portal/*` endpoint answers **401** `{"error":"unauthorized","message":"A valid session is required."}`. A bogus cookie gives the same answer, which is what the client's automatic re-login relies on.
- Session lifetime: a browser session was still valid more than 1 hour after login. Exact expiry: *(not measured)*.
- Wrong-password response: *(untested)*.

## 3. Endpoints

| Purpose | Request | Notes |
|---|---|---|
| Login | `POST /login` | see section 2 |
| Meter list / search | `GET /portal/meters/search?q=&page=` | `{data:[{meterId, serialNo, make, phaseType, installStatus, dtCode}], page, pageSize:20, total}`. `q` is a live search (a request per keystroke) on meter ID or serial. |
| Transformers | `GET /portal/dts?page=` | `{data:[{code, name, feederCode, capacityKva}], total}`, 20 per page. total 40, 2 pages of 20 |
| Meter location | `GET /portal/meters/{id}/geo` | `{data:{latitude, longitude}}`, **both strings** |
| Meter consumption | `GET /portal/meters/{id}/energy` | `{data:[{timestamp, kwh, kvah, voltR}]}`, **all strings**, no parameters seen |
| Signing secret | `GET /portal/keys` | `{data:{signingSecret}}`, needs a session |
| Bulk export | `GET /portal/export?page=1` | needs signature headers (section 4) |

Search quirks:
- A page past the end returns **200** with an empty `data` list, and the correct `total`.
- `page=0` and `page=abc` return **200** with data (silently coerced). The `page` value returned: *(not checked)*.
- Substring or prefix matching for `q`: *(untested)*.

## 4. Bulk export and its request signature

`GET /portal/export?page=1` returns **all 403 meters in one response** (about 231 kB). Opened directly, or with a wrong or missing signature, it returns `401 {"error":"signature_invalid","message":"Missing or invalid request signature."}`.

The page's own JavaScript (chunk `4.2Bgc2kUI.js`, loaded with the Transformers page) works like this:

1. `GET /portal/keys` returns the signing secret for this session.
2. `timestamp` = current Unix time in seconds, as a string.
3. `message` = `"GET" + "\n" + "/portal/export" + "\n" + "page=1" + "\n" + timestamp`. The query string has no `?`, and parts are joined with newline characters.
4. `signature` = **HMAC-SHA256** of `message`, keyed with the secret, in lowercase hex (64 characters).
5. The request carries headers `x-timestamp` and `x-signature`.

Findings:
- `page` is **ignored**: `page=2` returns the same 403 records.
- The timestamp must be fresh. A timestamp 600 s old was rejected with 401 `signature_invalid`, the same code as a missing signature. The exact window was not measured.
- A signature rejection and a missing session are both 401, but only the `error` field tells them apart (`signature_invalid` vs `unauthorized`). A client must not re-login on `signature_invalid`.
- The "Export all meters" button saves `response.data` as a pretty-printed bare array (`meter-export.json`, about 359 kB), which is why the file is larger than the response.
- Signing depends on the caller's clock, so a badly wrong clock makes every export call fail.

## 5. Export record shape

```
meterId, serialNo, make, phaseType, installStatus, installType, build, dtCode,
hierarchy: { zone, circle, division, subdivision, substation, feeder, dt }  (each {name, code}),
geo: { lat, lng }   (numbers)
```

The export carries hierarchy, location and two extra attributes (`installType`, `build`) that the search endpoint does not.

## 6. Data quirks

- **Missing hierarchy values.** In 25 of 403 meters a hierarchy name or code is empty: circle code (6 meters), feeder code (5), substation code (3), circle name (5), feeder name (3). Every gap could be filled from other rows that have the same name or code.
- **One transformer with two names.** `DT-007` is "Sanganer DT 7" on most meters and "Old Malviya Nagar Xfmr" on three (J100400 to J100402). The portal's own transformer list shows "Sanganer DT 7", so the majority name is correct.
- **Types differ between endpoints.** Coordinates are numbers in the export, but strings from `/geo`. All numeric values from `/energy` are strings.
- **Timestamps.** `DD/MM/YYYY HH:mm`, with no timezone. I assume IST (+05:30), since the utility is in Jaipur. *(assumption)*
- **Consumption window.** - **Energy granularity depends on the meter.** In a sequential scan, 40 meters (J100000 to J100039, judging by scan order) returned 337 half-hourly rows (23/06/2026 23:30 to 30/06/2026 23:30). 58 meters (J100040 to J100097) returned 8 rows, one per day at 00:00 (23/06/2026 to 30/06/2026), and J100098 checked on its own returned 8 daily rows. The split is not explained by `build` (both legacy and v2 meters are in the half-hourly group). Data ends on 30/06/2026 in every case, so it looks like a frozen snapshot.
- **`kwh` is cumulative.** In all the series I looked at it only increases, so usage over an interval is the difference between two readings.
- **One malformed series.** J100089 returns 9 rows; the last repeats the timestamp of the previous row with empty `kwh` and `voltR`. My API returns it as-is with `null` for the empty values and does not remove the duplicate.
- **Failed scan.** In a fast sequential scan of all 403 meters (21 search pages, then one energy request per meter with a 30 ms pause), energy requests failed for the 305 meters from J100098 on, although J100098 itself worked when requested later from a fresh process. Cause not determined *(possibly rate limiting or a per-session limit; unverified)*. Meters from J100099 onward were not individually checked, so their shape is unknown.
- **`kwh` is cumulative.** It never decreased in the meters I sampled, so usage over an interval is the difference between two readings.
- **Decommissioned meters** (for example J100000) still return a full week of readings.
- **`build` is `legacy` (238) or `v2` (165).** Its meaning is unknown. The energy responses of a legacy meter (J100001) and a v2 meter (J100004) have the same shape.
- **Status counts:** Installed 238, Faulty 90, Decommissioned 75.
- **Serial numbers can contain `&`** (for example `L&84997`), so they must be URL-encoded when used in a query.

## 7. Error responses seen

| Situation | Response |
|---|---|
| No or invalid session | 401 `{"error":"unauthorized",...}` |
| Missing, wrong or stale signature | 401 `{"error":"signature_invalid",...}` |
| Unknown meter on `/energy` | 404 `{"error":"not_found","message":"Meter not found"}` |
| Search page beyond the last | 200 with `data: []` |

## 8. Not investigated

- `/meters/{id}/__data.json` (a SvelteKit internal request)
- the "Ops Desk" element
- behaviour under sustained load, and session expiry time
- the cause of the failed energy requests in the scan, and the energy shape of J100099 to J100402.