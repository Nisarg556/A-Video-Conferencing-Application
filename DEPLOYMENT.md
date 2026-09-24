# Deployment guide

Confer runs as **one Node service** that serves the React app, the REST API and the Socket.IO WebSocket on a single HTTPS origin, plus **MongoDB** and (for real-world reliability) a **TURN server**.

```
                 https://meet.example.com  (one origin, TLS at the platform)
 Browser ───────────────────────────────────────────────────────────────▶  Node service
   │   GET /, /m/:code …  → built React app (client/dist)                   ├─ Express: /api/*
   │   /api/*             → REST (session cookie, participant tokens)       ├─ Socket.IO: /socket.io (wss)
   │   wss://…/socket.io  → presence, signaling, chat, host controls        └─ MongoDB Atlas
   │
   └── WebRTC media: peer-to-peer (UDP), or relayed via turn(s)://turn.example.com when no direct path
```

## Why one service (not "frontend on Vercel + API elsewhere")

1. **WebSockets.** Socket.IO needs a long-lived connection. Static/serverless hosts (Vercel, Netlify) can rewrite `/api` to a backend, but they **do not proxy WebSocket upgrades**, so signaling would break.
2. **Cookies.** The session cookie is `SameSite=Lax` + `httpOnly`. With app and API on one origin it's a normal first-party cookie; split across two sites it would need `SameSite=None` plus CSRF tokens.
3. **Simplicity.** No CORS in production, one thing to deploy, one log stream.

In production `server/src/index.js` serves `client/dist` automatically when `NODE_ENV=production` and the build exists.

## Environment variables (production)

| Variable | Required | Example / notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` (enables `Secure` cookies, `trust proxy`, serving the client) |
| `PORT` | set by host | Render/Railway/Fly inject it; default `4000` |
| `MONGODB_URI` | yes | `mongodb+srv://confer:<password>@cluster0.xxxxx.mongodb.net/confer` (never logged; credentials are redacted) |
| `CLIENT_URL` | yes | `https://meet.example.com`: your public origin, **no trailing slash**. Used for invite links, CORS and the CSP `connect-src` (`wss://meet.example.com`) |
| `JWT_SECRET` | yes | ≥ 32 random chars: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Rotating it signs everyone out |
| `STUN_URLS` | no | Defaults to Google's public STUN |
| `TURN_URLS` | recommended | `turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:5349?transport=tcp` |
| `TURN_SECRET` | with coturn | Same value as coturn's `static-auth-secret` |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | with a managed TURN | Static credentials from the provider |
| `ICE_TRANSPORT_POLICY` | no | `relay` only while *testing* TURN |
| `LOG_LEVEL` | no | `info` (default), `debug`, `warn` … |

The server validates all of these at startup and exits with a clear message if something is missing or malformed.

## Option A: Render (simplest)

1. **MongoDB Atlas**: create a free M0 cluster, a database user, and allow access from anywhere (`0.0.0.0/0`, since Render's outbound IPs vary on lower plans). Copy the connection string.
2. **Render → New → Web Service** from the GitHub repo:
   - Runtime: Node 22 · Build command: `npm ci && npm run build` · Start command: `node server/src/index.js`
   - Health check path: `/api/health`
   - Environment: the variables above (`NODE_ENV=production`, `CLIENT_URL=https://<service>.onrender.com`, …)
3. Deploy, then open `https://<service>.onrender.com/api/health`: expect `{"status":"ok","db":"up"}`.
4. Optional custom domain: add it in Render, create the DNS record, update `CLIENT_URL`.

The **free** instance sleeps after ~15 idle minutes and takes ~1 minute to wake: fine for a portfolio link, bad for a live demo (warm it up first). Use a paid instance for anything real.

## Option B: Docker (Fly.io, Railway, any VM)

```bash
docker build -t confer .
docker run -p 4000:4000 --env-file server/.env -e NODE_ENV=production -e CLIENT_URL=http://localhost:4000 confer
```

The multi-stage `Dockerfile` builds the client and ships only the server's production dependencies, runs as the non-root `node` user, and has a health check. On Fly.io: `fly launch` (detects the Dockerfile), `fly secrets set MONGODB_URI=… JWT_SECRET=… CLIENT_URL=https://<app>.fly.dev`, `fly deploy`.

## HTTPS

- **Browsers only allow camera, microphone and screen capture on HTTPS** (or `localhost`). An `http://` deployment will show "Your browser can't access a camera…".
- Render, Railway and Fly terminate TLS for you (automatic certificates). Behind their proxy the app sees HTTP; `trust proxy` is enabled in production so rate limiting uses the real client IP and `Secure` cookies work.
- Helmet sends HSTS, `X-Content-Type-Options`, a Content-Security-Policy (scripts only from this origin; network only to this origin and its `wss://`), and `Permissions-Policy` limiting camera/mic/screen capture to this site.

## WebSocket configuration

- The client uses **WebSocket-only** transport (no long-polling), so **no sticky sessions** are needed on a single instance.
- Socket.IO pings every 25 s, which keeps the connection alive through typical load-balancer idle timeouts (60–100 s).
- Messages over 100 KB are rejected (`maxHttpBufferSize`); every connection must present a valid participant token in the handshake.
- **Self-hosting behind Nginx**: forward the upgrade headers and raise the read timeout:

  ```nginx
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
  }
  ```

- **More than one instance** requires moving presence (`RoomManager`) to Redis and adding the Socket.IO Redis adapter. Until then, run exactly **one** instance (see Limitations in the README).

## TURN

About 10–20% of real-world connections (symmetric NAT on mobile networks, corporate firewalls that block UDP) can't connect peer-to-peer. TURN relays their encrypted media. Without it they sit on "Connecting…".

### Choice 1: self-hosted coturn (cheapest at volume, full control)

On a small Linux VM with a public IP and a DNS name such as `turn.example.com`:

```bash
sudo apt install coturn certbot
sudo certbot certonly --standalone -d turn.example.com
```

`/etc/turnserver.conf`:

```ini
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=<the same value as TURN_SECRET>
realm=turn.example.com
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
external-ip=<public IP of the VM>
min-port=49152
max-port=65535
no-cli
no-multicast-peers
# Never relay into private networks (prevents using your TURN to reach internal services)
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
```

Firewall: open **3478/udp+tcp**, **5349/tcp**, and **49152–65535/udp**. Then set `TURN_URLS` (above) and `TURN_SECRET` on the app. The API mints per-participant credentials (`HMAC-SHA1(secret, "<expiry>:<participantId>")`) valid for 13 h; the secret itself never reaches browsers.

For networks that only allow HTTPS, also serve TURN-over-TLS on **443** (`turns:turn.example.com:443?transport=tcp`), which needs a dedicated IP/VM where nothing else uses 443.

### Choice 2: managed TURN

Metered, Twilio Network Traversal, Cloudflare Realtime and others sell TURN by the GB. Put their URLs in `TURN_URLS` and their credentials in `TURN_USERNAME`/`TURN_CREDENTIAL` (only participants who have joined a meeting ever receive them). If the provider offers an API for short-lived credentials, prefer it and adapt `getRtcConfig()` in `server/src/realtime/iceServers.js`.

### Verify TURN actually works

1. Temporarily set `ICE_TRANSPORT_POLICY=relay` and redeploy: every call must now go through TURN.
2. Join from two devices; open `chrome://webrtc-internals` → the selected candidate pair should show `relay`.
3. Or paste your TURN URL + a credential into the [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/) sample and look for `relay` candidates.
4. Set the policy back to `all`.

## Operations

- **Health:** `GET /api/health` → `200 {"status":"ok","db":"up"}` or `503` when the database is unreachable. Point the platform's health check at it.
- **Logs:** one JSON object per line (pino). Every API request is logged with `req.id`, status and duration; socket events log `joined meeting`, `left meeting`, `host action`, `meeting ended` with meeting code and participant id. Tokens, cookies, passwords and DB credentials are redacted. A 500 response includes `error.requestId` to find the matching log line.
- **Shutdown:** `SIGTERM` closes sockets and the HTTP server, then MongoDB, which is what platforms send on redeploys.
- **Data retention:** chat is deleted when a meeting ends; ended meetings are deleted 90 days later (MongoDB TTL); messages have a 7-day TTL backstop.

## Realistic costs

Prices change; treat these as order-of-magnitude figures and check the providers' pricing pages before committing.

| Component | Portfolio / demo | Small real usage |
| --- | --- | --- |
| App (Node service) | Render free tier: $0 (sleeps when idle) | Render/Railway small instance ≈ $5–7 / month, or Fly.io small VM ≈ $2–5 / month |
| MongoDB | Atlas M0 free (512 MB, plenty for this app) | Still M0; paid tiers only for backups/SLAs |
| TURN | None, or a managed free tier (usually < 1 GB/month) | Self-hosted coturn on a small VM ≈ $4–6 / month with multiple TB of transfer included; managed TURN is typically ≈ $0.05–0.40 per GB relayed |
| Domain (optional) | – | ≈ $10–15 / year |
| **Total** | **$0** | **≈ $10–15 / month** |

**Why TURN is the variable cost.** Media only touches TURN for people who can't connect directly. With the app's per-connection caps, a relayed person in a full 4-person meeting sends and receives about 3 × 0.7 Mbps each way ≈ 4.4 Mbps, which is **≈ 2 GB per hour**; in a 1:1 call it's ≈ 3 Mbps ≈ 1.4 GB per hour. At $0.05/GB that's ≈ $0.10 per relayed hour; at $0.40/GB, ≈ $0.80. That's why a flat-price VM running coturn is the sensible default once real people use it.

The server itself is cheap because **media never passes through it** (mesh + TURN only when needed); it only relays small signaling messages.

## Pre-launch checklist

- [ ] `NODE_ENV=production`, strong `JWT_SECRET`, `CLIENT_URL` equals the public HTTPS origin
- [ ] `/api/health` returns `db: "up"`
- [ ] TURN verified with `ICE_TRANSPORT_POLICY=relay`, then set back to `all`
- [ ] Two-network test from [docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md) passes
- [ ] Atlas network access and a database user with least privilege (read/write on the `confer` database only)
- [ ] Exactly one app instance running
