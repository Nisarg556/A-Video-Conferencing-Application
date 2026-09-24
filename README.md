# Confer

A Zoom-style video conferencing app: create a meeting, share a link, and talk in the browser.

**Stack:** React 19 + Vite · Node + Express 5 · MongoDB (Mongoose) · Zod validation · Socket.IO + WebRTC (coming next)

> **Status:** Milestone 0–1 scaffold. Meetings can be created and looked up; the lobby UI is in place.
> Camera preview, signaling and video calls are the next milestones.

---

## Project structure

```
.
├── client/                     React app (Vite)
│   ├── src/
│   │   ├── api/                fetch wrapper + typed API calls (ApiError mirrors server errors)
│   │   ├── components/         Layout, StatusMessage
│   │   ├── hooks/              useMeeting
│   │   ├── lib/                meeting-code parsing, host-key storage
│   │   ├── pages/              Home, Meeting (lobby), NotFound, RouteError
│   │   ├── router.jsx          route table
│   │   └── index.css           design tokens + layout (light/dark)
│   └── vite.config.js          dev proxy: /api → server
├── server/                     Express API
│   ├── src/
│   │   ├── config/env.js       env validation (fails fast on bad config)
│   │   ├── db/connect.js
│   │   ├── lib/                AppError, crypto helpers (meeting codes, secrets)
│   │   ├── middleware/         validate (Zod), rate limits, error + 404 handlers
│   │   ├── modules/meetings/   model · schemas · service · routes
│   │   ├── app.js              builds the Express app (no listen → testable)
│   │   └── index.js            connects DB, starts server, graceful shutdown
│   └── tests/                  Vitest + Supertest + in-memory MongoDB
├── docker-compose.yml          local MongoDB
└── package.json                npm workspaces + root scripts
```

## Prerequisites

- **Node.js 20.6+** (`node -v`)
- **MongoDB**, either:
  - Docker Desktop (recommended): `npm run db:up` starts MongoDB on `localhost:27017`, or
  - a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (put its URI in `server/.env`)

## Local setup

```bash
# 1. Install dependencies for both workspaces
npm install

# 2. Configure the server
cp server/.env.example server/.env        # Windows PowerShell: Copy-Item server/.env.example server/.env

# 3. Start MongoDB (skip if using Atlas)
npm run db:up

# 4. Run API + web app together
npm run dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000 — try http://localhost:4000/api/health

The client needs no `.env` for local development: Vite proxies `/api` to the server.
See `client/.env.example` for the production setting (`VITE_API_URL`).

## Scripts (run from the repo root)

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts server (`node --watch`) and client (Vite) together |
| `npm test` | Runs server tests against an in-memory MongoDB (first run downloads a MongoDB binary, ~600 MB) |
| `npm run build` | Production build of the client into `client/dist` |
| `npm start` | Starts the server without file watching |
| `npm run db:up` / `db:down` | Start / stop the local MongoDB container |

## Environment variables

**server/.env**

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `4000` | API port |
| `MONGODB_URI` | — (required) | MongoDB connection string |
| `CLIENT_URL` | `http://localhost:5173` | CORS allowlist origin and base URL for invite links |

**client/.env.local** (optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | empty (same origin) | API base URL in production |
| `API_PROXY_TARGET` | `http://localhost:4000` | Where the dev server proxies `/api` |

## API

All errors share one shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "details": [{ "location": "body", "path": "title", "message": "..." }] } }
```

Error codes: `VALIDATION_ERROR` (400), `INVALID_JSON` (400), `NOT_FOUND` (404),
`PAYLOAD_TOO_LARGE` (413), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500).

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| `GET` | `/api/health` | – | `200 { status: "ok", db: "up" }` (`503` if DB is down) |
| `POST` | `/api/meetings` | `{ title?: string ≤ 80 }` | `201 { meeting, joinUrl, hostKey }` |
| `GET` | `/api/meetings/:code` | – | `200 { meeting }` · `400` bad format · `404` unknown |

`meeting` = `{ code, title, status, maxParticipants, createdAt }`.
The `hostKey` is returned only once; the server stores just its SHA-256 hash.

## Design notes

- **Meeting codes** (`abc-defg-hij`) are 10 random letters from a CSPRNG (~47 bits), backed by a unique index, and lookups are rate-limited to make guessing impractical.
- **Validation** happens at the edge with Zod; handlers only see parsed data (`req.validated`). The client validates too, but only for fast feedback — the server is the authority.
- **Errors**: expected failures throw `AppError`; anything else is treated as a bug, logged, and returned as a generic 500 so internals never leak.
- **`createApp()` vs `index.js`**: the app is built without listening so tests run it in-process with Supertest.
- **Durable vs live state**: MongoDB holds meetings (and later chat). Who is connected right now will live in server memory once signaling lands.

## Troubleshooting

- **`Could not connect to MongoDB`**: Mongo isn't running. Start Docker Desktop, then `npm run db:up`, or point `MONGODB_URI` at Atlas.
- **"The server is unavailable" in the UI**: the API isn't running on port 4000; check the `server` output of `npm run dev`.
- **Port already in use**: change `PORT` in `server/.env` and `API_PROXY_TARGET` in `client/.env.local`.
