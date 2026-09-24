# Architecture and design decisions

How the pieces fit together and why. Endpoint and event details are in [API.md](API.md).

```
Browser (React)                                    Server (Node)
┌──────────────────────────────┐   HTTPS (REST)    ┌──────────────────────────────────┐
│ Pages: Home, Auth, History,  │ ────────────────▶ │ Express 5: auth, meetings, chat  │
│ Lobby, Meeting               │                   │ history, host end; serves the SPA│
│ useLocalMedia (camera/mic)   │   WSS (Socket.IO) │ Socket.IO: presence, admission,  │
│ useMeetingRoom ─ CallManager │ ◀───────────────▶ │ signaling relay, chat, screen,   │
│   └ PeerLink × N (WebRTC)    │                   │ host controls                    │
└──────────┬───────────────────┘                   │ RoomManager (in-memory presence) │
           │  SRTP media, peer-to-peer             └───────────────┬──────────────────┘
           ▼  (or via TURN when no direct path)                    │ Mongoose
   other participants' browsers                          MongoDB: users, meetings,
                                                          participants, messages
```

## Meeting lifecycle

```
Sign in ─▶ Home ──create──▶ /m/:code (lobby) ──join──▶ [waiting room] ──admit──▶ in meeting ──leave──▶ /m/:code/left
                                 │                                                   │
                         preview camera/mic                             host: admit/deny, remove,
                         enter display name                             lock, guests, end for all
```

1. **Create** (signed in): `POST /api/meetings` with optional settings (`allowGuests`, `waitingRoom`). The creator is the meeting's **host**.
2. **Lobby**: loads the meeting, shows the host's rules (sign-in required, locked, waiting room), asks for camera + mic.
3. **Join**: `POST /api/meetings/:code/join` with a display name. The **server** picks the role from the session cookie and returns a participant token plus `admission: "admitted" | "waiting"`.
4. **Waiting room** (if on): the socket waits in a separate lobby channel until the host admits or denies them.
5. **In the meeting**: presence, WebRTC call, screen share, chat (see below).
6. **Leave / removed / denied / ended**: each ends on a page that explains what happened.
7. **Expiry**: an empty meeting nobody touched for 24 h expires the next time its link is opened. Ended meetings stay in hosts' history for 90 days (TTL index); their chat is deleted immediately.

## Authentication & authorization

### Accounts and sessions
- Email + password. Passwords are hashed with **scrypt** (Node built-in, random salt), compared in constant time; 8–128 characters.
- Login answers `INVALID_CREDENTIALS` for both "unknown email" and "wrong password", and runs a hash either way so timing doesn't reveal which emails exist. Auth routes are rate-limited (10/min/IP).
- The session is a JWT (`aud: confer:session`, 7 days) in an **httpOnly, SameSite=Lax** cookie (`Secure` in production):
  - httpOnly: JavaScript (and therefore XSS) can't read it.
  - SameSite=Lax: browsers don't attach it to cross-site POSTs, so state-changing requests can't be forged from another site (CSRF). All mutations are POST with JSON.
- **Two token types, never interchangeable** (different JWT audiences): the *session* cookie says who you are; the per-meeting *participant token* (`aud: confer:participant`, 12 h, Bearer + Socket.IO auth) says what you are in one meeting.

### Roles
Host (meeting owner), member (signed in), guest (not signed in). The full role and permission tables are in [API.md](API.md#roles).



### Production: one origin
The session cookie is `SameSite=Lax`, so the app and the API must be the same site. In production Express serves the built client too, so the app, REST API, session cookie and WebSocket all share one origin (no CORS, no third-party cookies). Static hosts that proxy `/api` usually **can't proxy WebSockets**, which is why this beats splitting frontend and backend. See [DEPLOYMENT.md](../DEPLOYMENT.md).


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
5. **Bandwidth caps**: each outgoing video is capped per connection by meeting size (1.5 Mbps with one peer, 1 Mbps with two, 0.7 Mbps with three) via `RTCRtpSender.setParameters`, so total upload stays around 2 Mbps in a full meeting.
6. **ICE restarts** (network change): if a connection `failed`, or stays `disconnected` for 4 s, the offerer sends an ICE-restart offer on the same `connectionId` (max 3 tries).

**The server enforces**: the sender must have joined; the target must be in the *same* meeting; `from` comes from the verified token (never the payload); payloads are Zod-validated, SDP ≤ 64 KB, Socket.IO messages ≤ 100 KB, and each socket may relay at most 300 signals per 10 s.

### Why TURN

STUN only tells a browser its public IP/port. That's enough for most home networks, but a direct path is impossible when a peer is behind **symmetric NAT** (common on mobile carriers and some routers) or a **firewall that blocks UDP** (corporate and campus networks). The only option then is a **TURN** server that relays the media, which stays end-to-end encrypted (DTLS-SRTP). Roughly 10–20% of real-world calls need it; without it those users see "Connecting…" forever.

TURN relays real bandwidth, so it must not be an open relay:
- **Self-hosted coturn** with `use-auth-secret`: set `TURN_SECRET`; the API mints credentials that expire after 13 h (longer than the 12 h participant token, so a relayed call is never cut off mid-meeting) (`username = "<expiry>:<participantId>"`, `credential = base64(HMAC-SHA1(secret, username))`). The secret never reaches browsers.
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

**Scope**: messages are sent over the meeting's Socket.IO room only; the sender's name/id come from their token; history requires a token for *that* meeting **and** being admitted (people waiting, denied or removed get `403 NOT_ADMITTED`).

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
- **Page titles** per route ("Sign in · Confer", meeting title), a **skip link** to the main content, and a visually hidden live region that announces "Ada joined" / "Bo left".
- **Keyboard**: every control is a native `<button>` with a visible focus ring; toggles use `aria-pressed`, panel buttons `aria-expanded`; the side panel follows the WAI-ARIA tabs pattern (←/→), `Esc` closes it and focus returns to the button that opened it; in chat, Enter sends and Shift+Enter adds a line. Chat is an `aria-live` log; unread count is part of the Chat button's accessible name.

## Data model

- **User** — `email` (unique, lowercase), `name`, `passwordHash` (scrypt, never returned).
- **Meeting** — `code` (unique), `title`, `hostUserId`, `hostName`, `settings { allowGuests, waitingRoom, locked }`, `bannedUserIds` (never returned), `status`, `endedReason`, `maxParticipants`, `lastActiveAt`, `endedAt`, `expiresAt` (TTL, 90 days after ending).
- **Participant** — one per join request: `meetingId`, `userId?`, `displayName`, `role`, `status` (`waiting`/`admitted`/`denied`/`removed`), `admittedBy`, `enteredAt` (history + lock), `leftAt`.
- **Message** — `meetingId`, `participantId`, `senderName` (denormalized), `text`, `clientMsgId` (unique per participant), `createdAt`, `expiresAt` (TTL backstop). Deleted when the meeting ends.
- **Live presence** — in memory (`RoomManager`): who is in each room, who is waiting, and who is presenting.

## Design notes

- **Meeting codes** are 10 random letters from a CSPRNG (~47 bits), backed by a unique index; lookups and joins are rate-limited so guessing is impractical.
- **Host = owner**: hosting is tied to the account that created the meeting, not to a secret link, so it works from any device and can't be leaked by forwarding a URL.
- **Participant tokens** are JWTs (HS256 pinned, 12 h expiry; admission is re-checked in the database on every use) scoped to one meeting and one role. They authorize both REST calls and the Socket.IO handshake, and a token for meeting A is rejected on meeting B. Session and participant tokens use different audiences, so neither can stand in for the other.
- **Capacity** is checked twice: at `/join` for fast feedback, and authoritatively on `room:join`. The socket check and the room insert run with no `await` between them, so two people can't take the last seat at once.
- **Presence lives in memory**, durable records in MongoDB. Closing a tab is detected by the socket disconnect (immediately on a normal close, or after Socket.IO's ~45 s ping timeout if the network just vanishes); the others then close that peer connection. Reconnecting with the same token replaces the old socket without announcing a leave.
- **Remote audio** plays through a separate `<audio>` element per person, so it keeps playing when their camera is off and the tile shows an avatar.
- **Lazy expiry**: idle meetings are expired when their link is next opened, not by a timer, so expiry survives server restarts.
- **Local media**: a single combined `getUserMedia` request (one permission prompt). If it fails, the app retries each device separately so a missing webcam doesn't block the microphone. Camera off stops the track (the camera light turns off); mute only disables the audio track.
