# Thingy:91X Dashboard

Static web app showing temperature and humidity logged by one or more Thingy:91X devices, over 24 hours, 2 weeks, and 3 months. Hosted for free on GitHub Pages — plain HTML/CSS/JS, no server, no API keys.

A summary at the top shows each device's latest temperature and humidity reading (to one decimal). Each device also shows its current battery state of charge and when it last reported in — handy for spotting a device that's gone quiet. With more than one device configured, a "Compare" view overlays every device's temperature/humidity on the same chart.

## How it works

- [devices.json](devices.json) lists each device by a public hello.nrfcloud.com fingerprint (the same code as the device's QR sticker — not a secret). This is the only per-device configuration needed.
- A scheduled **GitHub Action** ([.github/workflows/fetch-data.yml](.github/workflows/fetch-data.yml)) runs hourly. For every device in `devices.json`, it resolves the device's internal ID from its fingerprint, then calls hello.nrfcloud.com's public device history API for that device's LwM2M "Environment" object (`14205`: resource `0` = temperature °C, resource `1` = humidity %) and "Battery and Power" object (`14202`: resource `0` = state of charge %). No API key or secret is involved anywhere in this pipeline.
- Each run fetches `timeSpan=lastMonth` (30 days, hourly resolution) and `timeSpan=lastDay` (1 day, 15-minute resolution) per device, merges the readings (deduped by timestamp) into `data/<device-id>/history.jsonl`, prunes anything older than ~100 days, and regenerates `data/<device-id>/24h.json`, `2w.json`, and `3m.json` (each with the full point series plus per-series `bounds`). The latest non-outlier battery, temperature, and humidity readings are written to `data/<device-id>/status.json`.
- **Outlier handling (scaling only):** handling a device (e.g. picking it up to charge it) produces isolated temperature/humidity spikes that would otherwise blow out the graph scaling. A Hampel filter in the fetch script flags any reading that deviates from its local rolling median by more than both a robust-sigma threshold and an absolute floor (4 °C / 10 %RH); because temperature and humidity share a timestamp and get corrupted together, a spike in either series marks that whole timestamp. **The spikes are not removed** — every reading stays in the range files. The flagged timestamps are only excluded when computing each graph's `bounds`, and the frontend scales the y-axis to those bounds (plus 8% padding), so spikes run off the top/bottom instead of flattening the rest of the data. The "current" value in the summary likewise uses the latest non-outlier reading.
- The Action commits those files back to the repo, so the static page just does a plain `fetch()` of whichever device/range JSON it needs — no live API calls from the browser.
- hello.nrfcloud.com's API only serves up to ~30 days per request, so this repo builds its own longer archive over time by accumulating what each hourly run sees. The 3-month view fills in gradually over the following ~3 months; the 24h and 2-week views are complete from the first run.
- The frontend ([app.js](app.js)) reads `devices.json` and shows a device switcher (plus a "Compare" button) automatically whenever there's more than one device — nothing to change in the UI code when adding more.

This endpoint was found by inspecting hello.nrfcloud.com's own network traffic (it isn't formally documented), so if Nordic changes it, `fetchObjectHistory()`/`resolveDeviceId()` in [scripts/fetch-data.mjs](scripts/fetch-data.mjs) is the one place to update.

Why not use nRF Cloud's official REST API directly? It only supports a single team-wide API key with full account access — unsafe to ship in public client-side JS, and no API key was set up for this project anyway. hello.nrfcloud.com's fingerprint-based API is safe to use here because the fingerprint is designed to be shared, and this whole pipeline only ever calls it server-side from the Action, never from the browser.

## Adding another device

Add an entry to [devices.json](devices.json) with a unique `id`, a display `name`, and the device's hello.nrfcloud.com fingerprint:

```json
{ "id": "device-2", "name": "Thingy:91X — Office", "fingerprint": "abc.def123" }
```

No other setup needed — the next Action run creates its `data/device-2/` files automatically, and it appears as a button in the UI.

## One-time setup

1. Push this repo to GitHub.
2. In Settings → Pages, set Source to "Deploy from a branch", branch `main`, folder `/ (root)`.
3. Run the "Fetch sensor data" workflow once manually (Actions tab → Fetch sensor data → Run workflow) to populate the first batch of data, then it keeps itself fresh hourly.
4. The site publishes at `https://<username>.github.io/<repo>/`.

## Local preview

```
npx serve .
```
