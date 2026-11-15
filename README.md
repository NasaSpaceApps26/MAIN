# MAIN — Lunar Mission Explorer

| Folder | What it is |
|---|---|
| `frontend/` | React + Vite app. Main page: the 3D **solar system**. Two tabs on the left edge slide a panel over it: **Landing settings** (`/#landing-settings`) and **Lunar Sky** results (`/#moon-sky`) |
| `backend/` | FastAPI backend (bodies, ephemerides, sites, trajectories) |
| `moon-sky/` | Node API for the Lunar Sky panel: Sun/Earth elevation above a lunar site, from JPL Horizons — see [moon-sky/README.md](moon-sky/README.md) |
| `docker/` | `docker compose up` starts backend (:8000), moon-sky (:3001) and frontend (:5173) |

Without Docker, run `node moon-sky/server.js` next to the frontend dev server (`cd frontend && npm run dev`).

## Moon mission (flight to a chosen landing site)

The **Moon mission** panel (top right of the solar system) computes a full flight with the mission
simulation in [backend/app/mission/misja.py](backend/app/mission/misja.py) (parameters:
[parametry_misji.py](backend/app/mission/parametry_misji.py), Saturn V + CSM + LM by default):

1. Pick the launch site (a NASA pad or any latitude/longitude), the landing point on the Moon
   (type it in or pick it on the map in **Landing settings** — both stay in step) and the mode
   (*Fastest* / *Least fuel*). The launch window is searched from the mission clock's time, 3 days ahead.
2. **Compute flight** starts the simulation in the backend (`POST /api/mission`, progress at
   `GET /api/mission/{id}`). A run takes several minutes; results are cached in
   `backend/data/cache/missions/` (and `backend/data/missions/` for results kept in the repo), so the
   same inputs open instantly next time.
3. **Launch** sets the mission clock to liftoff and plays the flight: ascent, parking orbit, TLI,
   coast, lunar orbit, descent and touchdown on the marked site. The camera follows the spacecraft,
   and the clock speed follows the flight phase. Click an event in the list to jump to it.

The path is drawn relative to Earth up to the Moon's vicinity and relative to the Moon after that,
so it lines up with the bodies drawn from JPL Horizons. Earth is drawn with its real axial tilt and
rotation, so the launch-site dots sit where the simulation launches from.

After changing `backend/requirements.txt` rebuild the backend image: `docker compose up -d --build backend`.
