# Confer

A Zoom-style video conferencing app: create a meeting, share a link, and talk in the browser.

**Stack:** React 19 + Vite · Node + Express 5 · MongoDB (Mongoose) · Zod validation · Socket.IO signaling · WebRTC mesh

> **Status:** MVP complete. Group video calls for up to 4 people with camera/mic toggles, screen
> sharing, in-meeting chat, active-speaker highlight, reconnect handling, and a responsive,
> keyboard-accessible meeting UI. Next: deployment with TURN, then an SFU as a stretch goal.

---

## Project structure

```
.
├── client/                         React app (Vite)
│   ├── src/
│   │   ├── api/                    fetch wrapper + API calls (ApiError mirrors server errors)
│   │   ├── components/
│   │   │   ├── meeting/            PreJoin, MeetingRoom, ControlBar, SidePanel, ChatPanel, PeopleList
│   │   │   └── ...                 VideoTile, MediaControls, MicLevel, CopyLink, StatusMessage
│   │   ├── hooks/                  useLocalMedia, useMeetingRoom, useScreenShare, useChat, useActiveSpeaker
│   │   ├── lib/
│   │   │   ├── call/               CallManager (mesh) + PeerLink (one RTCPeerConnection) + tests
│   │   │   └── ...                 screenShare, chatState, activeSpeaker (+ tests), media errors, socket
│   │   ├── pages/                  Home, Meeting, Left, NotFound, RouteError
│   │   └── router.jsx
│   └── vite.config.js              dev proxy: /api and /socket.io → server
├── server/                         Express API + Socket.IO
│   ├── src/
│   │   ├── config/env.js           env validation (fails fast on bad config)
│   │   ├── lib/                    AppError, crypto (codes, secrets), JWT tokens, domain events
│   │   ├── middleware/             validate (Zod), auth (participant token), rate limits, errors
│   │   ├── modules/meetings/       Meeting + Participant models · schemas · service · routes
│   │   ├── modules/chat/           Message model · service · history route
│   │   ├── realtime/               Socket.IO presence, signaling, chat + screen-share handlers, STUN/TURN
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
| `npm test` | Server tests (in-memory MongoDB; first run downloads a ~600 MB binary) + client WebRTC logic tests |
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
| `STUN_URLS` | Google public STUN | Comma-separated `stun:` URLs (empty disables) |
| `TURN_URLS` | – | Comma-separated `turn:`/`turns:` URLs |
| `TURN_SECRET` | – | coturn shared secret → short-lived per-user credentials (preferred) |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | – | Static TURN credentials (managed providers) |
| `ICE_TRANSPORT_POLICY` | `all` | `relay` forces every call through TURN (for testing TURN) |

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
4. **Presence + call** — the client connects to Socket.IO with that token, emits `room:join`, then opens a WebRTC connection to every other participant (see [Signaling](#signaling)).
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
| `POST` | `/api/meetings/:code/join` | – | `{ displayName: 1–40 chars, hostKey? }` | `200 { participant, token, rtcConfig, meeting }` |
| `GET` | `/api/meetings/:code/messages` | Bearer participant token | `?before=<iso>&limit=1–100` | `200 { messages }` oldest first · `410` after the meeting ends |
| `POST` | `/api/meetings/:code/end` | Bearer host token | – | `204` (also deletes the meeting's chat) |

`meeting` = `{ code, title, status, endedReason?, maxParticipants, participantCount, createdAt }`
`participant` = `{ id, displayName, role: "host" | "guest" }`
`rtcConfig` = `{ iceServers, iceTransportPolicy }`, passed straight to `new RTCPeerConnection()`

### Socket.IO (connect with `auth: { token }`)

| Direction | Event | Payload |
| --- | --- | --- |
| C→S (ack) | `room:join` | `{ media: { audio, video } }` → `{ ok: true, self, peers[] }` or `{ ok: false, error }` |
| C→S (ack) | `room:leave` | → `{ ok: true }` |
| C→S | `media:state` | `{ audio, video }` |
| C→S | `signal` | `{ to, connectionId, type: "offer" \| "answer" \| "candidate", sdp?, candidate? }` |
| S→C | `peer:joined` | `{ participantId, displayName, role, joinedAt, media }` |
| S→C | `peer:left` | `{ participantId }` |
| S→C | `peer:media` | `{ participantId, audio, video }` |
| S→C | `signal` | `{ from, connectionId, type, sdp?, candidate? }` |
| C→S (ack) | `screen:start` | → `{ ok: true }` or `SCREEN_SHARE_BUSY` / `NOT_IN_MEETING` |
| C→S | `screen:stop` | – |
| S→C | `presenter:changed` | `{ participantId \| null }` |
| C→S (ack) | `chat:send` | `{ text ≤ 1000, clientMsgId }` → `{ ok: true, message }` or `VALIDATION_ERROR` / `RATE_LIMITED` / `NOT_IN_MEETING` |
| S→C | `chat:message` | `{ id, participantId, senderName, text, clientMsgId, createdAt }` |

The `room:join` ack also includes `presenterId`, so late joiners immediately see who is presenting.
| S→C | `meeting:ended` | `{ reason: "host_ended" \| "expired" }` |
| S→C | `session:replaced` | – (same participant connected from another tab) |

## Signaling

The server only relays WebRTC setup messages; media flows directly between browsers (or via TURN).

```
 Newcomer B                        Server                         Existing A
     │  room:join {media} ─────────▶ │                                  │
     │ ◀── ack {self, peers:[A]}     │ ── peer:joined {B, media} ──────▶ │  A drops any old link to B, waits
     │  signal {to:A, offer, c1} ──▶ │ ── signal {from:B, offer, c1} ──▶ │  A: new RTCPeerConnection, answer
     │ ◀── signal {from:A, answer} ─ │ ◀──────── signal {to:B, answer} ─ │
     │ ◀════════ ICE candidates (trickle, both ways, same relay) ══════▶ │
     │ ═══════════════ encrypted media, peer-to-peer (or TURN) ═════════ │
     │  media:state ───────────────▶ │ ── peer:media ──────────────────▶ │  mute icon / avatar
     │  (tab closes) ✕               │ ── peer:left ───────────────────▶ │  A closes the connection
```

**Rules** (implemented in `client/src/lib/call/CallManager.js`):

1. **The newcomer always offers**; people already in the room only answer, so both sides never offer at once (glare) and no "perfect negotiation" is needed.
2. **Each connection has a `connectionId`.** An offer with a new id replaces any existing connection to that person (reload, reconnect, server restart); messages with an old id are dropped as stale.
3. **No renegotiation for toggles**: every connection has one audio and one video transceiver, and camera/mic changes use `replaceTrack()`. Camera off = `replaceTrack(null)` and the camera is released.
4. **After every `room:join` (including automatic reconnects) the client re-offers to everyone.** Recovery is just "join again", so a server restart heals itself.
5. **ICE restarts** (network change): if a connection `failed`, or stays `disconnected` for 4 s, the offerer sends an ICE-restart offer on the same `connectionId` (max 3 tries).

**The server enforces**: the sender must have joined; the target must be in the *same* meeting; `from` comes from the verified token (never the payload); payloads are Zod-validated, SDP ≤ 64 KB, Socket.IO messages ≤ 100 KB, and each socket may relay at most 300 signals per 10 s.

### Why TURN

STUN only tells a browser its public IP/port. That's enough for most home networks, but a direct path is impossible when a peer is behind **symmetric NAT** (common on mobile carriers and some routers) or a **firewall that blocks UDP** (corporate and campus networks). The only option then is a **TURN** server that relays the media, which stays end-to-end encrypted (DTLS-SRTP). Roughly 10–20% of real-world calls need it; without it those users see "Connecting…" forever.

TURN relays real bandwidth, so it must not be an open relay:
- **Self-hosted coturn** with `use-auth-secret`: set `TURN_SECRET`; the API mints credentials that expire after 3 h (`username = "<expiry>:<participantId>"`, `credential = base64(HMAC-SHA1(secret, username))`). The secret never reaches browsers.
- **Managed TURN** (e.g. Metered or Twilio free tiers): set `TURN_USERNAME`/`TURN_CREDENTIAL`; they are only handed to people who joined a meeting.
- Include a `turns:…:443?transport=tcp` URL for networks that only allow HTTPS.
- To prove TURN works, set `ICE_TRANSPORT_POLICY=relay` and look for `relay` candidates in `chrome://webrtc-internals`.

### Mesh limits

Each participant uploads one copy of their video per other participant, so upload bandwidth and CPU grow with N−1. The server caps meetings at 4; beyond ~5 people an SFU (e.g. LiveKit or mediasoup) is the right architecture, and `CallManager` is the seam where it would plug in.

## Screen sharing

- **Media**: the screen track *replaces* the outgoing camera track on every peer connection (`replaceTrack`), so starting/stopping needs no renegotiation; the camera track goes back when sharing stops (or nothing, if the camera was off). `contentHint = "detail"` keeps text sharp.
- **One presenter at a time, decided by the server** (`screen:start` claims the slot; a second person gets `SCREEN_SHARE_BUSY: "Ada is already presenting"`). The UI also disables Share with that reason.
- **One stop path**: the app's Stop button, the **browser's native "Stop sharing" bar** (the track's `ended` event), leaving, and losing the slot all run the same `stop()`: stop the capture, swap the camera back, tell the server.
- **Presentation layout**: the screen is shown large and uncropped (`object-fit: contain`, not mirrored) with everyone else in a filmstrip. The presenter sees a "You're presenting" card instead of their own screen, which would otherwise mirror itself endlessly when sharing this tab.

| Failure case | Behaviour | Tested in |
| --- | --- | --- |
| User closes the screen picker | Silently cancelled; nothing claimed | `client/src/lib/screenShare.test.js` |
| OS blocks capture (macOS Screen Recording) | Explains how to allow it | `screenShare.test.js` |
| Someone else is presenting | Capture stopped immediately (no stray "sharing" indicator), message shown | `screenShare.test.js`, `server/tests/screenShare.test.js` |
| Server unreachable when starting | Capture stopped, error shown | `screenShare.test.js` |
| "Stop sharing" clicked while the claim is in flight | Slot released, nothing shared | `screenShare.test.js` |
| Browser's native "Stop sharing" | Same clean stop as the app button | `screenShare.test.js` + manual |
| Presenter closes the tab | Server frees the slot and tells everyone | `server/tests/screenShare.test.js` |
| Presenter's connection drops and returns | Presenter kept; client re-claims idempotently after rejoin | `server/tests/screenShare.test.js` |
| Mobile browsers without `getDisplayMedia` | Share button hidden | – |

## Chat

**Scope**: messages are sent over the meeting's Socket.IO room only; the sender's name/id come from their token; history requires a token for *that* meeting.

**Persistence policy**: messages are stored in MongoDB **for the lifetime of the meeting**, so people who join late, reload or reconnect see earlier messages. They are **deleted when the meeting ends** (host ends it, or it expires), after which history returns `410`. A 7-day TTL index is a backstop for meetings nobody ever ends. The chat panel states this policy to users.

| Failure case | Behaviour | Tested in |
| --- | --- | --- |
| Message sent to another meeting / by a non-member | Impossible: server routes by the sender's token; non-joined sockets get `NOT_IN_MEETING` | `server/tests/chat.test.js` |
| Empty, > 1000 chars, control chars, bidi overrides | `VALIDATION_ERROR`; emoji (incl. ZWJ sequences) allowed | `chat.test.js` |
| HTML/script in a message | Stored as-is, rendered as text by React (never `innerHTML`) | `chat.test.js` + manual |
| Flooding | 5 messages / 5 s per person, then `RATE_LIMITED` | `chat.test.js` |
| Ack lost / offline while sending | Message marked "Not sent · Retry"; retry reuses the `clientMsgId`, so no duplicate even if the first attempt was stored | `chat.test.js`, `chatState.test.js` |
| Reconnect | History re-fetched and merged without duplicates | `chatState.test.js` |
| Meeting ended | Messages deleted, history `410` | `chat.test.js` |

## Meeting UI and accessibility

- **Layouts**: gallery grid; presentation (screen + filmstrip); side panel with **People** and **Chat** tabs (a full-screen sheet below 900 px). Controls are icon + label, icon-only on phones, with ≥ 44 px touch targets.
- **Participant names** on every tile and in the People list, with host badge, muted/camera-off/presenting icons.
- **Active speaker**: green ring on the tile (and People avatar). Remote levels come from the RTP receivers (`getSynchronizationSources()`), your own from a Web Audio analyser. A detector with a threshold, 1.2 s hold and 1.5× switch ratio avoids flicker (`activeSpeaker.test.js`).
- **Empty states**: "You're the only one here" + invite link; "No messages yet"; "Connecting…/Reconnecting…" per tile and for the meeting.
- **Keyboard**: every control is a native `<button>` with a visible focus ring; toggles use `aria-pressed`, panel buttons `aria-expanded`; the side panel follows the WAI-ARIA tabs pattern (←/→), `Esc` closes it and focus returns to the button that opened it; in chat, Enter sends and Shift+Enter adds a line. Chat is an `aria-live` log; unread count is part of the Chat button's accessible name.

## Data model

- **Meeting** — `code` (unique), `title`, `hostKeyHash` (never returned), `status` (`active`/`ended`), `endedReason`, `maxParticipants`, `lastActiveAt`, `endedAt`, `expiresAt` (TTL index).
- **Participant** — one per join: `meetingId`, `displayName`, `role`, `joinedAt`, `leftAt`.
- **Message** — `meetingId`, `participantId`, `senderName` (denormalized), `text`, `clientMsgId` (unique per participant), `createdAt`, `expiresAt` (TTL backstop). Deleted when the meeting ends.
- **Live presence** — in memory (`RoomManager`): `code → participantId → { displayName, role, socketId, media }`, plus `code → presenterId`.

## Design notes

- **Meeting codes** are 10 random letters from a CSPRNG (~47 bits), backed by a unique index; lookups and joins are rate-limited so guessing is impractical.
- **Host key** is a 192-bit random secret; only its SHA-256 hash is stored, compared in constant time. A wrong key is a 403, not a silent downgrade to guest.
- **Participant tokens** are JWTs (HS256 pinned, 2 h expiry) scoped to one meeting and one role. They authorize both REST calls and the Socket.IO handshake, and a token for meeting A is rejected on meeting B.
- **Capacity** is checked twice: at `/join` for fast feedback, and authoritatively on `room:join`. The socket check and the room insert run with no `await` between them, so two people can't take the last seat at once.
- **Presence lives in memory**, durable records in MongoDB. Closing a tab is detected by the socket disconnect (immediately on a normal close, or after Socket.IO's ~45 s ping timeout if the network just vanishes); the others then close that peer connection. Reconnecting with the same token replaces the old socket without announcing a leave.
- **Remote audio** plays through a separate `<audio>` element per person, so it keeps playing when their camera is off and the tile shows an avatar.
- **Lazy expiry**: idle meetings are expired when their link is next opened, not by a timer, so expiry survives server restarts.
- **Local media**: a single combined `getUserMedia` request (one permission prompt). If it fails, the app retries each device separately so a missing webcam doesn't block the microphone. Camera off stops the track (the camera light turns off); mute only disables the audio track.

## Testing the call manually

1. `npm run dev`, create a meeting at http://localhost:5173, allow camera + mic, and join.
2. Open the invite link in an **Incognito window** (so it isn't treated as the host) or another browser, and join. Each side should see and hear the other; use headphones to avoid echo.
3. Toggle mic/camera on one side: the other shows the muted icon or avatar; turning the camera back on resumes video without reconnecting.
4. Add a third window: everyone sees two remote tiles. A 5th person is refused ("This meeting is full").
5. Close one window: its tile disappears for the others within a second or two.
6. Restart the API mid-call (`Ctrl+C`, then `npm run dev`): "Reconnecting…" appears, then the call recovers by itself.
7. Join from a phone on mobile data (needs the app deployed over HTTPS or a tunnel). Without TURN this may stay on "Connecting…"; with TURN configured it connects.
8. `chrome://webrtc-internals` (or `about:webrtc` in Firefox) shows each connection's state, the selected candidate pair (`host`/`srflx`/`relay`) and bitrate.
9. **Screen share**: click Share, pick a window. Others see it large with "<name> is presenting"; their Share button is disabled. Stop it with the **browser's own "Stop sharing" bar**: your camera returns for everyone. Share again and close that window instead: the others return to the gallery.
10. **Chat**: with the panel closed on one side, send from the other: the Chat button shows an unread badge. Try Shift+Enter for a new line, a 1000+ character message, and `<b>hi</b>` (shown literally). Reload one window: earlier messages are still there. End the meeting: the chat is gone.
11. **Keyboard only**: Tab through the controls, open Chat with Enter, type and send, press Esc — focus returns to the Chat button.
12. **Phone width** (DevTools device toolbar): controls become icon-only, the side panel becomes full-screen.

## Troubleshooting

- **`Could not connect to MongoDB`**: Mongo isn't running. Start Docker Desktop, then `npm run db:up`, or point `MONGODB_URI` at Atlas.
- **`JWT_SECRET must be at least 32 characters`**: generate one with the command in `server/.env.example`.
- **"The server is unavailable" in the UI**: the API isn't running on port 4000; check the `server` output of `npm run dev`.
- **Camera says "in use by another app"**: close Zoom/Teams/other tabs using the camera, then click "Try again".
- **Stuck on "Connecting…" between two networks**: there is no direct path; configure TURN (see [Why TURN](#why-turn)).
- **Echo or feedback**: two devices in the same room without headphones. Echo cancellation can't fully fix speakers feeding a nearby mic.
- **Project inside OneDrive/Dropbox**: sync clients touch files constantly, which slows installs and can trigger restarts. Prefer a folder outside synced storage (e.g. `C:\dev\confer`).
- **Port already in use**: change `PORT` in `server/.env` and `API_PROXY_TARGET` in `client/.env.local`.
