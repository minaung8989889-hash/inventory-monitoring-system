const DASHBOARD_REFRESH_SECONDS = 15;
let dashboardCountdown = DASHBOARD_REFRESH_SECONDS;
let dashboardCountdownTimer = null;

function buildCountdownCard() {
    return `
        <div class="summary-card countdown-card">
            <div class="summary-card-title">Recent conversion</div>
            <div class="summary-card-value"><span id="conversionCountdownValue">${dashboardCountdown}</span>s</div>
            <div class="summary-card-meta">Live refresh in <span id="conversionCountdownMeta">${dashboardCountdown}</span> seconds</div>
        </div>
    `;
}

function updateCountdownDisplay(value) {
    const valueElement = document.getElementById('conversionCountdownValue');
    const metaElement = document.getElementById('conversionCountdownMeta');
    if (valueElement) {
        valueElement.textContent = value;
    }
    if (metaElement) {
        metaElement.textContent = value;
    }
}

function startDashboardCountdown(refreshFn) {
    if (dashboardCountdownTimer) {
        clearInterval(dashboardCountdownTimer);
    }
    dashboardCountdown = DASHBOARD_REFRESH_SECONDS;
    updateCountdownDisplay(dashboardCountdown);

    dashboardCountdownTimer = setInterval(async () => {
        dashboardCountdown -= 1;
        if (dashboardCountdown <= 0) {
            await refreshFn();
            dashboardCountdown = DASHBOARD_REFRESH_SECONDS;
        }
        updateCountdownDisplay(dashboardCountdown);
    }, 1000);
}

async function renderDashboard() {
    const profile = await loadProfile();
    if (!profile) return;

    document.getElementById('dashboardUsername').textContent = profile.username;
    document.getElementById('dashboardRole').textContent = profile.role;

    async function refreshDashboard() {
        const response = await secureFetch('/api/tanks');
        if (!response.ok) {
            document.getElementById('dashboardContent').innerHTML = '<div class="empty-state">Unable to load dashboard data.</div>';
            return;
        }
        const tanks = await response.json();
        if (!Array.isArray(tanks) || tanks.length === 0) {
            document.getElementById('dashboardContent').innerHTML = '<div class="empty-state">No live tank readings available.</div>';
            return;
        }

        const cards = tanks.map((tank) => {
            const level = Number(tank.level) || 0;
            const temp = Number(tank.temperature);
            return `
                <div class="summary-card">
                    <div class="summary-card-title">${tank.tank || tank.name || 'Tank'}</div>
                    <div class="summary-card-value">${level}%</div>
                    <div class="summary-card-meta">Temp: ${Number.isFinite(temp) ? `${temp.toFixed(1)}°C` : 'N/A'}</div>
                </div>
            `;
        }).join('');

        document.getElementById('dashboardContent').innerHTML = `
            <div class="summary-grid">
                ${buildCountdownCard()}
                ${cards}
            </div>
        `;
    }

    await refreshDashboard();
    startDashboardCountdown(refreshDashboard);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('logoutLink')?.addEventListener('click', (event) => {
        event.preventDefault();
        logoutAndRedirect();
    });
    renderDashboard();
});
