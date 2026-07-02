# Ledger — Frontend (Phase 2: Offline-first sync)

This is the browser app: vanilla ES6 modules, IndexedDB as the local
database, and a sync manager that talks to the Worker API from Phase 1.

## What's wired up in this phase

- **IndexedDB layer** (`js/db.js`) — stores for trades, journal entries,
  calendar notes, goals, screenshots, settings, plus a sync queue and a
  small meta key/value store (auth token, current user, sync cursor).
- **Auth** (`js/auth.js`, `login.html`) — register/login/logout against the
  Worker API, session persisted in IndexedDB.
- **Sync engine** (`js/sync.js`) — the client half of the spec: syncs on
  app launch, every 30 seconds, after every save (debounced), and
  immediately on reconnect. Shows 🟢 Synced / 🟡 Syncing / 🔴 Offline in the
  topbar.
- **Local-first repositories** (`js/repositories/`) — every write lands in
  IndexedDB immediately (so the UI never waits on the network) and gets
  queued for the next sync push.
- **Dashboard** (`dashboard.html`) — every number, chart, and table row is
  computed from real local data via `js/stats.js`. No mock data remains.
  Includes a working "Add Trade" form that saves locally and syncs
  automatically.

Not built yet: Trade History, Calendar (full page), Journal, Statistics,
Psychology, Goals, Risk Calculator, and Settings pages — the sidebar links
to them but they're not implemented. Screenshot upload to R2 isn't wired up
either (the metadata table + sync support already exist server-side).

## Running it locally

You need a simple static file server (this is a static multi-page app, no
build step). Any of these work:

```bash
# Option 1: Python (usually pre-installed)
cd frontend
python3 -m http.server 5173

# Option 2: Node
npx serve frontend -p 5173
```

Then open `http://localhost:5173`.

**Before it will work, point it at your Worker:**
Open `js/config.js` and set `API_BASE_URL` to your deployed Worker URL
(or leave it as `http://localhost:8787` if you're running
`wrangler dev` locally at the same time).

**Also set CORS on the Worker side** — if you're serving the frontend from
`http://localhost:5173`, either leave the Worker's `ALLOWED_ORIGIN = "*"`
for local dev, or set it to that exact origin.

## Deploying to Vercel (free)

1. Push this `frontend/` folder to a GitHub repo (or just the whole project
   — Vercel lets you set a root directory).
2. Go to [vercel.com](https://vercel.com), "Add New Project", import the repo.
3. Set **Root Directory** to `frontend`.
4. Framework preset: "Other" (it's static HTML — no build command, no
   output directory override needed).
5. Deploy. Vercel gives you a URL like `https://your-app.vercel.app`.
6. Update `js/config.js`'s `API_BASE_URL` to your Worker's live URL, and
   redeploy (Vercel auto-redeploys on every git push).
7. Go back to the Worker's `wrangler.toml`, set `ALLOWED_ORIGIN` to your
   exact Vercel URL, and run `npm run deploy` again in `worker/`.

## Trying the sync engine yourself

1. Register an account, add a trade.
2. Open dev tools → Network tab → set to "Offline". Add another trade —
   notice it saves instantly and the status dot turns 🔴.
3. Turn the network back on — within a second or two it syncs automatically
   and turns 🟢.
4. Open the app in an incognito window (or another browser), log in with
   the same account — your trades appear after the first sync pull.

## Next phase

The MT5 Expert Advisor + bridge service, which will push trades into this
same backend via `POST /api/trades/bulk-import` using an account's
`sync_token` — everything already dedupes correctly on the server side for
exactly this.
