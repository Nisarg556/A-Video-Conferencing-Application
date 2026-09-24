# Confer

[![CI](https://github.com/Nisarg556/A-Video-Conferencing-Application/actions/workflows/ci.yml/badge.svg)](https://github.com/Nisarg556/A-Video-Conferencing-Application/actions/workflows/ci.yml)

A Zoom-style video conferencing app that runs in the browser: accounts, shareable meeting links, a pre-join lobby, group video calls over WebRTC, screen sharing, chat, and host controls (waiting room, admit/deny, remove, lock, end for all).

**Stack:** React 19 + Vite · Node 22 + Express 5 · Socket.IO · WebRTC (mesh) · MongoDB (Mongoose) · Zod · pino · Vitest · Playwright

---

## Features

- **Meetings**: signed-in users create meetings with unguessable links (`kqz-mtrw-xpa`); guests can join if the host allows it. History of hosted and attended meetings.
- **Lobby**: camera/mic preview, device pickers, mic level meter, and specific help for blocked, missing or in-use devices.
- **Calls**: up to 4 people over peer-to-peer WebRTC, with automatic reconnection, ICE restarts on network changes, per-connection bandwidth caps, and TURN support for restrictive networks.
- **In the meeting**: mute/camera toggles, screen sharing (one presenter at a time), chat with unread badges, active-speaker highlight, and a People panel.
- **Host controls**: waiting room, admit/deny, remove (and ban signed-in users), lock, allow/disallow guests, end for everyone. All **enforced on the server**.
- **Accessible and responsive**: keyboard operable, screen-reader announcements, page titles, and a layout that works down to phone width.

## Architecture

```
Browser (React)                                    Server (one Node service)
┌──────────────────────────────┐   HTTPS (REST)    ┌──────────────────────────────────┐
│ Lobby / Meeting / History    │ ────────────────▶ │ Express 5: auth, meetings, chat  │
│ useLocalMedia (camera/mic)   │                   │ history, end meeting; serves SPA │
│ useMeetingRoom ─ CallManager │   WSS (Socket.IO) │ Socket.IO: presence, admission,  │
│   └ PeerLink × N (WebRTC)    │ ◀───────────────▶ │ signaling relay, chat, screen    │
└──────────┬───────────────────┘                   │ share, host controls             │
           │ encrypted media, peer-to-peer          │ RoomManager (in-memory presence) │
           ▼ (or relayed via TURN)                  └───────────────┬──────────────────┘
   other participants                                     MongoDB (users, meetings,
                                                          participants, messages)
```

- **The server never touches media.** It authenticates people, decides who may be in which room, and relays small signaling messages. Audio and video go browser-to-browser, or through TURN when no direct path exists.
- **Durable state in MongoDB, live state in memory:** users, meetings, participants and chat live in MongoDB; who is connected right now lives in memory.
- **Production is one origin:** Express serves the built client, API and WebSocket together, which keeps the session cookie first-party and avoids CORS. See [DEPLOYMENT.md](DEPLOYMENT.md).

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (signaling flow, TURN, auth design, data model) · [docs/API.md](docs/API.md) (REST, Socket.IO events, roles and permissions, error codes).

## Getting started

**Prerequisites:** Node.js **22.12+** (`nvm use` reads `.nvmrc`), and MongoDB via Docker Desktop (`npm run db:up`) or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster.

```bash
npm install
cp server/.env.example server/.env      # then set JWT_SECRET (command is in the file)
npm run db:up                           # local MongoDB in Docker (skip if using Atlas)
npm run dev                             # API on :4000, app on http://localhost:5173
```

**Windows PowerShell:** if `npm` fails with *"npm.ps1 cannot be loaded because running scripts is disabled"*, call `npm.cmd` instead. It's the same npm, without the blocked PowerShell wrapper (or use Command Prompt / Git Bash, where `npm` works as is):

```powershell
cd "C:\path\to\Video confrencing app"
npm.cmd install
Copy-Item server\.env.example server\.env   # first time only, then set JWT_SECRET in it
npm.cmd run dev                              # keep this window open; stop with Ctrl+C
```

Then open http://localhost:5173. If you already have MongoDB installed as a Windows service (it listens on port 27017), skip `db:up`. `npm.cmd run dev` must stay running: if you close that terminal, open pages show *"Can't reach the dev server"*.

Camera access needs **https** or **localhost**: use `localhost`, not your LAN IP. For two people to test from different networks, deploy first ([DEPLOYMENT.md](DEPLOYMENT.md)).

| Command | What it does |
| --- | --- |
| `npm run dev` | API (restarts on `server/src` changes) + Vite dev server |
| `npm test` | Server + client tests (first run downloads a ~600 MB MongoDB binary for in-memory tests) |
| `npm run test:e2e` | Builds the app, then two Chromium browsers with fake cameras hold a real meeting (`npx playwright install chromium` once) |
| `npm run lint` | ESLint (incl. React hooks rules) |
| `npm run build` | Production build of the client |
| `npm start` | Run the server without watching (serves `client/dist` when `NODE_ENV=production`) |
| `npm run db:up` / `db:down` | Start / stop local MongoDB |

Environment variables are documented in [`server/.env.example`](server/.env.example) and [DEPLOYMENT.md](DEPLOYMENT.md#environment-variables-production).

## Project structure

```
client/src
  api/            fetch wrapper (ApiError mirrors server errors), auth, meetings
  auth/           AuthProvider (mirrors the server session for the UI)
  components/     meeting/ (PreJoin, MeetingRoom, ControlBar, SidePanel, ChatPanel, PeopleList, WaitingRoom), VideoTile …
  hooks/          useLocalMedia, useMeetingRoom, useScreenShare, useChat, useActiveSpeaker …
  lib/call/       CallManager (mesh rules) + PeerLink (one RTCPeerConnection): framework-free, unit-tested
  lib/            chat state, screen share, active speaker, meeting codes, redirects (+ tests)
server/src
  config/         env validation (fails fast)
  lib/            permissions table, tokens (JWT), passwords (scrypt), logger (pino), errors
  middleware/     validation (Zod), session cookie, participant token, rate limits, error handler
  modules/        auth, users, meetings (join policy, history), chat
  realtime/       Socket.IO server: presence + admission, signaling, chat, screen share, host controls, STUN/TURN
server/tests      integration tests: real HTTP + Socket.IO server, in-memory MongoDB
e2e/              Playwright: two browsers, real WebRTC, production build
docs/             ARCHITECTURE, API, MANUAL_TESTING
```

## Testing

| Layer | What | Count |
| --- | --- | --- |
| Server integration (Vitest + Supertest + socket.io-client, in-memory MongoDB) | Auth/session security, join policy per role, every host action forbidden for members and guests, waiting-room isolation, signaling relay isolation and spoofing, chat scoping/validation/rate limits, logging redaction, security headers, and one test that walks the **whole critical flow** | 122 |
| Client unit (Vitest) | WebRTC negotiation with a fake `RTCPeerConnection` (glare-free offers, stale connections, early ICE candidates, ICE restarts, bandwidth caps), screen-share failure paths, chat state merging, active-speaker detection, meeting-code parsing, open-redirect guard | 58 |
| End-to-end (Playwright, 2 Chromium contexts, fake devices) | Sign up → create with waiting room → guest asks → host admits → **live video both ways** → chat → leave → end; plus a direct-API permission check | 2 |
| Manual | Two people on **different networks** (Wi-Fi + mobile data), TURN verification, network switching, accessibility spot-check | [checklist](docs/MANUAL_TESTING.md) |

CI (`.github/workflows/ci.yml`) runs lint, all tests on Node 22 and 24, the build, a production dependency audit, and the Playwright suite.

## Security

- **Server-side authorization**: a single permissions table checked by every host-only route and socket event; admission (waiting/denied/removed/locked) is re-read from the database on every join, so old tokens can't bypass later decisions.
- **Sessions**: an httpOnly, SameSite=Lax cookie (not readable by JavaScript; blocks cross-site POSTs). Passwords are hashed with scrypt; login responses don't reveal which emails exist.
- **Tokens**: separate JWT audiences for sessions and per-meeting participant tokens; HS256 pinned; a token for meeting A is useless in meeting B.
- **Input**: every REST body and socket payload is validated with Zod; SDP is capped at 64 KB; rate limits on auth, meeting creation, joins, signaling and chat.
- **Signaling**: messages are only relayed within the same meeting; the sender id comes from the token, never from the payload.
- **Chat**: rendered as text (no HTML); bidi-override characters rejected; history only for admitted participants; deleted when the meeting ends.
- **Headers**: CSP (scripts and connections to this origin only), Permissions-Policy (camera/mic/screen for this site only), HSTS and nosniff. TURN credentials are short-lived and per participant.
- **Logs**: structured JSON; tokens, cookies, passwords and DB credentials are redacted.

## Limitations

- **Up to 4 people.** Mesh topology: each person uploads one stream per other participant. Beyond ~5 people an SFU (LiveKit, mediasoup) is the right design; `CallManager` is the seam where it would plug in.
- **Single server instance.** Presence and the waiting room live in memory. Scaling out needs Redis (Socket.IO adapter + shared presence).
- **No recording, no end-to-end encryption beyond WebRTC's DTLS-SRTP, no mobile apps.** Media is encrypted in transit peer-to-peer; TURN relays only encrypted packets.
- **Screen share replaces your camera** (no camera + screen at once), and isn't available in most mobile browsers.
- **Guests can't be banned** (no identity to ban); use lock or the waiting room. Signed-in users can.
- **Accounts are basic**: no email verification, password reset, or "sign out everywhere".
- **Reconnects rebuild calls**: after a signaling reconnect, peer connections are re-established (a ~1 s video pause). A participant whose network vanishes entirely is shown for up to ~45 s before being removed.
- **Participant tokens last 12 h**: a single meeting longer than that needs a rejoin.

## Screenshots to capture

Save as `docs/screenshots/*.png` (1280×800 browser window, light theme; one dark-theme shot is a nice touch) and embed them at the top of this README.

| File | What to show |
| --- | --- |
| `home.png` | Home page signed in: "New meeting" card with guest/waiting-room options |
| `lobby.png` | Pre-join lobby with camera preview, mic level bar, device pickers |
| `lobby-blocked.png` | Lobby with camera blocked, showing the specific help message and "Try again" |
| `call-grid.png` | 3 people in the gallery with one active-speaker ring and one muted icon |
| `screen-share.png` | A presenter's screen large + filmstrip + "… is presenting" chip |
| `chat.png` | Chat panel with grouped messages, an unread badge on the other window |
| `waiting-room.png` | Split: guest "Waiting for the host" + host banner "… is waiting to join" |
| `host-controls.png` | People panel: host controls toggles (Lock on), Remove buttons |
| `mobile.png` | Phone-width meeting with icon-only controls |
| `history.png` | My meetings page with active and ended meetings |
| `webrtc-internals.png` | `chrome://webrtc-internals` showing a `relay` candidate pair (proves TURN) |

## Technical decisions (for interviews)

| Decision | Why | Trade-off I'd mention |
| --- | --- | --- |
| **WebRTC mesh**, capped at 4 | No media server to run or pay for; media stays peer-to-peer; I had to understand SDP/ICE rather than hide them behind an SDK | Upload grows with N−1 → SFU beyond ~5 people. Mitigated with per-connection bitrate caps |
| **Newcomer always offers + `connectionId`** | Removes offer "glare" without the full perfect-negotiation pattern; a new id cleanly replaces a stale connection after reloads/reconnects | Reconnects rebuild connections instead of resuming them |
| **Fixed audio+video transceivers, `replaceTrack`** | Mute, camera toggle and screen share never renegotiate | Screen replaces the camera instead of adding a second stream |
| **Socket.IO for signaling** | Rooms, acks, reconnection and auth middleware out of the box; the same channel carries chat and host events | Heavier than raw `ws`; WebSocket-only transport avoids sticky sessions |
| **Server-assigned roles + one permissions table** | Security doesn't depend on hidden buttons; easy to audit and test (every host action is tested as member and guest) | Admission is re-read from MongoDB on each join (one extra query, by design) |
| **httpOnly SameSite=Lax cookie for sessions; Bearer participant tokens per meeting** | XSS can't steal the session; CSRF blocked by SameSite; meeting tokens are scoped to one meeting | Requires same-origin deployment, hence one service serving everything |
| **In-memory presence, MongoDB for durable data** | Presence changes every second and is rebuilt on reconnect; the DB stores what must survive | One instance until presence moves to Redis |
| **TURN with HMAC-derived, expiring credentials** | ~10–20% of users can't connect directly; the TURN secret never reaches browsers | TURN bandwidth is the main running cost |
| **Zod at every boundary, consistent error shape** | Handlers only see valid data; the client maps errors by `code` | Some duplication between client hints and server rules (the server is authoritative) |
| **Testing pyramid** | Pure logic (CallManager, chat state) unit-tested with fakes; real HTTP+Socket.IO integration tests; one real two-browser E2E; manual cross-network checklist for what automation can't cover | E2E runs on one machine, so it can't prove NAT traversal; that's the manual checklist's job |

## Troubleshooting

- **`Could not connect to MongoDB`**: start Docker Desktop and `npm run db:up`, or point `MONGODB_URI` at Atlas.
- **MongoDB already installed as a Windows/macOS service?** It listens on port 27017, so you don't need `npm run db:up` (the Docker container would clash with it). `server/.env`'s default `MONGODB_URI` uses that local server's `confer` database.
- **`JWT_SECRET must be at least 32 characters`**: generate one with the command in `server/.env.example`.
- **"The server is unavailable" in the UI**: the API isn't running on port 4000; check the `server` output of `npm run dev`.
- **Camera "in use by another app"**: close Zoom/Teams/other tabs using the camera, then "Try again".
- **Stuck on "Connecting…" between two networks**: configure TURN ([DEPLOYMENT.md](DEPLOYMENT.md#turn)).
- **Echo**: two devices in one room without headphones.
- **Project inside OneDrive/Dropbox**: sync clients touch files constantly, slowing installs and restarting the dev server. Prefer a folder like `C:\dev\confer`.
- **Port already in use**: change `PORT` in `server/.env` and `API_PROXY_TARGET` in `client/.env.local`.
