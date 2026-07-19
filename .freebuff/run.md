# Run Doc — MikWeb Customer Portal

## Reproducing uncommitted artifacts

A fresh checkout needs these files to run:

1. **`.env`** — Copy from `.env.example`:
   ```
   cp .env.example .env
   ```
   Replace placeholder values (VITE_CONVEX_URL, MIKWEB_API_URL, MIKWEB_API_TOKEN, etc.) with real ones, or leave them as-is — the app works in test-user mode without a real backend.

2. **`node_modules/`** — Install dependencies:
   ```
   npm install
   ```
   The project ships with a `bun.lock`, but `npm install` works fine (tested on Node 22).

3. **`serve-preview.cjs`** — A lightweight Node.js static server for serving the pre-built `isolate/` directory. This file is checked in (or created by the first run). It serves the already-built assets in `isolate/` with SPA fallback routing.

## Running the server

### Option A: Pre-built static server (recommended for preview)

The `isolate/` directory contains the app pre-built and ready to serve. No build step needed.

```
cd <project-root>
nohup node serve-preview.cjs > .freebuff/preview.log 2>&1 &
```

Opens on **port 4173** → http://localhost:4173

### Option B: Vite dev server

If the Vite dev server does not hang on your platform:
```
npm run dev
```
Opens on port 5173 by default.

**Known issue**: On some macOS Node 22 setups the Vite dev server hangs at startup (rollup native-module resolution bug). If that happens, use Option A instead.

### Option C: Vite build + preview

```
npm run build
npx vite preview --port 4174
```

## Ports

| Service | Default port | Notes |
|---------|-------------|-------|
| Static server (isolate) | 4173 | SPA fallback to index.html |
| Vite dev server | 5173 | Configured with `hmr: false` in `vite.config.ts` |
| Vite preview | 4174 | For production build preview |

## Deploying

To build and update the `isolate/` directory (used for production/preview):

```bash
npm run deploy
# or
bash deploy.sh
```

This runs `npm run build`, then copies the output from `dist/` to `isolate/`.

## Notes

- The app uses a test-user mode (CPF: `12345678900`, password: last 4 digits = `8900`) that bypasses the real MikWeb API — you can interact with the full UI without a backend.
- The Convex backend (`src/convex/`) requires a deployed Convex project to receive HTTP requests. The static preview in Option A uses pre-built mock data for testing.
- HMR is disabled in `vite.config.ts` to avoid React 19 concurrent reconciliation crashes when proxied through Freebuff.
