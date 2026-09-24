# Manual test checklist: two people, two networks

Automated tests cover the logic and a two-browser call on one machine. What they can't cover is **real networks, real devices and real people**. Run this before sharing the app or recording a demo.

## Setup

| | Person A (host) | Person B (guest) |
| --- | --- | --- |
| Device | Laptop, Chrome or Edge | Phone (Chrome/Safari) **or** a second laptop |
| Network | Home/office Wi-Fi | **Mobile data** (Wi-Fi off), or a phone hotspot on a different carrier |
| Audio | Headphones | Headphones (two open speakers in one room = echo) |

- The app must be deployed over **HTTPS** (see [DEPLOYMENT.md](../DEPLOYMENT.md)). `http://` on a LAN IP won't get camera access.
- TURN configured (`TURN_URLS` + secret/credentials). Mobile data is the network most likely to need it.
- Person A opens `chrome://webrtc-internals` in a second tab **before** joining (it only records connections made after it's open).

Record results in the table at the end. "Expected" is what should happen; anything else is a bug.

## 1. Accounts and lobby

| # | Step | Expected |
| --- | --- | --- |
| 1.1 | A signs up, creates "Two-network test" with **Waiting room** on | Lobby shows "You're the host", camera preview, mic level bar moves when A talks |
| 1.2 | A turns the camera off and on in the lobby | Camera light goes off, then preview returns |
| 1.3 | A joins | "You're the only one here" + invite link |
| 1.4 | A copies the invite link and sends it to B | – |
| 1.5 | B opens the link (signed out) | "Hosted by <A>", "Joining as a guest", button says **Ask to join** |
| 1.6 | B denies camera permission when the browser asks | Specific message "Access to your camera is blocked…", mic still works, B can continue |
| 1.7 | B allows the camera (browser site settings) and taps **Try again** | Preview appears |

## 2. Admission and connection across networks

| # | Step | Expected |
| --- | --- | --- |
| 2.1 | B taps **Ask to join** | B: "Waiting for the host to let you in". A: banner "<B> is waiting to join", People button says "1 waiting" |
| 2.2 | A clicks **Admit** | Within ~5 s both see each other's video and hear each other. No tile stuck on "Connecting…" |
| 2.3 | In A's webrtc-internals, open the connection → "Selected candidate pair" | Type is `host`/`srflx` (direct) or `relay` (TURN). Note which. |
| 2.4 | Talk for 2 minutes | Audio in sync, no robotic sound; video may adapt to the phone's network but doesn't freeze for > 2 s |
| 2.5 | Each person speaks in turn | Green "speaking" ring follows the speaker without flickering |

## 3. Controls

| # | Step | Expected |
| --- | --- | --- |
| 3.1 | B mutes | A sees the muted icon on B's tile within ~1 s; A can't hear B |
| 3.2 | B turns the camera off, then on | A sees B's avatar, then video again, without "Reconnecting…" |
| 3.3 | A shares a window (not this tab) | B sees it large with "<A> is presenting", text is readable; A sees "You're presenting" card |
| 3.4 | A stops with the **browser's own "Stop sharing" bar** | B's view returns to A's camera; A can share again |
| 3.5 | On a phone, B looks for Share | Hidden on browsers without screen capture (expected, not a bug) |
| 3.6 | B sends a chat message with a line break (Shift+Enter on laptop) and an emoji | A gets an unread badge; message shows with the line break and emoji |
| 3.7 | B sends `<b>hi</b>` | Shown literally, not bold |

## 4. Network trouble (the reason this checklist exists)

| # | Step | Expected |
| --- | --- | --- |
| 4.1 | B switches networks mid-call (turn Wi-Fi on/off on the phone) | Tile shows "Reconnecting…" for a few seconds, then video resumes; at worst a brief freeze |
| 4.2 | B enables airplane mode for 10 s, then disables it | A sees "Reconnecting…" on B's tile; B's header shows "Connection lost. Reconnecting…"; the call recovers without either person reloading |
| 4.3 | B closes the tab/app without clicking Leave | B's tile disappears for A within a few seconds (up to ~45 s if the phone lost network entirely) |
| 4.4 | B reopens the link and asks to join again | Goes through the waiting room again; A admits; call works |
| 4.5 | *(TURN check)* Deploy with `ICE_TRANSPORT_POLICY=relay`, repeat 2.2–2.3 | Call still connects; selected pair is `relay`. Set the policy back afterwards |

## 5. Host controls

| # | Step | Expected |
| --- | --- | --- |
| 5.1 | A opens People → toggles **Lock meeting** | Both see "Locked"; a third device opening the link sees "This meeting is locked" |
| 5.2 | A removes B | B lands on "You were removed from the meeting"; reopening the link as the same *signed-in* user is refused |
| 5.3 | A unlocks, turns **Allow guests** off, B (signed out) opens the link | B sees "Sign in to join" |
| 5.4 | A clicks **End for all** | Everyone lands on an "ended" page; the link now says "This meeting has ended"; A's **My meetings** shows it as Ended |

## 6. Accessibility spot-check (laptop)

| # | Step | Expected |
| --- | --- | --- |
| 6.1 | Using only Tab/Shift+Tab/Enter/Space/Esc: join, mute, open chat, send a message, close chat, leave | Everything reachable; focus ring always visible; Esc returns focus to the Chat button |
| 6.2 | With a screen reader (NVDA/VoiceOver) on, have B join and leave | "<B> joined" / "<B> left" is announced; controls announce "Microphone, toggle button, pressed" |
| 6.3 | Phone in portrait | No horizontal scrolling; controls are icon-only and large enough to tap; chat opens full-screen |

## Results

| Date | A network / browser | B network / browser | Candidate type (2.3) | Failed steps | Notes |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## If something fails

- **Stuck on "Connecting…"** → TURN missing or misconfigured (check 4.5; check coturn logs and firewall ports).
- **No camera prompt** → not HTTPS, or permission blocked in site settings.
- **Echo** → one side isn't using headphones.
- **Server errors** → find the `requestId` (500 responses) or the meeting code in the logs (`grep` the JSON logs for `"code":"abc-defg-hij"`).

## Quick single-machine checks (before the two-network run)

Use a normal window + an Incognito window (separate cookies) on `http://localhost:5173` after `npm run dev`.

1. **Capacity**: with the host in the meeting, three more windows fit; a fifth person sees "This meeting is full". Without the host, only three non-hosts fit (one seat is kept for the host).
2. **Server restart mid-call**: stop and restart `npm run dev`. "Reconnecting…" appears, then the call rebuilds itself.
3. **Deny**: with the waiting room on, deny a request; that person sees "The host didn't let you in" and can't get back in with the same session.
4. **Bypass attempt**: while locked, run in the guest's DevTools console:
   `fetch('/api/meetings/<code>/join', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{"displayName":"x"}'}).then(r => r.status)` → `423`, even though the button was disabled.
5. **Chat persistence**: reload one window, rejoin: earlier messages are back. End the meeting: they're gone.
6. **Phone width** (DevTools device toolbar): controls become icon-only, the side panel becomes full-screen, no horizontal scroll.
