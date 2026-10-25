## Endpoints
| Purpose | Method + URL | Params | Format |
|---|---|---|---|
| Login | POST /login | form: email, password | JSON redirect body |
| Meter search/list | GET /portal/meters/search | q, page (pageSize 20) | JSON {data,page,pageSize,total} |
| Transformers | GET /portal/dts | page (2 pages) | JSON |
| Meter location | GET /portal/meters/{id}/geo | none | JSON, lat/lon as strings |
| Meter energy | GET /portal/meters/{id}/energy | none seen | JSON, all values strings |
| Bulk export | GET /portal/export | page | JSON, ~231 kB, total 403 |

## Quirks
- Login success is a JSON "redirect" body, not an HTTP redirect
- All numeric values are strings (coordinates, kwh, kvah, voltR)
- Timestamps are DD/MM/YYYY HH:mm, no timezone
- kwh appears cumulative (to verify)
- Page number lives in client state, not the URL
- Ops Desk nav item is not a link

## Bulk export (GET /portal/export?page=N)
- Requires a request signature; direct navigation returns
  {"error":"signature_invalid","message":"Missing or invalid request signature."}
- Response: {data:[...], total:403}; the Export button saves a bare array of 403 records
- Record fields: meterId, serialNo, make, phaseType, installStatus, installType,
  build (legacy|v2), dtCode, hierarchy{zone..dt:{name,code}}, geo{lat,lng}

## Data quirks
- Hierarchy: empty "code" on some circles (6), feeders (5), substations (3)
- DT-007 has two names: "Sanganer DT 7" and "Old Malviya Nagar Xfmr"
- geo: numbers in export, strings in /geo
- build: legacy (238) / v2 (165) – meaning TBD


## Export signing
- GET /portal/export?page=1 needs headers X-Timestamp (unix seconds, request time)
  and X-Signature (64 hex chars, likely SHA-256-based; formula TBD)
- Without them: 200? no, error {"error":"signature_invalid", ...}
- A request named `keys` returns {"data":{"signingSecret": ...}} first
- page=1 returns the whole dataset (403 records, 231,658 bytes, {data,total});
  the UI's saved file is the same data pretty-printed as a bare array