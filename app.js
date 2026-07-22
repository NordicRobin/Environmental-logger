import { getReadings } from "./data.js";

const { hello } = window.DASHBOARD_CONFIG ?? {};
if (hello) {
  const link = document.getElementById("device-label");
  link.innerHTML = `Device: <a href="https://hello.nrfcloud.com/${hello}" target="_blank" rel="noopener">${hello}</a>`;
}

const statusEl = document.getElementById("status");
const bannerEl = document.getElementById("demo-banner");
const lastUpdatedEl = document.getElementById("last-updated");
const buttons = [...document.querySelectorAll(".range-buttons button")];

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
          time: { tooltipFormat: "PPpp" },
        },
        y: { beginAtZero: false },
      },
      plugins: { legend: { display: false } },
    },
  });
}

const temperatureChart = makeChart("temperature-chart", "Temperature (°C)", "#e07a3f");
const humidityChart = makeChart("humidity-chart", "Humidity (%RH)", "#3f8fe0");

let activeRange = "24h";

async function loadRange(rangeKey) {
  activeRange = rangeKey;
  statusEl.textContent = "Loading…";

  const { temperature, humidity, updatedAt, isDemo } = await getReadings(rangeKey);
  bannerEl.hidden = !isDemo;

  temperatureChart.data.datasets[0].data = temperature.map((p) => ({ x: p.t, y: p.v }));
  humidityChart.data.datasets[0].data = humidity.map((p) => ({ x: p.t, y: p.v }));
  temperatureChart.update();
  humidityChart.update();

  statusEl.textContent = "";
  const stamp = updatedAt ? new Date(updatedAt) : new Date();
  lastUpdatedEl.textContent = `Last updated: ${stamp.toLocaleString()}`;
}

buttons.forEach((btn) => {
  btn.addEventListener("click", () => {
    buttons.forEach((b) => b.classList.toggle("active", b === btn));
    loadRange(btn.dataset.range);
  });
});

loadRange(activeRange);

// Refresh the current range periodically so the page stays live for visitors.
setInterval(() => loadRange(activeRange), 5 * 60 * 1000);
