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

**Shorts** — vertical clips cut from the library by the
[shortsCreator](../shortsCreator) pipeline, with the subtitle coverage that made them possible.
Browse and filter every generated clip, play it inline, triage it before uploading, and see why
items that produced nothing were skipped. See [Shorts](#shorts-1) below.

**Control** — safe actions only against your media services: refresh, rescan, search, toggle
monitored, retry a stalled import, trigger a subtitle search, and stop a Plex stream (behind a
confirmation). Nothing in your Plex, Sonarr or Radarr libraries can be deleted, removed or
blocklisted from here.

The one thing that *can* be deleted is a clip the shorts pipeline generated — its `.mp4` and
thumbnail, behind a confirmation. That is scoped deliberately: the deletion runs in the pipeline's
own worker, which refuses to unlink anything outside its configured output directory, so source
media is never a delete target.

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

## Shorts

The [shortsCreator](../shortsCreator) pipeline turns the library into vertical 9:16 clips with
burned-in captions. It runs as a separate Python process; this dashboard is where you look at what
it produced and steer what it does next.

### How they talk

**One SQLite file, no HTTP between them.** The pipeline writes; the dashboard reads, and writes
only to the three tables it owns (`jobs`, `review`, `lab_state`). WAL mode means neither blocks the
other.

```bash
# .env.local — variables for inside the container.
SHORTS_DB_PATH=/app/data/shorts.db     # already a mounted volume
SHORTS_OUTPUT_DIR=/srv/shorts_output   # where the clips live
```

```bash
# .env — read by compose itself, to resolve ${...} in docker-compose.yml.
DASHBOARD_UID=1000                     # id -u
DASHBOARD_GID=1000                     # id -g
```

**Two files, and the split is easy to get wrong.** `env_file:` supplies variables to the running
container. `${...}` substitution in the compose file is resolved by compose *before* the container
exists, and compose reads only your shell and `.env`. Putting `DASHBOARD_UID` in `.env.local`
therefore leaves the container on its default uid.

That failure is asymmetric, which is what makes it confusing: reads keep working, so the dashboard
looks completely healthy, while every write fails with "attempt to write a readonly database" — and
because the viewer heartbeat is a write, the pipeline quietly pauses for good. `/setup` reports
writability separately from readability for exactly this reason.

`SHORTS_OUTPUT_DIR` is not optional if you want playback: the media route refuses to serve any file
outside it.

### What the page shows

- **Clips** — every generated short, filterable by show, category, caption source, series vs
  single, review state and match confidence, searchable across titles and quotes. Click to play
  inline; approve, favourite, reject or delete.
- **Subtitle coverage** — the "do I have subtitles?" answer for the whole library, with a specific
  reason code per failing item. `LOW_COVERAGE_LIKELY_FORCED` is the one worth understanding: a
  forced subtitle track parses perfectly and can carry *more* cues than a healthy one, while
  covering only foreign-language lines. Two fixes are one click away per item — upload a subtitle
  file, or queue it for transcription.
- **Pipeline** — queued and running jobs, run history with skip reasons, and test-suite results.

### Queued, not called

Buttons here insert a row into `jobs`; the pipeline's worker drains the queue. Nothing long-running
executes inside a request handler, and — more importantly — everything queued still passes through
the pipeline's viewer gate.

### It pauses while you're watching

The media box is also the Plex server, so pipeline work must never degrade playback. The dashboard
already knows who is streaming, so it publishes that to `lab_state` and the worker reads it. No
second connection to Plex, no duplicated polling.

The banner at the top of the page says which state it's in — `2 streams active`, `cooling down`,
or `clear to run` — because a queue that deliberately does nothing for an hour is otherwise
indistinguishable from a broken worker.

One subtlety worth knowing: a **stale** heartbeat makes the worker pause, on the grounds that if
the dashboard stopped reporting we don't know who's watching. So when Tautulli isn't configured at
all, the dashboard publishes an explicit "nobody watching" rather than going silent — otherwise an
integration that was simply never set up would pause the pipeline forever.

### Native module

`better-sqlite3` is a native addon. Its prebuilt binaries are glibc-only, so the Alpine image
compiles it from source — which is why the Dockerfile's deps stage installs `python3 make g++`.

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

## Alerts

Tells you when something needs attention instead of waiting to be looked at.
Fires on: a mount crossing 90% (or 80% as a warning), a service going
unreachable, a stalled import, a **pool member filling while the pool still
looks healthy**, and a sensor passing its critical temperature.

Pick a transport — either or both:

```bash
# Phone push. No account: install the ntfy app, subscribe to a topic name only
# you know, and use it here.
ALERT_NTFY_URL=https://ntfy.sh/your-unguessable-topic-name

# Discord: Server Settings -> Integrations -> Webhooks -> New Webhook -> Copy URL
ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Set `DASHBOARD_URL` too — it makes notifications **tappable**, deep-linked to
the page the alert is about:

```bash
DASHBOARD_URL=https://steven-plex.your-tailnet.ts.net
```

Then confirm delivery before you need it — Health page → Alerts → **Send test**.

Discord gets a proper embed rather than a wall of bold text: colour-coded by
severity using the same reserved status palette as the dashboard, a title that
links straight to the relevant page, structured fields for the numbers, and a
timestamp. ntfy gets markdown, a matching priority (critical breaks through Do
Not Disturb; resolved notices don't), and a tap action.

### Why it won't spam you

The collector evaluates every couple of seconds. Naively that would notify
about a full disk roughly 30,000 times a day, so:

- **Edge-triggered** — fires when a condition becomes true, not while it is.
- **Hysteresis** — alerts at 90%, and won't clear until it drops below 87%, so
  a disk sitting on the threshold doesn't flap.
- **Resolve notifications** when a condition clears.
- **Repeat interval** (`ALERT_REPEAT_HOURS`, default 12) for things that stay
  true. An escalation from warning to critical always re-notifies.
- **Startup grace** (`ALERT_STARTUP_GRACE_SECONDS`, default 90) — a half-loaded
  state looks exactly like a total outage. Conditions during the grace are
  neither sent *nor* recorded, so a disk that is already full at boot still
  alerts once the grace ends.
- **Persisted** to `data/alerts.json`, so a restart doesn't re-announce what
  you already know.

`ALERT_MIN_LEVEL=critical` if warnings are too chatty.

---

### What counts as an outage

Only Plex raises an unreachable alert. It's the one service whose absence
anybody notices — if Plex is down nobody can watch anything. Sonarr, Radarr
and Bazarr automate acquisition, which on a rip-based library is a convenience
rather than the service itself, and Tautulli and Glances only observe. A
restart of any of those would have produced an alert that needs no action, and
alerts that need no action are how people learn to ignore alerts.

Everything still shows its real status on the Health page; this governs who
gets woken up. Widen it with `ALERT_SERVICES=plex,sonarr`, or switch it off
with `ALERT_SERVICES=none`. The weekly admin issue uses the same rule, so
"needs attention" means one thing rather than two.


## Signing in

The dashboard is ungated by default. Set `DASHBOARD_PASSWORD` and every page,
plus the action endpoint, requires a session; leave it unset and nothing
changes.

It is one shared password, not accounts — this guards one person's lab on a
tailnet, and every extra concept is one more thing to get wrong. The session
is a signed cookie carrying nothing but its own expiry, so there is no store
to keep and changing the password invalidates every existing session.

The check runs in two places. `proxy.ts` redirects browsers and returns 401 to
API callers, and `/api/action` — the one route with side effects — verifies
again on its own, because Next's guidance is explicitly that the proxy layer
is an optimistic check rather than an authorization boundary.


## Newsletter

A weekly digest in two editions: **viewer** ("new on the server", posters and
titles) and **admin** (the same, plus what it cost in space, what people
watched, and what broke).

Read it at `/newsletter`, and preview exactly what will be mailed —
`/api/newsletter/preview?edition=viewer` renders through the same renderer the
mailer uses, so the preview can't drift from the real thing.

### Configuring mail

The Email settings panel on `/newsletter` edits all of it from the browser and
saves to `data/settings.json` (written `0600`), which beats three container
rebuilds to discover a port was wrong. **A value saved there wins over the
matching environment variable**, and the form labels any field the environment
also defines so the override is visible rather than mysterious.

The password is write-only: no endpoint returns it, not even masked, and
leaving the field blank keeps the stored one. The dashboard has no login, so
keep it on the tailnet now that it holds a credential.

The same settings as environment variables, if you'd rather declare them:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=                      # an App Password, not your login
SMTP_FROM=you@gmail.com

NEWSLETTER_RECIPIENTS=friend@example.com
NEWSLETTER_ADMIN_RECIPIENTS=you@example.com
NEWSLETTER_ENABLED=1
```

**Sending stays off until you turn it on** (the Send weekly toggle, or
`NEWSLETTER_ENABLED=1`). Issues still generate and
archive, so you can read a few first — this is the one feature whose mistakes
land in someone else's inbox. The Delivery panel has a test send that goes to
one address you type, never to the configured lists.

Two things worth knowing about how it's built:

- **The two editions are separated by the data model, not a filter.** The issue
  object has `shared` and `admin` halves and the viewer edition never reads the
  second, so there's no rule anyone has to remember in order to keep disk paths
  out of a friend's email.
- **The email is dark on purpose.** Gmail and Outlook auto-invert a light
  email on a dark phone, and their inversion is a blunt channel flip that
  wrecks poster art. Shipping dark means most clients leave it alone.
- **The masthead is a PNG**, because mail clients render neither a gradient nor
  a web font. Regenerate it with `node scripts/make-banner.mjs`, or just drop
  your own artwork at `public/newsletter/banner.png` — nothing reads the script
  at runtime.
- **Posters are attached, not linked.** The image proxy lives behind Tailscale,
  so a linked poster is a broken image for anyone off the tailnet. They're
  fetched server-side, resized, and embedded — which also means they display
  with Gmail's remote images blocked, the default.

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
