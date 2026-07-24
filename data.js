const RANGE_FILES = {
  "24h": "24h.json",
  "2w": "2w.json",
  "3m": "3m.json",
};

const RANGE_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "2w": 14 * 24 * 60 * 60 * 1000,
  "3m": 90 * 24 * 60 * 60 * 1000,
};

export async function getDevices() {
  const res = await fetch(`devices.json?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function getStatus(deviceId) {
  try {
    const res = await fetch(`data/${deviceId}/status.json?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  } catch (err) {
    console.warn(`No status available for ${deviceId}:`, err.message);
    return null;
  }
}

function demoSeries(startMs, endMs, points, base, amplitude, min, max) {
  const step = (endMs - startMs) / points;
  const series = [];
  let value = base;
  for (let i = 0; i <= points; i++) {
    value += (Math.random() - 0.5) * amplitude;
    value = Math.max(min, Math.min(max, value));
    series.push({ t: startMs + i * step, v: Math.round(value * 10) / 10 });
  }
  return series;
}

function demoReadings(rangeKey) {
  const endMs = Date.now();
  const startMs = endMs - RANGE_MS[rangeKey];
  return {
    temperature: demoSeries(startMs, endMs, 200, 21, 0.4, 15, 30),
    humidity: demoSeries(startMs, endMs, 200, 45, 1.5, 20, 70),
    bounds: { temperature: null, humidity: null },
    isDemo: true,
  };
}

export async function getReadings(deviceId, rangeKey) {
  try {
    const res = await fetch(`data/${deviceId}/${RANGE_FILES[rangeKey]}?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const body = await res.json();
    return {
      temperature: body.temperature ?? [],
      humidity: body.humidity ?? [],
      bounds: body.bounds ?? { temperature: null, humidity: null },
      updatedAt: body.updatedAt,
      isDemo: false,
    };
  } catch (err) {
    console.warn("Falling back to demo data:", err.message);
    return demoReadings(rangeKey);
  }
}
