# API reference

REST endpoints, Socket.IO events, error codes and the permission model. Design rationale lives in [ARCHITECTURE.md](ARCHITECTURE.md).

**Tokens.** Browser sessions use an httpOnly cookie (`confer_session`). Inside a meeting, REST calls and the Socket.IO handshake use the per-meeting **participant token** returned by `POST /api/meetings/:code/join` (`Authorization: Bearer …` / `io(url, { auth: { token } })`). Every response carries an `X-Request-Id`; 500 errors include it as `error.requestId` so it can be matched to the server log.

## Roles
The server assigns the role when it issues a participant token; the client can't choose it.

| Role | Who |
| --- | --- |
| `host` | The signed-in user who created the meeting |
| `member` | Any other signed-in user |
| `guest` | Not signed in (only if the host allows guests) |

## Permissions (`server/src/lib/permissions.js`)
Every REST route and socket event below checks this table on the server. Hiding a button in the UI is only a convenience.

| Action | host | member | guest | Where enforced |
| --- | :-: | :-: | :-: | --- |
| Create a meeting, view own history | signed-in users | ✓ | – | `requireUser` |
| Join by link | ✓ | ✓ | if `allowGuests` | join policy (`meeting.service.joinMeeting`) |
| Bypass waiting room / lock / guest setting | ✓ | – | – | join policy + `room:join` |
| Chat, screen share, audio/video | ✓ | ✓ | ✓ | `chat.send`, `screen.share` (+ must be admitted) |
| Admit / deny from waiting room | ✓ | – | – | `lobby.admit`, `lobby.deny` |
| Remove a participant | ✓ | – | – | `participant.remove` (can't remove a host or yourself) |
| Lock, waiting room, allow guests | ✓ | – | – | `meeting.updateSettings` |
| End for everyone | ✓ | – | – | `meeting.end` |

**Admission is re-checked in the database on every `room:join`**, so an old token can't bypass a later decision:

| Situation | Result |
| --- | --- |
| Denied by the host | `ADMISSION_DENIED`, forever, for that token |
| Removed by the host | `REMOVED_FROM_MEETING` for that token; signed-in users are also banned from getting a new one (403) |
| Meeting locked | No new tokens (`423`); a token issued before the lock that never entered gets `MEETING_LOCKED`. People already inside can reconnect; people the host admits personally can enter |
| Guests disallowed | Guests get `401 SIGN_IN_REQUIRED`; guests already inside stay |
| Waiting room turned off | Everyone waiting is admitted |
| Room full | One seat is kept for the host while they're absent, so the owner can always get in |

Removed **guests** can come back with a new identity (there is nothing to ban); lock the meeting or use the waiting room to prevent that.

## Errors, REST and Socket.IO events

All errors share one shape (REST and Socket.IO acks):

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "details": [{ "location": "body", "path": "displayName", "message": "..." }] } }
```

| Code | Status | When |
| --- | --- | --- |
| `VALIDATION_ERROR` / `INVALID_JSON` | 400 | Bad params/query/body |
| `AUTH_REQUIRED` | 401 | Route needs a signed-in user |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `SIGN_IN_REQUIRED` | 401 | Guest joining a meeting that doesn't allow guests |
| `UNAUTHORIZED` / `TOKEN_EXPIRED` | 401 | Missing, invalid or expired token |
| `FORBIDDEN` | 403 | Role lacks the permission, or token is for another meeting |
| `NOT_ADMITTED` | 403 | Chat history requested by someone waiting, denied or removed |
| `REMOVED_FROM_MEETING` | 403 | Signed-in user the host removed |
| `NOT_FOUND` | 404 | Unknown meeting or route |
| `EMAIL_TAKEN` | 409 | Registering an email that exists |
| `ROOM_FULL` | 409 | No seat left |
| `MEETING_ENDED` | 410 | Ended by the host, or the link expired |
| `MEETING_LOCKED` | 423 | Host locked the meeting |
| `PAYLOAD_TOO_LARGE` / `RATE_LIMITED` / `INTERNAL_ERROR` | 413 / 429 / 500 | |

### REST

| Method | Path | Auth | Body / query | Success |
| --- | --- | --- | --- | --- |
| `GET` | `/api/health` | – | – | `200 { status, db }` (`503` if DB down) |
| `POST` | `/api/auth/register` | – | `{ name ≤ 40, email, password 8–128 }` | `201 { user }` + session cookie |
| `POST` | `/api/auth/login` | – | `{ email, password }` | `200 { user }` + session cookie |
| `POST` | `/api/auth/logout` | – | – | `204`, cookie cleared |
| `GET` | `/api/auth/me` | session | – | `200 { user }` |
| `GET` | `/api/me/meetings` | session | `?limit=1–100` | `200 { meetings }`: hosted or attended, newest first, with `role` and `attendeeCount` |
| `POST` | `/api/meetings` | session | `{ title? ≤ 80, settings?: { allowGuests?, waitingRoom? } }` | `201 { meeting, joinUrl }` |
| `GET` | `/api/meetings/:code` | optional session | – | `200 { meeting }` (ended meetings: `status: "ended"`) |
| `POST` | `/api/meetings/:code/join` | optional session | `{ displayName: 1–40 chars }` | `200 { participant, admission, token, rtcConfig, meeting }` |
| `GET` | `/api/meetings/:code/messages` | participant token, admitted | `?before=<iso>&limit=1–100` | `200 { messages }` oldest first · `410` after the meeting ends |
| `POST` | `/api/meetings/:code/end` | participant token with `meeting.end` | – | `204` (also deletes the meeting's chat) |

`user` = `{ id, name, email, createdAt }`
`meeting` = `{ code, title, hostName, status, endedReason?, settings: { allowGuests, waitingRoom, locked }, maxParticipants, participantCount, viewerIsHost, createdAt, endedAt? }`
`participant` = `{ id, displayName, role: "host" | "member" | "guest" }` · `admission` = `"admitted" | "waiting"`
`rtcConfig` = `{ iceServers, iceTransportPolicy }`, passed straight to `new RTCPeerConnection()`

### Socket.IO (connect with `auth: { token }` — the participant token)

**Presence, media and signaling**

| Direction | Event | Payload |
| --- | --- | --- |
| C→S (ack) | `room:join` | `{ media: { audio, video } }` → `{ ok, waiting: true, settings }` · `{ ok, self, peers[], presenterId, settings, lobby? }` (`lobby` for hosts) · or `MEETING_ENDED` / `ROOM_FULL` / `MEETING_LOCKED` / `ADMISSION_DENIED` / `REMOVED_FROM_MEETING` |
| C→S (ack) | `room:leave` | → `{ ok: true }` |
| C→S | `media:state` | `{ audio, video }` |
| C→S | `signal` | `{ to, connectionId, type: "offer" \| "answer" \| "candidate", sdp?, candidate? }` |
| S→C | `peer:joined` | `{ participantId, displayName, role, joinedAt, media }` |
| S→C | `peer:left` | `{ participantId }` |
| S→C | `peer:media` | `{ participantId, audio, video }` |
| S→C | `signal` | `{ from, connectionId, type, sdp?, candidate? }` |
| S→C | `meeting:ended` | `{ reason: "host_ended" \| "expired" }` (also sent to the waiting room) |
| S→C | `session:replaced` | – (same participant connected from another tab) |

**Screen share and chat** (must be admitted)

| Direction | Event | Payload |
| --- | --- | --- |
| C→S (ack) | `screen:start` | → `{ ok: true }` or `SCREEN_SHARE_BUSY` / `NOT_IN_MEETING` / `FORBIDDEN` |
| C→S | `screen:stop` | – |
| S→C | `presenter:changed` | `{ participantId \| null }` |
| C→S (ack) | `chat:send` | `{ text ≤ 1000, clientMsgId }` → `{ ok: true, message }` or `VALIDATION_ERROR` / `RATE_LIMITED` / `NOT_IN_MEETING` |
| S→C | `chat:message` | `{ id, participantId, senderName, text, clientMsgId, createdAt }` |

**Host controls** (ack; `NOT_IN_MEETING` unless admitted, `FORBIDDEN` unless the role has the permission)

| Direction | Event | Payload / result |
| --- | --- | --- |
| C→S | `lobby:admit` | `{ participantId }` → `{ ok }` · `NOT_FOUND` if no longer waiting |
| C→S | `lobby:deny` | `{ participantId }` → `{ ok }` |
| C→S | `participant:remove` | `{ participantId }` → `{ ok }` · `BAD_REQUEST` (yourself) · `FORBIDDEN` (a host) · `NOT_FOUND` |
| C→S | `meeting:update` | `{ locked?, waitingRoom?, allowGuests? }` (≥ 1 key) → `{ ok, settings }` |
| S→C | `lobby:updated` | `{ waiting: [{ participantId, displayName, role, requestedAt }] }` (hosts only) |
| S→C | `lobby:admitted` | – (to the admitted person; they re-emit `room:join`) |
| S→C | `lobby:denied` | – (then disconnected) |
| S→C | `participant:removed` | – (then disconnected; others get `peer:left`) |
| S→C | `meeting:settings` | `{ allowGuests, waitingRoom, locked }` (everyone, including the waiting room) |

Socket.IO rooms per meeting: `<code>` (admitted participants only), `<code>:hosts`, `<code>:lobby`. Waiting sockets are never in `<code>`, so they receive no media, chat or presence traffic.
