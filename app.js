import { getDevices, getReadings } from "./data.js";

const deviceLabelEl = document.getElementById("device-label");
const deviceButtonsEl = document.getElementById("device-buttons");
const statusEl = document.getElementById("status");
const bannerEl = document.getElementById("demo-banner");
const lastUpdatedEl = document.getElementById("last-updated");
const rangeButtons = [...document.querySelectorAll(".range-buttons button")];

const timeFormatOptions = { hour12: false };

function makeChart(canvasId, label, color) {
  const ctx = document.getElementById(canvasId);
  return new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label,
          data: [],
          borderColor: color,
          backgroundColor: color,
          pointRadius: 0,
          borderWidth: 1.5,
          tension: 0.2,
        },
      ],
    },
    options: {
      animation: false,
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
          ticks: { major: { enabled: true } },
        },
        y: { beginAtZero: false },
      },
      plugins: { legend: { display: false } },
    },
  });
}

const temperatureChart = makeChart("temperature-chart", "Temperature (°C)", "#e07a3f");
const humidityChart = makeChart("humidity-chart", "Humidity (%RH)", "#3f8fe0");

let devices = [];
let activeDevice = null;
let activeRange = "24h";

async function loadReadings() {
  statusEl.textContent = "Loading…";

  const { temperature, humidity, updatedAt, isDemo } = await getReadings(activeDevice.id, activeRange);
  bannerEl.hidden = !isDemo;

  temperatureChart.data.datasets[0].data = temperature.map((p) => ({ x: p.t, y: p.v }));
  humidityChart.data.datasets[0].data = humidity.map((p) => ({ x: p.t, y: p.v }));
  temperatureChart.update();
  humidityChart.update();

  statusEl.textContent = "";
  const stamp = updatedAt ? new Date(updatedAt) : new Date();
  lastUpdatedEl.textContent = `Last updated: ${stamp.toLocaleString(undefined, timeFormatOptions)}`;
}

function renderDeviceLabel() {
  deviceLabelEl.innerHTML = `Device: <a href="https://hello.nrfcloud.com/${activeDevice.fingerprint}" target="_blank" rel="noopener">${activeDevice.fingerprint}</a>`;
}

function renderDeviceButtons() {
  deviceButtonsEl.innerHTML = "";
  if (devices.length <= 1) return;
  for (const device of devices) {
    const btn = document.createElement("button");
    btn.textContent = device.name ?? device.id;
    btn.classList.toggle("active", device.id === activeDevice.id);
    btn.addEventListener("click", () => {
      activeDevice = device;
      [...deviceButtonsEl.children].forEach((b) => b.classList.toggle("active", b === btn));
      renderDeviceLabel();
      loadReadings();
    });
    deviceButtonsEl.appendChild(btn);
  }
}

rangeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    activeRange = btn.dataset.range;
    rangeButtons.forEach((b) => b.classList.toggle("active", b === btn));
    loadReadings();
  });
});

devices = await getDevices();
activeDevice = devices[0];
renderDeviceButtons();
renderDeviceLabel();
loadReadings();

// Refresh the current view periodically so the page stays live for visitors.
setInterval(() => loadReadings(), 5 * 60 * 1000);
