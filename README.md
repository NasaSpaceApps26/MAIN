# MAIN — Lunar Mission Explorer

| Folder | What it is |
|---|---|
| `frontend/` | React + Vite app. Main page: the 3D **solar system**. Two tabs on the left edge slide a panel over it: **Landing settings** (`/#landing-settings`) and **Lunar Sky** results (`/#moon-sky`) |
| `backend/` | FastAPI backend (bodies, ephemerides, sites, trajectories) |
| `moon-sky/` | Node API for the Lunar Sky panel: Sun/Earth elevation above a lunar site, from JPL Horizons — see [moon-sky/README.md](moon-sky/README.md) |
| `docker/` | `docker compose up` starts backend (:8000), moon-sky (:3001) and frontend (:5173) |

Without Docker, run `node moon-sky/server.js` next to the frontend dev server (`cd frontend && npm run dev`).
