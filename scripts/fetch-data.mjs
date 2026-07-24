// For every device listed in devices.json, resolves its internal device ID from
// its public fingerprint, then pulls temperature/humidity history from
// hello.nrfcloud.com's public device API (LwM2M object 14205 "Environment":
// resource 0 = temperature °C, resource 1 = humidity %, resource 99 = timestamp).
// No API key needed — the fingerprint is the device's public, shareable QR code.
//
// Merges into data/<device.id>/history.jsonl (deduped, pruned to RETAIN_MS) and
// regenerates the downsampled data/<device.id>/24h.json, 2w.json, 3m.json files
// the frontend reads. Also writes data/<device.id>/status.json with the most
// recent battery state of charge (LwM2M object 14202 "Battery and Power") and
// the latest temperature/humidity reading.
//
// history.jsonl keeps the raw readings; the range files and the latest values in
// status.json have isolated spikes removed (see outlierTimestamps) so a device
// being handled or moved to charge doesn't distort the graphs' scaling.
//
// The API only serves ~30 days per request (timeSpan=lastMonth), so the 3-month
// view fills in gradually as this workflow keeps running over time.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const API_BASE = "https://api.hello.nordicsemi.cloud/2024-04-17";
const ENVIRONMENT_OBJECT_ID = 14205;
const BATTERY_OBJECT_ID = 14202;

const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const DEVICES_FILE = path.join(ROOT_DIR, "devices.json");
const DATA_DIR = path.join(ROOT_DIR, "data");

// Fetch both: lastMonth for broad coverage, lastDay for the finest recent resolution.
const TIME_SPANS = ["lastMonth", "lastDay"];
const RETAIN_MS = 100 * 24 * 60 * 60 * 1000; // a bit over 3 months, bounds repo growth
const RANGES = {
  "24h.json": 24 * 60 * 60 * 1000,
  "2w.json": 14 * 24 * 60 * 60 * 1000,
  "3m.json": 90 * 24 * 60 * 60 * 1000,
};
const MAX_POINTS_PER_SERIES = 1500;

// Outlier rejection (Hampel filter). A reading is treated as an isolated spike
// only if it deviates from the median of its local window by more than both a
// robust-sigma threshold AND an absolute floor. The floor stops low-noise data
// from over-flagging normal wiggles; the values are physically generous (a real
// room won't jump this far from its local trend in one sample), so only handling
// artifacts get removed while sustained real changes are kept.
const OUTLIER_WINDOW = 7; // neighbours on each side
const OUTLIER_NSIGMA = 4;
const OUTLIER_MIN_DEVIATION = { TEMP: 4, HUMID: 10 }; // °C, %RH

async function resolveDeviceId(fingerprint) {
  const url = new URL(`${API_BASE}/device`);
  url.searchParams.set("fingerprint", fingerprint);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`device lookup for ${fingerprint} failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.id;
}

async function fetchObjectHistory(objectId, deviceId, fingerprint, timeSpan) {
  const url = new URL(`${API_BASE}/device/${deviceId}/history/${objectId}/0`);
  url.searchParams.set("fingerprint", fingerprint);
  url.searchParams.set("timeSpan", timeSpan);

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`history(${objectId}, ${timeSpan}) for ${deviceId} failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.partialInstances ?? [];
}

async function readHistory(historyFile) {
  try {
    const text = await readFile(historyFile, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function median(values) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Returns the set of timestamps whose reading is an isolated spike for the given
// series, per the Hampel + absolute-floor rule described above.
function outlierTimestamps(readings, minDeviation) {
  const sorted = [...readings].sort((a, b) => a.ts - b.ts);
  const values = sorted.map((r) => r.value);
  const bad = new Set();
  for (let i = 0; i < values.length; i++) {
    const window = values.slice(Math.max(0, i - OUTLIER_WINDOW), i + OUTLIER_WINDOW + 1);
    const med = median(window);
    const sigma = 1.4826 * median(window.map((v) => Math.abs(v - med)));
    const deviation = Math.abs(values[i] - med);
    if (deviation > minDeviation && (sigma === 0 || deviation > OUTLIER_NSIGMA * sigma)) {
      bad.add(sorted[i].ts);
    }
  }
  return bad;
}

function bucketDownsample(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const bucketMs = (points[points.length - 1].t - points[0].t) / maxPoints;
  const buckets = [];
  let bucketStart = points[0].t;
  let sum = 0;
  let count = 0;
  for (const p of points) {
    if (p.t - bucketStart > bucketMs && count > 0) {
      buckets.push({ t: bucketStart, v: Math.round((sum / count) * 10) / 10 });
      bucketStart = p.t;
      sum = 0;
      count = 0;
    }
    sum += p.v;
    count += 1;
  }
  if (count > 0) buckets.push({ t: bucketStart, v: Math.round((sum / count) * 10) / 10 });
  return buckets;
}

async function processDevice(device, nowMs) {
  const deviceDir = path.join(DATA_DIR, device.id);
  await mkdir(deviceDir, { recursive: true });
  const historyFile = path.join(deviceDir, "history.jsonl");

  const deviceId = await resolveDeviceId(device.fingerprint);

  const existing = await readHistory(historyFile);
  const merged = new Map(existing.map((r) => [`${r.type}:${r.ts}`, r]));

  for (const timeSpan of TIME_SPANS) {
    const instances = await fetchObjectHistory(ENVIRONMENT_OBJECT_ID, deviceId, device.fingerprint, timeSpan);
    for (const instance of instances) {
      const ts = Number(instance["99"]) * 1000;
      if (!Number.isFinite(ts)) continue;
      const temperature = Number(instance["0"]);
      const humidity = Number(instance["1"]);
      if (Number.isFinite(temperature)) merged.set(`TEMP:${ts}`, { ts, type: "TEMP", value: temperature });
      if (Number.isFinite(humidity)) merged.set(`HUMID:${ts}`, { ts, type: "HUMID", value: humidity });
    }
  }

  const cutoff = nowMs - RETAIN_MS;
  const pruned = [...merged.values()]
    .filter((r) => r.ts >= cutoff)
    .sort((a, b) => a.ts - b.ts);

  // history.jsonl keeps every raw reading.
  await writeFile(historyFile, pruned.map((r) => JSON.stringify(r)).join("\n") + "\n");

  // Temperature and humidity share a timestamp (same LwM2M reading), and handling
  // a device corrupts both at once, so drop every reading at any timestamp flagged
  // as a spike in either series. Everything downstream uses this cleaned view.
  const badTimestamps = new Set();
  for (const type of ["TEMP", "HUMID"]) {
    const readings = pruned.filter((r) => r.type === type);
    for (const ts of outlierTimestamps(readings, OUTLIER_MIN_DEVIATION[type])) {
      badTimestamps.add(ts);
    }
  }
  const clean = pruned.filter((r) => !badTimestamps.has(r.ts));

  for (const [file, rangeMs] of Object.entries(RANGES)) {
    const windowStart = nowMs - rangeMs;
    const inWindow = clean.filter((r) => r.ts >= windowStart);
    const series = (type) =>
      bucketDownsample(
        inWindow.filter((r) => r.type === type).map((r) => ({ t: r.ts, v: r.value })),
        MAX_POINTS_PER_SERIES,
      );
    await writeFile(
      path.join(deviceDir, file),
      JSON.stringify(
        {
          updatedAt: new Date(nowMs).toISOString(),
          temperature: series("TEMP"),
          humidity: series("HUMID"),
        },
        null,
        2,
      ),
    );
  }

  const batteryInstances = await fetchObjectHistory(BATTERY_OBJECT_ID, deviceId, device.fingerprint, "lastDay");
  const latestBattery = batteryInstances.reduce(
    (latest, instance) => (Number(instance["99"]) > (latest?.["99"] ?? -Infinity) ? instance : latest),
    null,
  );
  const latestReading = (type) => clean.filter((r) => r.type === type).at(-1) ?? null;
  const latestTemp = latestReading("TEMP");
  const latestHumid = latestReading("HUMID");
  await writeFile(
    path.join(deviceDir, "status.json"),
    JSON.stringify(
      {
        updatedAt: new Date(nowMs).toISOString(),
        reportedAt: latestBattery ? new Date(Number(latestBattery["99"]) * 1000).toISOString() : null,
        stateOfCharge: latestBattery ? Number(latestBattery["0"]) : null,
        batteryVoltage: latestBattery ? Number(latestBattery["1"]) : null,
        temperature: latestTemp ? latestTemp.value : null,
        humidity: latestHumid ? latestHumid.value : null,
        environmentReportedAt: latestTemp ? new Date(latestTemp.ts).toISOString() : null,
      },
      null,
      2,
    ),
  );

  console.log(
    `[${device.id}] history ${pruned.length} points, ${badTimestamps.size} spike timestamp(s) removed from graphs.`,
  );
}

async function main() {
  const devices = JSON.parse(await readFile(DEVICES_FILE, "utf8"));
  const nowMs = Date.now();
  for (const device of devices) {
    await processDevice(device, nowMs);
  }
}

await main();
