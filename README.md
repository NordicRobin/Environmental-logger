# Thingy:91X Dashboard

Static web app showing temperature and humidity logged by a Thingy:91X, over 24 hours, 2 weeks, and 3 months. Hosted for free on GitHub Pages — plain HTML/CSS/JS, no server, no API keys.

## How it works

- A scheduled **GitHub Action** ([.github/workflows/fetch-data.yml](.github/workflows/fetch-data.yml)) runs hourly. It calls hello.nrfcloud.com's public device history API for this device's LwM2M "Environment" object (`14205`: resource `0` = temperature °C, resource `1` = humidity %), using only the device's fingerprint — the same public, shareable code as the QR code on the device. No API key or secret is involved anywhere in this pipeline.
- Each run fetches `timeSpan=lastMonth` (30 days, hourly resolution) and `timeSpan=lastDay` (1 day, 15-minute resolution), merges the readings (deduped by timestamp) into [data/history.jsonl](data/history.jsonl), prunes anything older than ~100 days, and regenerates the downsampled [data/24h.json](data/24h.json), [data/2w.json](data/2w.json), and [data/3m.json](data/3m.json).
- The Action commits those files back to the repo, so the static page just does a plain `fetch()` of whichever range JSON it needs — no live API calls from the browser.
- hello.nrfcloud.com's API only serves up to ~30 days per request, so this repo builds its own longer archive over time by accumulating what each hourly run sees. The 3-month view fills in gradually over the following ~3 months; the 24h and 2-week views are complete from the first run.

This endpoint was found by inspecting hello.nrfcloud.com's own network traffic (it isn't formally documented), so if Nordic changes it, `fetchEnvironmentHistory()` in [scripts/fetch-data.mjs](scripts/fetch-data.mjs) is the one place to update.

Why not use nRF Cloud's official REST API directly? It only supports a single team-wide API key with full account access — unsafe to ship in public client-side JS, and no API key was set up for this project anyway. hello.nrfcloud.com's fingerprint-based API is safe to use here because the fingerprint is designed to be shared (it's the same code on the device's QR sticker), and this whole pipeline only ever calls it server-side from the Action, never from the browser.

## One-time setup

1. Push this repo to GitHub.
2. In Settings → Pages, set Source to "Deploy from a branch", branch `main`, folder `/ (root)`.
3. Run the "Fetch sensor data" workflow once manually (Actions tab → Fetch sensor data → Run workflow) to populate the first batch of data, then it keeps itself fresh hourly.
4. The site publishes at `https://<username>.github.io/<repo>/`.

## Local preview

```
npx serve .
```
