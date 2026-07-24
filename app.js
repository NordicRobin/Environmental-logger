import { getDevices, getReadings, getStatus } from "./data.js";

const deviceLabelEl = document.getElementById("device-label");
const deviceButtonsEl = document.getElementById("device-buttons");
const summaryEl = document.getElementById("latest-summary");
const statusEl = document.getElementById("status");
const bannerEl = document.getElementById("demo-banner");
const lastUpdatedEl = document.getElementById("last-updated");
const rangeButtons = [...document.querySelectorAll(".range-buttons button")];

const timeFormatOptions = { hour12: false };
const DEVICE_COLORS = ["#e07a3f", "#3f8fe0", "#27ae60", "#8e44ad"];
const STALE_AFTER_MS = 3 * 60 * 60 * 1000; // flag a device as possibly offline

function batteryClass(pct) {
  if (pct == null) return "";
  if (pct <= 20) return "low";
  if (pct <= 50) return "mid";
  return "ok";
}

function formatRelativeTime(iso) {
  if (!iso) return "unknown";
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = diffMs / (60 * 60 * 1000);
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function makeChart(canvasId) {
  const ctx = document.getElementById(canvasId);
  return new Chart(ctx, {
    type: "line",
    data: { datasets: [] },
    options: {
      animation: false,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: "time",
          time: {
            tooltipFormat: "yyyy-MM-dd HH:mm",
            displayFormats: {
              hour: "HH:mm",
              day: "MMM d",
              week: "MMM d",
              month: "MMM yyyy",
            },
          },
        },
        y: { beginAtZero: false },
      },
      plugins: { legend: { display: true } },
    },
  });
}

const temperatureChart = makeChart("temperature-chart");
const humidityChart = makeChart("humidity-chart");

function setChartDatasets(chart, datasets) {
  chart.data.datasets = datasets.map(({ label, color, points }) => ({
    label,
    data: points.map((p) => ({ x: p.t, y: p.v })),
    borderColor: color,
    backgroundColor: color,
    pointRadius: 0,
    borderWidth: 1.5,
    tension: 0.2,
  }));
  chart.update();
}

let devices = [];
let statusById = new Map();
let activeView = null; // a device id, or "compare"
let activeRange = "24h";

async function loadReadings() {
  statusEl.textContent = "Loading…";

  const isCompare = activeView === "compare";
  const targets = isCompare ? devices : devices.filter((d) => d.id === activeView);

  const results = await Promise.all(targets.map((d) => getReadings(d.id, activeRange)));
  bannerEl.hidden = !results.some((r) => r.isDemo);

  setChartDatasets(
    temperatureChart,
    targets.map((d, i) => ({ label: d.name ?? d.id, color: DEVICE_COLORS[i % DEVICE_COLORS.length], points: results[i].temperature })),
  );
  setChartDatasets(
    humidityChart,
    targets.map((d, i) => ({ label: d.name ?? d.id, color: DEVICE_COLORS[i % DEVICE_COLORS.length], points: results[i].humidity })),
  );

  statusEl.textContent = "";
  const latestUpdatedAt = results.map((r) => r.updatedAt).filter(Boolean).sort().at(-1);
  const stamp = latestUpdatedAt ? new Date(latestUpdatedAt) : new Date();
  lastUpdatedEl.textContent = `Last updated: ${stamp.toLocaleString(undefined, timeFormatOptions)}`;
}

function renderDeviceLabel() {
  if (activeView === "compare") {
    deviceLabelEl.textContent = `Comparing ${devices.length} devices`;
    return;
  }
  const device = devices.find((d) => d.id === activeView);
  const status = statusById.get(device.id);
  const parts = [`Device: <a href="https://hello.nrfcloud.com/${device.fingerprint}" target="_blank" rel="noopener">${device.fingerprint}</a>`];
  if (status?.stateOfCharge != null) {
    parts.push(`Battery: ${status.stateOfCharge}% (last reading ${formatRelativeTime(status.reportedAt)})`);
  }
  deviceLabelEl.innerHTML = parts.join(" · ");
}

function formatMetric(value) {
  return value == null ? "–" : value.toFixed(1);
}

function renderSummary() {
  summaryEl.innerHTML = "";
  devices.forEach((device, i) => {
    const status = statusById.get(device.id);
    const card = document.createElement("div");
    card.className = "summary-card";
    card.style.borderTopColor = DEVICE_COLORS[i % DEVICE_COLORS.length];
    card.innerHTML = `
      <div class="summary-name">${device.name ?? device.id}</div>
      <div class="summary-readings">
        <span class="reading"><strong>${formatMetric(status?.temperature)}</strong> °C</span>
        <span class="reading"><strong>${formatMetric(status?.humidity)}</strong> %RH</span>
      </div>`;
    summaryEl.appendChild(card);
  });
}

function batteryBadge(deviceId) {
  const status = statusById.get(deviceId);
  if (!status || status.stateOfCharge == null) return "";
  return `<span class="battery ${batteryClass(status.stateOfCharge)}">${status.stateOfCharge}%</span>`;
}

function renderDeviceButtons() {
  deviceButtonsEl.innerHTML = "";
  if (devices.length <= 1) return;

  const select = (id, btn) => {
    activeView = id;
    [...deviceButtonsEl.children].forEach((b) => b.classList.toggle("active", b === btn));
    renderDeviceLabel();
    loadReadings();
  };

  for (const device of devices) {
    const btn = document.createElement("button");
    btn.innerHTML = `${device.name ?? device.id} ${batteryBadge(device.id)}`;
    btn.classList.toggle("active", device.id === activeView);
    btn.addEventListener("click", () => select(device.id, btn));
    deviceButtonsEl.appendChild(btn);
  }

  const compareBtn = document.createElement("button");
  compareBtn.textContent = "Sammenlign";
  compareBtn.classList.toggle("active", activeView === "compare");
  compareBtn.addEventListener("click", () => select("compare", compareBtn));
  deviceButtonsEl.appendChild(compareBtn);
}

rangeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    activeRange = btn.dataset.range;
    rangeButtons.forEach((b) => b.classList.toggle("active", b === btn));
    loadReadings();
  });
});

async function refreshStatuses() {
  statusById = new Map(
    await Promise.all(devices.map(async (d) => [d.id, await getStatus(d.id)])),
  );
  renderSummary();
  renderDeviceButtons();
  renderDeviceLabel();
}

devices = await getDevices();
activeView = devices[0].id;
await refreshStatuses();
loadReadings();

// Refresh the current view periodically so the page stays live for visitors.
setInterval(async () => {
  await refreshStatuses();
  loadReadings();
}, 5 * 60 * 1000);
