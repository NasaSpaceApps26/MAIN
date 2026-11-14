# moon-sky — the Sun and the Earth above a lunar landing site

Calculation engine and API behind the **Lunar Sky** panel of the frontend.
Data: **JPL Horizons** (topocentric ephemerides from a point on the Moon).
Zero dependencies — needs only Node 18+.

## Running

```bash
node test.js                                      # offline tests (no internet needed)
node cli.js apollo11 2026-11-14T00:00Z 30         # quick report in the terminal
node cli.js -- -80.13 1.44 2026-11-14T00:00Z 30   # custom lat lon
node server.js                                    # API on http://localhost:3001
```

With Docker it starts together with the rest of the app (`docker compose up` in `docker/`).
The frontend finds it through `VITE_MOON_SKY_URL` (default `http://localhost:3001`).

## The Lunar Sky panel

Two tabs sit on the left edge of the screen; each slides a panel in over the solar system, which stays visible on the right:
- **Landing settings** (`/#landing-settings`) – lat/lon/altitude, range start, range length, data step, rise threshold.
- **Lunar Sky** (`/#moon-sky`) – landing-site picker, Moon map (click to pick a location), sky view, metrics, elevation chart with time slider and animation, visibility-window tables.

Both tabs share the same settings and data. Click the active tab again or press Esc to close the panel.
Settings are stored in the page URL, so a link can be shared.

The UI lives in `frontend/src/features/moonSky/`. It contains a copy of `lib/analysis.js`
(the frontend Docker build context only sees `frontend/`) — keep both in sync.

## Structure

| File | What it does |
|---|---|
| `lib/horizons.js` | Builds the Horizons query (`CENTER='coord@301'`, `QUANTITIES='4'`), parses CSV → `[{t, az, el}]` |
| `lib/analysis.js` | **Pure logic** (also runs in the browser): rises/sets, time until set, visibility windows, Sun ∩ Earth overlap, interpolation |
| `lib/sites.json` | Landing sites (Apollo, Luna, Chang'e, Chandrayaan-3, SLIM, IM-1, Blue Ghost…) |
| `server.js` | API for React (Horizons doesn't support CORS, so the browser can't query it directly). 6 h cache |
| `cli.js` | Terminal report |

## API

`GET /api/health` — `{ "status": "ok" }`

`GET /api/sites` — list of sites

`GET /api/sky` — parameters:

| param | example | description |
|---|---|---|
| `site` | `apollo11` | ID from `sites.json` **or** `lat` + `lon` |
| `lat`, `lon` | `-80.13`, `1.44` | degrees; lon + = east, western ones negative |
| `alt` | `0` | altitude [km] |
| `start` | `2026-11-14T00:00Z` | start of the range (UTC) |
| `days` | `30` | range length (1 lunar day ≈ 29.5 d) |
| `step` | `10m` | step: `10m`, `1h`, `1d` |
| `at` | `2026-11-20T12:00Z` | moment to analyse (default = start) |
| `mode` | `center` / `limb` / `5` | rise threshold: disc centre, upper limb, or a custom threshold in ° |

Response:
```jsonc
{
  "site": { "lat": 0.6741, "lon": 23.473, "altKm": 0 },
  "range": { "start": 1794700800000, "stop": ..., "step": "10m" },
  "samples": { "sun": [{ "t": 1794700800000, "az": 91.2, "el": 34.5 }, ...], "earth": [...] },
  "analysis": {
    "sun": {
      "az": 91.2, "el": 34.5, "isUp": true,
      "nextRise": null, "nextSet": 1794960000000,
      "minutesToSet": 4320, "minutesToRise": null,
      "currentWindow": { "start": ..., "end": ..., "durationMin": 21260, "startKnown": false, "endKnown": true },
      "currentPeak": { "t": ..., "el": 79.8, "az": 180.1 },
      "windows": [ ... ],      // all daylight periods in the range
      "fractionUp": 0.49
    },
    "earth": { ... },          // same for the Earth (communications)
    "both": { "isUp": true, "windows": [...], "minutesToEnd": 4320 }  // power + communications
  }
}
```
Times are UTC milliseconds (`new Date(t)`). `null` = the event doesn't fall within the fetched range
(e.g. from the near side the Earth practically never sets). `startKnown/endKnown = false` → window cut off by the range edge.

## Notes

- Horizons computes for a **flat horizon**. Near the poles terrain (craters, mountains) can hide the Sun much earlier
  — that needs a horizon mask from a DEM (LOLA / QuickMap). As a rough stand-in, use `mode=<threshold°>`.
- Limit: ≤ 50 000 samples per request (30 days × 10 min = 4 320 — no problem).
- Coordinates in `sites.json` are approximate — verify them with LROC QuickMap before presenting.
