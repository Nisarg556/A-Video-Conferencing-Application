# Confer

A Zoom-style video conferencing app: create a meeting, share a link, and talk in the browser.

**Stack:** React 19 + Vite · Node + Express 5 · MongoDB (Mongoose) · Zod validation · Socket.IO · WebRTC (coming next)

> **Status:** Meeting lifecycle is complete: create a meeting, share the link, preview camera/mic in a
> pre-join lobby, join with a display name, see who's present in real time, leave, and (host) end for all.
> Audio/video between participants (WebRTC) is the next milestone.

---

## Project structure

```
.
├── client/                         React app (Vite)
│   ├── src/
│   │   ├── api/                    fetch wrapper + API calls (ApiError mirrors server errors)
│   │   ├── components/
│   │   │   ├── meeting/            PreJoin (lobby), MeetingRoom
│   │   │   └── ...                 VideoTile, MediaControls, MicLevel, CopyLink, StatusMessage
│   │   ├── hooks/                  useMeeting, useLocalMedia (camera/mic), useMeetingRoom (presence)
│   │   ├── lib/                    meeting codes, media error messages, socket, storage
│   │   ├── pages/                  Home, Meeting, Left, NotFound, RouteError
│   │   └── router.jsx
│   └── vite.config.js              dev proxy: /api and /socket.io → server
├── server/                         Express API + Socket.IO
│   ├── src/
│   │   ├── config/env.js           env validation (fails fast on bad config)
│   │   ├── lib/                    AppError, crypto (codes, secrets), JWT tokens, domain events
│   │   ├── middleware/             validate (Zod), auth (participant token), rate limits, errors
│   │   ├── modules/meetings/       Meeting + Participant models · schemas · service · routes
│   │   ├── realtime/               RoomManager (in-memory presence), Socket.IO server, ICE config
│   │   ├── app.js                  builds the Express app (no listen → testable)
│   │   └── index.js                HTTP + Socket.IO server, graceful shutdown
│   └── tests/                      Vitest + Supertest + socket.io-client + in-memory MongoDB
├── docker-compose.yml              local MongoDB
└── package.json                    npm workspaces + root scripts
```

## Prerequisites

- **Node.js 20.6+** (`node -v`)
- **MongoDB**, either:
  - Docker Desktop (recommended): `npm run db:up` starts MongoDB on `localhost:27017`, or
  - a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (put its URI in `server/.env`)
- A webcam and microphone are optional; the app handles missing or blocked devices.

## Local setup

```bash
# 1. Install dependencies for both workspaces
npm install

# 2. Configure the server, then set JWT_SECRET in server/.env (command is in the file)
cp server/.env.example server/.env        # Windows PowerShell: Copy-Item server/.env.example server/.env

# 3. Start MongoDB (skip if using Atlas)
npm run db:up

# 4. Run API + web app together
npm run dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000 — try http://localhost:4000/api/health

The client needs no `.env` for local development: Vite proxies `/api` and `/socket.io` to the server.
See `client/.env.example` for the production setting (`VITE_API_URL`).

Browsers only allow camera access on **https://** or **localhost**, so use `localhost` (not your LAN IP) locally.

## Scripts (run from the repo root)

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts server (restarts on changes in `server/src`) and client (Vite) together |
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
| `JWT_SECRET` | — (required, ≥ 32 chars) | Signs participant tokens |

**client/.env.local** (optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | empty (same origin) | API base URL in production |
| `API_PROXY_TARGET` | `http://localhost:4000` | Where the dev server proxies `/api` and `/socket.io` |

## Meeting lifecycle

```
Home ──create──▶ /m/:code (lobby) ──join──▶ in meeting ──leave──▶ /m/:code/left ──rejoin──▶ lobby
                     │                          │
             preview camera/mic          presence via Socket.IO
             enter display name          host can "End for all"
```

1. **Create** — `POST /api/meetings` returns a code like `kqz-mtrw-xpa` and a one-time `hostKey`, kept in the creator's browser.
2. **Lobby** — loads the meeting, then asks for camera + mic. Denied, missing and in-use devices each get a specific message and a "Try again"; you can join with devices off.
3. **Join** — `POST /api/meetings/:code/join` with a display name (plus `hostKey` for the host) returns a participant token.
4. **Presence** — the client connects to Socket.IO with that token and emits `room:join`; everyone receives `peer:joined` / `peer:left`.
5. **Leave** — the Leave button, closing the tab, or losing the connection all remove you from the room.
6. **End** — the host's `POST /api/meetings/:code/end` disconnects everyone; the link then shows "This meeting has ended".
7. **Expiry** — a meeting nobody has joined or left for 24 hours expires the next time someone opens its link. Ended meetings are deleted by a MongoDB TTL index after 7 days.

## API

All errors share one shape (REST and Socket.IO acks):

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "details": [{ "location": "body", "path": "displayName", "message": "..." }] } }
```

| Code | Status | When |
| --- | --- | --- |
| `VALIDATION_ERROR` / `INVALID_JSON` | 400 | Bad params/body |
| `UNAUTHORIZED` / `TOKEN_EXPIRED` | 401 | Missing, invalid or expired participant token |
| `FORBIDDEN` / `INVALID_HOST_KEY` | 403 | Wrong role, token for another meeting, wrong host key |
| `NOT_FOUND` | 404 | Unknown meeting or route |
| `ROOM_FULL` | 409 | Meeting already has `maxParticipants` (4) people |
| `MEETING_ENDED` | 410 | Meeting ended by the host, or its link expired |
| `PAYLOAD_TOO_LARGE` / `RATE_LIMITED` / `INTERNAL_ERROR` | 413 / 429 / 500 | |

### REST

| Method | Path | Auth | Body | Success |
| --- | --- | --- | --- | --- |
| `GET` | `/api/health` | – | – | `200 { status, db }` (`503` if DB down) |
| `POST` | `/api/meetings` | – | `{ title?: string ≤ 80 }` | `201 { meeting, joinUrl, hostKey }` |
| `GET` | `/api/meetings/:code` | – | – | `200 { meeting }` (ended meetings: `status: "ended"`) |
| `POST` | `/api/meetings/:code/join` | – | `{ displayName: 1–40 chars, hostKey? }` | `200 { participant, token, iceServers, meeting }` |
| `POST` | `/api/meetings/:code/end` | Bearer host token | – | `204` |

`meeting` = `{ code, title, status, endedReason?, maxParticipants, participantCount, createdAt }`
`participant` = `{ id, displayName, role: "host" | "guest" }`

### Socket.IO (connect with `auth: { token }`)

| Direction | Event | Payload |
| --- | --- | --- |
| C→S (ack) | `room:join` | → `{ ok: true, self, peers[] }` or `{ ok: false, error }` |
| C→S (ack) | `room:leave` | → `{ ok: true }` |
| S→C | `peer:joined` | `{ participantId, displayName, role, joinedAt }` |
| S→C | `peer:left` | `{ participantId }` |
| S→C | `meeting:ended` | `{ reason: "host_ended" \| "expired" }` |
| S→C | `session:replaced` | – (same participant connected from another tab) |

## Data model

- **Meeting** — `code` (unique), `title`, `hostKeyHash` (never returned), `status` (`active`/`ended`), `endedReason`, `maxParticipants`, `lastActiveAt`, `endedAt`, `expiresAt` (TTL index).
- **Participant** — one per join: `meetingId`, `displayName`, `role`, `joinedAt`, `leftAt`.
- **Live presence** — in memory (`RoomManager`): `code → participantId → { displayName, role, socketId }`.

## Design notes

- **Meeting codes** are 10 random letters from a CSPRNG (~47 bits), backed by a unique index; lookups and joins are rate-limited so guessing is impractical.
- **Host key** is a 192-bit random secret; only its SHA-256 hash is stored, compared in constant time. A wrong key is a 403, not a silent downgrade to guest.
- **Participant tokens** are JWTs (HS256 pinned, 2 h expiry) scoped to one meeting and one role. They authorize both REST calls and the Socket.IO handshake, and a token for meeting A is rejected on meeting B.
- **Capacity** is checked twice: at `/join` for fast feedback, and authoritatively on `room:join`. The socket check and the room insert run with no `await` between them, so two people can't take the last seat at once.
- **Presence lives in memory**, durable records in MongoDB. Closing a tab is detected by the socket disconnect. Reconnecting with the same token replaces the old socket without announcing a leave.
- **Lazy expiry**: idle meetings are expired when their link is next opened, not by a timer, so expiry survives server restarts.
- **Local media**: a single combined `getUserMedia` request (one permission prompt). If it fails, the app retries each device separately so a missing webcam doesn't block the microphone. Camera off stops the track (the camera light turns off); mute only disables the audio track.

## Troubleshooting

- **`Could not connect to MongoDB`**: Mongo isn't running. Start Docker Desktop, then `npm run db:up`, or point `MONGODB_URI` at Atlas.
- **`JWT_SECRET must be at least 32 characters`**: generate one with the command in `server/.env.example`.
- **"The server is unavailable" in the UI**: the API isn't running on port 4000; check the `server` output of `npm run dev`.
- **Camera says "in use by another app"**: close Zoom/Teams/other tabs using the camera, then click "Try again".
- **Project inside OneDrive/Dropbox**: sync clients touch files constantly, which slows installs and can trigger restarts. Prefer a folder outside synced storage (e.g. `C:\dev\confer`).
- **Port already in use**: change `PORT` in `server/.env` and `API_PROXY_TARGET` in `client/.env.local`.
