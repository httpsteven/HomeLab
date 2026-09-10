# Home Lab Dashboard

One dashboard for a Plex home lab. Aggregates **Plex, Tautulli, Sonarr, Radarr, Bazarr** and
**Glances** into a single view: what's streaming, how full the disks are, what's eating the space,
how long until you run out, and whether anything is broken.

Runs entirely on your own network. Every API key stays server-side — nothing is sent to the
browser, and nothing leaves your LAN.

---

## What it does

**Storage** — the main event. Per-mount capacity with warning thresholds, a ranked table of the
largest movies and series (sortable by size *per episode*, which is what actually catches a season
grabbed at remux quality), library composition, and a growth chart with a runway projection of
when each mount fills up.

**Library** — every movie and series Sonarr and Radarr track, searchable and sortable, with size,
quality, codec, completeness and monitored state. Distribution by quality profile and codec. Plex's
own counts are shown alongside rather than merged, so a drift between them stays visible.

**Activity** — live streams with transcode detail and per-stream bandwidth, plus watch history:
plays over time, top titles, top users.

**Health** — CPU (per core), memory, temperatures, disk I/O, network and top processes from
Glances, beside each service's own health warnings, the download queue with failures called out,
and Bazarr's subtitle coverage.

**Control** — safe actions only: refresh, rescan, search, toggle monitored, retry a stalled import,
trigger a subtitle search, and stop a Plex stream (behind a confirmation). There is no delete,
remove or blocklist anywhere in the codebase.

---

## Near real-time

Browsers never poll your services. One collector in the server owns every upstream connection,
keeps a single state snapshot, and pushes changes to browsers over SSE — so ten open tabs and a
phone cost your lab exactly what one costs.

Most of the stack can push, using the same channels their own web UIs use:

| Source | Transport | Latency |
|---|---|---|
| Plex | WebSocket | instant |
| Sonarr / Radarr | SignalR | instant |
| Bazarr | Socket.IO | instant |
| Tautulli | REST poll | 2s |
| Glances | REST poll | 2s |

Expensive calls (enumerating every movie and series) are cached for 10 minutes, and **push events
invalidate that cache early** — so an import shows up in the numbers without polling for it.

Every push source has a polling fallback and switches automatically if a socket won't hold. The
Services panel shows `push · live` or `polling` per service, so the real-time claim is verifiable
rather than assumed.

---

## If it feels slow

```bash
curl -s http://localhost:3000/api/diag | jq
```

Reports every slot's freshness and failure count, whether each service is
pushing or polling, and a live per-service response time. `ageSeconds` climbing on
a slot, or a non-zero `consecutiveFailures`, names the culprit directly.

The `/setup` page shows, per service, the URL it actually resolved. If that isn't
what you put in `.env.local`, the process is reading a different value than the file
you edited — a stale container env or an unmounted file — and that's the whole bug.

### Some services connect, others hang

Almost always the host firewall, when the dashboard runs **in Docker on the same box
as the services**.

On a bridge network, a request to the host's own LAN IP leaves the container, crosses
the Docker bridge, and arrives at the host's LAN interface — where the host firewall
treats it like any outside client. Ports you opened for remote access get through;
the rest are dropped. A dropped packet **hangs until timeout**, while a genuinely
closed port refuses *instantly* — so "two services work, the rest hang" is the
signature of firewall rules, not of broken services.

```bash
sudo ufw status verbose     # are only some of these ports allowed?
```

Two fixes:

- **Use host networking** (what `docker-compose.yml` now does) and point the URLs at
  `http://127.0.0.1:<port>`. The container shares the host's network stack, so the
  firewall never enters into it. Simplest, and one less network hop.
- **Or allow Docker's bridge subnet** to reach those ports:
  `sudo ufw allow from 172.16.0.0/12 to any port 8989 proto tcp` (repeat per port).

### Nothing loads at all

`hasData: false` on every slot means no source has succeeded. Check the resolved URLs
on `/setup` first. Note that inside a *bridge-networked* container `localhost` means
the container itself — use `127.0.0.1` only with host networking, and LAN IPs
otherwise.

- **Response times in `probes`.** Anything over ~500 ms on the LAN means that service
  is the bottleneck, not the dashboard.

Polling is deliberately modest: one Glances request every 3s, one Tautulli
activity call every 2s, and the expensive library enumeration only every 10
minutes. If you see substantially more traffic than that hitting a service,
that's a bug worth reporting.

---

## Setup

### 1. Configure

```bash
cp .env.example .env.local
```

Fill in the URL and API key for each service — every one is optional, and the dashboard works with
however many you've connected. Where to find each key is documented in `.env.example`.

### 2. Run

```bash
npm install
npm run dev
```

Open <http://localhost:3000/setup>. Each service shows connected/failed with its version and the
specific reason for any failure — bad key, wrong address, or nothing listening. Fix anything red
there before worrying about the rest of the dashboard.

### 3. Machine metrics (optional but recommended)

CPU, memory, temperatures and disk I/O come from Glances, running on the media server:

```bash
docker run -d --restart unless-stopped \
  --name glances --pid host --network host \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -e GLANCES_OPT="-w" \
  nicolargo/glances:latest-full
```

Then set `GLANCES_URL=http://<server-ip>:61208`. Without it, everything else still works — you just
don't get machine-level stats.

---

## Quietening irrelevant warnings

Sonarr and Radarr report health checks that assume you acquire media through
indexers and a download client. If you build your library another way — ripping
discs, say — several of those are permanently true and permanently irrelevant,
and a health panel that always shows five warnings is one you stop reading.

```
HEALTH_MUTE=download-automation
```

That covers the indexer, download-client and import-mechanism checks across
both services. Muted checks are still **counted** in the panel ("2 muted"), so
a rule you set months ago can't silently hide something you'd want to see.

Deliberately not included in that group: `UpdateCheck`, because an available
update is real information, and anything about the library itself such as
`RemovedMovieCheck`. Mute those individually if you want them gone:

```
HEALTH_MUTE=download-automation,updates,radarr:RemovedMovieCheck
```

Matching is on the check's source — Servarr's stable check-class name — rather
than its message, since messages carry version numbers and get reworded between
releases.

---

## Demo mode

To see the dashboard populated before connecting anything:

```bash
echo "DEMO_MODE=1" > .env.local
npm run dev
```

Generates a realistic library, storage, streams and 45 days of growth history in the exact shapes
the real aggregators produce. No network calls. Remove the line to go back to live data.

---

## Deploying on the LAN

### Docker (recommended)

```bash
docker compose up -d --build
```

Reachable at `http://<host-ip>:3000`. The `data/` volume holds growth history — keep it across
redeploys or the storage chart starts over.

`docker-compose.yml` also includes the Glances service. If the dashboard runs on a different
machine than the media server, run Glances on the media server instead and point `GLANCES_URL` at
it.

### Without Docker

```bash
npm run build
npm run start -- -H 0.0.0.0
```

Also reachable on the LAN. Note that growth snapshots only accumulate while the process is
running, so a machine that sleeps will leave gaps.

### ⚠️ There is no authentication

Anyone who can reach the port gets the dashboard and its control actions. That's normally fine on
a home network — it's how most people run Sonarr and Radarr — but:

- **Don't port-forward this.** For remote access use Tailscale or a VPN, not a public port.
- Put it behind your reverse proxy's auth if you want a password.

The API keys themselves are never exposed to the browser, but the actions they enable are.

---

## How it's built

- **Next.js 16** (App Router) + TypeScript, Tailwind v4
- **Server-side only** service clients — `src/lib/clients/`, one per service
- **Collector + SSE** — `src/lib/collect/`, the single source of live data
- **Aggregators** — `src/lib/aggregate/`, normalizing five vendor shapes into one
- **Actions** — `src/lib/actions.ts`, a fixed allowlist; the browser sends an action *name*, never
  a URL or command, so there's no path to an arbitrary API call
- **History** — `data/history.jsonl`, one appended line per snapshot. No database to run; delete
  the file to reset the growth chart.

### Icons

The app mark lives in two places that must stay in sync: `src/app/icon.svg`
(hardcoded colours — a favicon has no CSS to inherit) and
`src/components/ui/Logo.tsx` (same geometry, wired to the theme tokens so the
in-app logo follows the accent). After editing the SVG:

```bash
node scripts/make-icons.mjs
```

That regenerates the apple-touch icon and the PWA icons, including a maskable
variant with the safe-zone padding Android's circular crop needs.

### Screenshots

```bash
node scripts/shoot.mjs shots
```

Captures every page at desktop and phone widths using the system Chrome.

---

## Notes

- Storage sizes use binary units with conventional labels (TB = TiB), matching what Sonarr, Radarr
  and most NAS interfaces report.
- Library size is smaller than disk usage — it counts media files only. The difference is
  downloads, artwork, subtitles and everything else sharing the mount.
- The runway projection is a linear least-squares fit and says so: it stays marked as unreliable
  until there are several days of history behind it.
