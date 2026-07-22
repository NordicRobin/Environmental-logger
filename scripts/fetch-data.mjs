// Pulls temperature/humidity history from hello.nrfcloud.com's public device API
// (LwM2M object 14205 "Environment": resource 0 = temperature °C, resource 1 =
// humidity %, resource 99 = timestamp) using just the device's public fingerprint —
// no API key needed. Merges into data/history.jsonl (deduped, pruned to RETAIN_MS)
// and regenerates the downsampled data/24h.json, data/2w.json, data/3m.json files
// the frontend reads.
//
// The API only serves ~30 days per request (timeSpan=lastMonth), so the 3-month
// view fills in gradually as this workflow keeps running over time.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const API_BASE = "https://api.hello.nordicsemi.cloud/2024-04-17";
const DEVICE_ID = process.env.HELLO_NRFCLOUD_DEVICE_ID;
const FINGERPRINT = process.env.HELLO_NRFCLOUD_FINGERPRINT;
const ENVIRONMENT_OBJECT_ID = 14205;

if (!DEVICE_ID || !FINGERPRINT) {
  throw new Error("HELLO_NRFCLOUD_DEVICE_ID and HELLO_NRFCLOUD_FINGERPRINT must be set");
}

const DATA_DIR = path.resolve(import.meta.dirname, "../data");
const HISTORY_FILE = path.join(DATA_DIR, "history.jsonl");

// Fetch both: lastMonth for broad coverage, lastDay for the finest recent resolution.
const TIME_SPANS = ["lastMonth", "lastDay"];
const RETAIN_MS = 100 * 24 * 60 * 60 * 1000; // a bit over 3 months, bounds repo growth
const RANGES = {
  "24h.json": 24 * 60 * 60 * 1000,
  "2w.json": 14 * 24 * 60 * 60 * 1000,
  "3m.json": 90 * 24 * 60 * 60 * 1000,
};
const MAX_POINTS_PER_SERIES = 1500;

async function fetchEnvironmentHistory(timeSpan) {
  const url = new URL(`${API_BASE}/device/${DEVICE_ID}/history/${ENVIRONMENT_OBJECT_ID}/0`);
  url.searchParams.set("fingerprint", FINGERPRINT);
  url.searchParams.set("timeSpan", timeSpan);

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`history(${timeSpan}) failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.partialInstances ?? [];
}

async function readHistory() {
  try {
    const text = await readFile(HISTORY_FILE, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
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

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const nowMs = Date.now();
  const existing = await readHistory();
  const merged = new Map(existing.map((r) => [`${r.type}:${r.ts}`, r]));

  for (const timeSpan of TIME_SPANS) {
    const instances = await fetchEnvironmentHistory(timeSpan);
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

  await writeFile(HISTORY_FILE, pruned.map((r) => JSON.stringify(r)).join("\n") + "\n");

  for (const [file, rangeMs] of Object.entries(RANGES)) {
    const windowStart = nowMs - rangeMs;
    const inWindow = pruned.filter((r) => r.ts >= windowStart);
    const series = (type) =>
      bucketDownsample(
        inWindow.filter((r) => r.type === type).map((r) => ({ t: r.ts, v: r.value })),
        MAX_POINTS_PER_SERIES,
      );
    await writeFile(
      path.join(DATA_DIR, file),
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

  console.log(`History now has ${pruned.length} points, refreshed ${Object.keys(RANGES).length} range files.`);
}

await main();
