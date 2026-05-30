const connectionStatus = document.getElementById('connectionStatus');
const lastUpdate = document.getElementById('lastUpdate');
const grid = document.getElementById('tankGrid');
const emptyState = document.getElementById('emptyState');
const settingsToggle = document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
const settingsBody = document.getElementById('settingsBody');
const closeSettings = document.getElementById('closeSettings');
const tankModal = document.getElementById('tankModal');
const closeTankModalBtn = document.getElementById('closeTankModal');
const tankModalContent = document.getElementById('tankModalContent');

let activeCards = {};
const previousLevels = {};
let accessToken = localStorage.getItem('inventoryAccessToken') || '';
let refreshToken = localStorage.getItem('inventoryRefreshToken') || '';
let sessionExpiresAt = Number(localStorage.getItem('inventorySessionExpires') || '0');
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes inactivity timeout
const SESSION_CHECK_MS = 30 * 1000;
let profileData = null;
let twoFactorSetup = null;
let selectedTankName = null;

const ROLE_OPTIONS = [
    {value: 'viewer', label: 'Viewer (1)'},
    {value: 'auditor', label: 'Auditor (2)'},
    {value: 'operator', label: 'Operator (3)'},
    {value: 'master', label: 'Master (4)'}
];

function formatTimestamp(value) {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString();
}

function renderSummary(tanks) {
    const summary = document.getElementById('dashboardSummary');
    if (!summary) return;
    if (!Array.isArray(tanks) || tanks.length === 0) {
        summary.innerHTML = '<div class="summary-message">No live tank readings available yet.</div>';
        return;
    }

    const totals = tanks.length;
    const levels = tanks.map((tank) => Number(tank.level)).filter((value) => Number.isFinite(value));
    const temperatures = tanks.map((tank) => Number(tank.temperature)).filter((value) => Number.isFinite(value));
    const lastUpdated = tanks
        .map((tank) => new Date(tank.timestamp))
        .filter((date) => !Number.isNaN(date.getTime()));

    const avgLevel = levels.length ? Math.round(levels.reduce((sum, value) => sum + value, 0) / levels.length) : 0;
    const maxTemp = temperatures.length ? Math.max(...temperatures) : null;
    const latest = lastUpdated.length ? new Date(Math.max(...lastUpdated.map((date) => date.getTime()))) : null;

    summary.innerHTML = `
        <div class="summary-card">
            <div class="summary-card-title">Tanks Monitored</div>
            <div class="summary-card-value">${totals}</div>
            <div class="summary-card-meta">Active vessel readings in real time</div>
        </div>
        <div class="summary-card">
            <div class="summary-card-title">Average Fill</div>
            <div class="summary-card-value">${avgLevel}%</div>
            <div class="summary-card-meta">Current average tank level</div>
        </div>
        <div class="summary-card">
            <div class="summary-card-title">Highest Temperature</div>
            <div class="summary-card-value">${maxTemp !== null ? `${maxTemp.toFixed(1)}°C` : 'N/A'}</div>
            <div class="summary-card-meta">Maximum measured temperature</div>
        </div>
        <div class="summary-card">
            <div class="summary-card-title">Last Refresh</div>
            <div class="summary-card-value">${latest ? latest.toLocaleTimeString() : '--'}</div>
            <div class="summary-card-meta">Most recent dashboard update</div>
        </div>
    `;
}

function setConnectionStatus(connected) {
    if (!connectionStatus) return;
    connectionStatus.textContent = connected ? 'Live connected' : 'Disconnected';
    connectionStatus.className = connected ? 'status-badge status-connected' : 'status-badge status-disconnected';
}

function setLastUpdate(value) {
    if (!lastUpdate) return;
    lastUpdate.textContent = `Last update: ${value}`;
}

function authHeaders() {
    const headers = {};
    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }
    return headers;
}

function getQrCodeUrl(value) {
    const encoded = encodeURIComponent(value);
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encoded}`;
}

function showLoginOnlyState() {
    grid.innerHTML = '';
    const summary = document.getElementById('dashboardSummary');
    if (summary) {
        summary.innerHTML = '<div class="summary-message">Sign in to unlock the live tank dashboard.</div>';
    }
    emptyState.textContent = 'Please sign in to view tank data and analytics.';
    emptyState.style.display = 'block';
    setConnectionStatus(false);
    setLastUpdate('--');
}

function clearAuth() {
    accessToken = '';
    refreshToken = '';
    sessionExpiresAt = 0;
    profileData = null;
    twoFactorSetup = null;
    localStorage.removeItem('inventoryAccessToken');
    localStorage.removeItem('inventoryRefreshToken');
    localStorage.removeItem('inventorySessionExpires');
}

function updateSessionExpiry() {
    if (!accessToken) {
        return;
    }
    sessionExpiresAt = Date.now() + SESSION_TIMEOUT_MS;
    localStorage.setItem('inventorySessionExpires', sessionExpiresAt.toString());
}

function isSessionExpired() {
    return sessionExpiresAt > 0 && Date.now() > sessionExpiresAt;
}

function enforceSessionTimeout() {
    if (!accessToken || !refreshToken) {
        return;
    }
    if (isSessionExpired()) {
        clearAuth();
        renderSettings();
        showLoginOnlyState();
        alert('Your login session has timed out due to inactivity. Please sign in again.');
    }
}

async function attemptRefreshAccessToken() {
    if (!refreshToken) {
        return false;
    }

    try {
        const response = await fetch('/token/refresh', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({refresh_token: refreshToken})
        });

        if (!response.ok) {
            return false;
        }

        const data = await response.json();
        if (!data.access_token || !data.refresh_token) {
            return false;
        }

        accessToken = data.access_token;
        refreshToken = data.refresh_token;
        localStorage.setItem('inventoryAccessToken', accessToken);
        localStorage.setItem('inventoryRefreshToken', refreshToken);
        updateSessionExpiry();
        return true;
    } catch (error) {
        console.error('Refresh token request failed', error);
        return false;
    }
}

function setLoginError(message) {
    const errorEl = document.getElementById('loginError');
    if (!errorEl) return;
    if (!message) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
        return;
    }
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
}

async function apiFetch(url, options = {}) {
    options.headers = {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(options.headers || {})
    };
    if (options.body && typeof options.body !== 'string') {
        options.body = JSON.stringify(options.body);
    }

    let response = await fetch(url, options);
    if (response.status === 401 && url !== '/login' && url !== '/token/refresh' && url !== '/logout') {
        const refreshed = await attemptRefreshAccessToken();
        if (refreshed) {
            options.headers = {
                'Content-Type': 'application/json',
                ...authHeaders(),
                ...(options.headers || {})
            };
            response = await fetch(url, options);
        }
    }

    if (response.status === 401) {
        clearAuth();
        renderSettings();
        showLoginOnlyState();
    } else {
        updateSessionExpiry();
    }

    return response;
}

function renderCard(tank, trend = 'steady') {
    const rawTankName = tank.tank || tank.name || 'Unknown';
    const tankName = tank.display_name || rawTankName;
    const level = Number(tank.level) || 0;
    const levelPercent = Math.min(Math.max(level, 0), 100);
    const timestamp = formatTimestamp(tank.timestamp);
    const temperature = tank.temperature ?? 'N/A';
    const pressure = tank.pressure ?? 'N/A';
    const volume = tank.volume ?? 'N/A';
    const signalText = Number.isFinite(tank.control_signal_ma) ? `${tank.control_signal_ma.toFixed(1)} mA` : 'N/A';
    const maLow = Number.isFinite(tank.ma_low) ? tank.ma_low : 4.0;
    const maHigh = Number.isFinite(tank.ma_high) ? tank.ma_high : 20.0;
    const levelMin = Number.isFinite(tank.level_min) ? tank.level_min : 0.0;
    const levelMax = Number.isFinite(tank.level_max) ? tank.level_max : 100.0;

    const card = document.createElement('div');
    card.className = `tank-card ${trend}`;
    card.setAttribute('data-tank', rawTankName);
    card.innerHTML = `
        <div class="tank-card-top">
            <div class="tank-visual">
                <div class="tank-liquid ${trend}" style="height: ${levelPercent}%"></div>
            </div>
            <div class="tank-info">
                <div class="tank-title-row">
                    <h2>${tankName}</h2>
                    <span class="tank-badge">${levelPercent}%</span>
                </div>
                <div class="trend-pill ${trend}">${trend === 'rising' ? 'Increasing' : trend === 'falling' ? 'Decreasing' : 'Steady'}</div>
                <div class="tank-level">Current level</div>
                <div class="tank-units">
                    <span>Volume: ${volume} mm</span>
                    <span>Pressure: ${pressure} bar</span>
                    <span>Temp: ${temperature}°C</span>
                    <span class="tank-signal">Signal: ${signalText}</span>
                    <span class="tank-calibration">${maLow}mA @ ${levelMin}% → ${maHigh}mA @ ${levelMax}%</span>
                </div>
            </div>
        </div>
        <div class="tank-card-bottom">
            <p>Updated: ${timestamp}</p>
            <div class="level-bar">
                <div class="level-fill ${trend}" style="width:${levelPercent}%"></div>
            </div>
            <div class="tank-actions">
                <button class="button button-secondary button-sm export-tank-button" type="button">Export XML</button>
            </div>
        </div>
    `;
    const exportButton = card.querySelector('.export-tank-button');
    exportButton?.addEventListener('click', (event) => {
        event.stopPropagation();
        exportTankXml(rawTankName);
    });
    card.addEventListener('click', () => openTankModal(rawTankName));
    return card;
}

function updateTankCard(tank) {
    const tankName = tank.tank || tank.name || 'Unknown';
    const previousLevel = Number.isFinite(previousLevels[tankName]) ? previousLevels[tankName] : undefined;
    const currentLevel = Number.isFinite(Number(tank.level)) ? Number(tank.level) : 0;
    const trend = previousLevel === undefined
        ? 'steady'
        : currentLevel > previousLevel ? 'rising'
        : currentLevel < previousLevel ? 'falling'
        : 'steady';

    previousLevels[tankName] = currentLevel;
    const existing = activeCards[tankName];

    if (existing) {
        const updated = renderCard(tank, trend);
        grid.replaceChild(updated, existing);
        activeCards[tankName] = updated;
    } else {
        const card = renderCard(tank, trend);
        grid.appendChild(card);
        activeCards[tankName] = card;
    }
}

function renderSettings() {
    if (!settingsBody) return;
    if (!profileData) {
        settingsBody.innerHTML = `
            <div class="settings-card auth-card">
                <div class="auth-tabs">
                    <button class="button tab active" id="loginTab">Login</button>
                    <button class="button tab" id="registerTab">Register</button>
                </div>
                <div id="loginPanel">
                    <h3>Sign in</h3>
                    <div class="settings-field">
                        <label for="loginUsername">Username</label>
                        <input id="loginUsername" placeholder="Username">
                    </div>
                    <div class="settings-field">
                        <label for="loginPassword">Password</label>
                        <input type="password" id="loginPassword" placeholder="Password">
                    </div>
                    <div class="settings-field">
                        <label for="loginOtp">2FA Code (if enabled)</label>
                        <input id="loginOtp" placeholder="123456">
                        <div id="login2faNote" class="settings-note"></div>
                    </div>
                    <div id="loginError" class="error-message hidden"></div>
                    <div class="settings-field">
                        <button type="button" class="button button-secondary button-sm" id="forgotPasswordToggle">Forgot password?</button>
                    </div>
                    <div id="forgotPasswordPanel" class="hidden">
                        <div class="settings-field">
                            <label for="resetUsername">Username</label>
                            <input id="resetUsername" placeholder="Username">
                        </div>
                        <div class="settings-field">
                            <label for="resetEmail">Email</label>
                            <input id="resetEmail" placeholder="Email">
                        </div>
                        <div class="settings-field">
                            <label for="resetPassword">New password</label>
                            <input type="password" id="resetPassword" placeholder="New password">
                        </div>
                        <div class="settings-field">
                            <label for="resetConfirmPassword">Confirm new password</label>
                            <input type="password" id="resetConfirmPassword" placeholder="Confirm new password">
                        </div>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;">
                            <button type="button" class="button" id="resetPasswordButton">Reset password</button>
                            <button type="button" class="button button-secondary button-sm" id="cancelResetPassword">Back to login</button>
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <button type="button" class="button" id="loginButton">Sign in</button>
                        <button type="button" class="button button-secondary" id="configure2faNowButton">Configure 2FA now</button>
                    </div>
                </div>
                <div id="registerPanel" class="hidden">
                    <h3>Create account</h3>
                    <div class="settings-field">
                        <label for="registerUsername">Username</label>
                        <input id="registerUsername" placeholder="Username">
                    </div>
                    <div class="settings-field">
                        <label for="registerEmail">Email</label>
                        <input id="registerEmail" placeholder="Email">
                    </div>
                    <div class="settings-field">
                        <label for="registerPassword">Password</label>
                        <input type="password" id="registerPassword" placeholder="Password">
                    </div>
                    <div class="settings-field">
                        <label for="registerConfirmPassword">Confirm Password</label>
                        <input type="password" id="registerConfirmPassword" placeholder="Confirm Password">
                    </div>
                    <div class="settings-field">
                        <label for="registerRole">Requested access level</label>
                        <select id="registerRole">
                            <option value="viewer">Viewer</option>
                            <option value="auditor">Auditor</option>
                            <option value="operator" selected>Operator</option>
                        </select>
                    </div>
                    <button type="button" class="button" id="registerButton">Register</button>
                    <p style="margin-top:12px;color:#475569;font-size:0.95rem;">New accounts require master approval before sign in.</p>
                </div>
            </div>
        `;
        document.getElementById('loginButton')?.addEventListener('click', handleLogin);
        document.getElementById('configure2faNowButton')?.addEventListener('click', handleConfigure2FANow);
        document.getElementById('loginUsername')?.addEventListener('blur', (e) => {
            const v = e.target?.value?.trim();
            if (v) checkUser2FAStatus(v);
        });
        document.getElementById('registerButton')?.addEventListener('click', handleRegister);
        document.getElementById('forgotPasswordToggle')?.addEventListener('click', () => toggleForgotPasswordPanel(true));
        document.getElementById('cancelResetPassword')?.addEventListener('click', () => toggleForgotPasswordPanel(false));
        document.getElementById('resetPasswordButton')?.addEventListener('click', handleForgotPassword);
        document.getElementById('loginTab')?.addEventListener('click', () => switchAuthTab('login'));
        document.getElementById('registerTab')?.addEventListener('click', () => switchAuthTab('register'));
        return;
    }

    const twoFactorStatus = profileData.two_factor_enabled ? 'Enabled' : 'Disabled';
    const email = profileData.email || 'Not provided';
    const roleOptionsHtml = ROLE_OPTIONS.map((option) => `
        <option value="${option.value}" ${option.value === profileData.role ? 'selected' : ''}>${option.label}</option>
    `).join('');

    settingsBody.innerHTML = `
        <div class="settings-card">
            <h3>Profile</h3>
            <p><strong>Username:</strong> ${profileData.username}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Role:</strong> ${profileData.role}</p>
            <div class="settings-field">
                <label for="newPassword">New password</label>
                <input type="password" id="newPassword" placeholder="Leave blank to keep current password">
            </div>
            ${profileData.role === 'master' ? `
            <div class="settings-field">
                <label for="updateRole">Your role</label>
                <select id="updateRole">${roleOptionsHtml}</select>
            </div>
            ` : ''}
            <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;">
                <button class="button" id="saveProfileButton">Save profile</button>
                <button class="button button-secondary" id="logoutButton">Logout</button>
            </div>
        </div>
        <div class="settings-card">
            <h3>Two-factor authentication</h3>
            <p>2FA provides an extra layer of protection for your account using one-time codes.</p>
            <p><strong>Status:</strong> ${twoFactorStatus}</p>
            <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">
                ${profileData.two_factor_enabled ? '<button class="button button-secondary" id="disable2FA">Disable 2FA</button>' : '<button class="button button-secondary" id="setup2FA">Enable 2FA</button>'}
            </div>
        </div>
        ${twoFactorSetup ? `
            <div class="settings-card">
                <h3>Complete 2FA setup</h3>
                <p><strong>Secret key:</strong> <code>${twoFactorSetup.secret}</code></p>
                <p>Scan the QR code into Google Authenticator, Microsoft Authenticator, or another TOTP app.</p>
                <div class="qr-block">
                    <img class="qr-code" src="${getQrCodeUrl(twoFactorSetup.otp_auth_url)}" alt="2FA QR code">
                    <p id="setupTotpCode" class="settings-note"></p>
                </div>
                <p><strong>Authenticator URL:</strong> <a href="${twoFactorSetup.otp_auth_url}" target="_blank" rel="noopener noreferrer">Open in app</a></p>
                <div class="settings-field">
                    <label for="verifyOtp">One-time code</label>
                    <input id="verifyOtp" placeholder="123456">
                </div>
                <button class="button" id="verify2FA">Verify 2FA</button>
            </div>
        ` : ''}
        ${profileData.role === 'master' ? `
            <div class="settings-card">
                <h3>Master user management</h3>
                <p>Approve new accounts and adjust user roles.</p>
                <div id="userListContainer"><p>Loading users...</p></div>
            </div>
        ` : ''}
    `;

    document.getElementById('logoutButton').addEventListener('click', handleLogout);
    document.getElementById('saveProfileButton').addEventListener('click', handleProfileSave);
    const setupButton = document.getElementById('setup2FA');
    if (setupButton) setupButton.addEventListener('click', handle2FASetup);
    const disableButton = document.getElementById('disable2FA');
    if (disableButton) disableButton.addEventListener('click', handle2FADisable);
    const verifyButton = document.getElementById('verify2FA');
    if (verifyButton) verifyButton.addEventListener('click', handle2FAVerify);

    if (profileData.role === 'master') {
        loadUsers();
    }
}

async function loadProfile() {
    if (!accessToken) {
        profileData = null;
        renderSettings();
        showLoginOnlyState();
        return false;
    }
    const response = await apiFetch('/api/profile');
    if (!response.ok) {
        clearAuth();
        renderSettings();
        showLoginOnlyState();
        return false;
    }
    profileData = await response.json();
    renderSettings();
    return true;
}

async function loadUsers() {
    const container = document.getElementById('userListContainer');
    if (!container) return;

    const response = await apiFetch('/api/users');
    if (!response.ok) {
        container.innerHTML = '<p>Unable to load user list.</p>';
        return;
    }

    const users = await response.json();
    if (!Array.isArray(users) || users.length === 0) {
        container.innerHTML = '<p>No users found.</p>';
        return;
    }

    const rows = users.map((user) => {
        const options = ROLE_OPTIONS.map((role) => `
            <option value="${role.value}" ${role.value === user.role ? 'selected' : ''}>${role.label}</option>
        `).join('');
        return `
            <div class="user-row">
                <div class="user-cell"><strong>${user.username}</strong><br><small>${user.email || 'No email'}</small></div>
                <div class="user-cell">
                    <select class="role-select" data-user="${user.username}">${options}</select>
                </div>
                <div class="user-cell">${user.approved ? '<span class="status-badge status-connected">Approved</span>' : '<span class="status-badge status-disconnected">Pending</span>'}</div>
                <div class="user-cell">
                    <button class="button button-secondary save-role-button" data-user="${user.username}">Save</button>
                    <button class="button button-secondary approve-user-button" data-user="${user.username}" data-approved="${!user.approved}">${user.approved ? 'Revoke' : 'Approve'}</button>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="user-table-header">
            <div class="user-cell"><strong>User</strong></div>
            <div class="user-cell"><strong>Role</strong></div>
            <div class="user-cell"><strong>Status</strong></div>
            <div class="user-cell"></div>
        </div>
        ${rows}
    `;

    container.querySelectorAll('.save-role-button').forEach((button) => {
        button.addEventListener('click', async () => {
            const username = button.dataset.user;
            const select = container.querySelector(`select[data-user="${username}"]`);
            if (!select) return;
            await updateUserRole(username, select.value);
        });
    });

    container.querySelectorAll('.approve-user-button').forEach((button) => {
        button.addEventListener('click', async () => {
            const username = button.dataset.user;
            const approved = button.dataset.approved === 'true';
            const roleSelect = container.querySelector(`select[data-user="${username}"]`);
            const role = roleSelect ? roleSelect.value : undefined;
            await approveUser(username, approved, role);
        });
    });
}

async function updateUserRole(username, role) {
    const response = await apiFetch(`/api/users/${encodeURIComponent(username)}/role`, {
        method: 'PUT',
        body: {role}
    });
    if (!response.ok) {
        const data = await response.json();
        alert(data.message || 'Unable to update user role');
        return;
    }
    alert('User role updated');
    await loadUsers();
}

async function approveUser(username, approved, role) {
    const response = await apiFetch(`/api/users/${encodeURIComponent(username)}/approve`, {
        method: 'PUT',
        body: {approved, role}
    });
    if (!response.ok) {
        const data = await response.json();
        alert(data.message || 'Unable to update approval');
        return;
    }
    alert(`User ${approved ? 'approved' : 'revoked'}`);
    await loadUsers();
}

function switchAuthTab(tab) {
    document.getElementById('loginTab')?.classList.toggle('active', tab === 'login');
    document.getElementById('registerTab')?.classList.toggle('active', tab === 'register');
    document.getElementById('loginPanel')?.classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerPanel')?.classList.toggle('hidden', tab !== 'register');
}

async function handleRegister() {
    const username = document.getElementById('registerUsername')?.value?.trim();
    const email = document.getElementById('registerEmail')?.value?.trim();
    const password = document.getElementById('registerPassword')?.value;
    const confirmPassword = document.getElementById('registerConfirmPassword')?.value;
    const role = document.getElementById('registerRole')?.value || 'viewer';

    if (!username || !email || !password || !confirmPassword) {
        alert('Username, email, and password are required.');
        return;
    }
    if (password !== confirmPassword) {
        alert('Passwords do not match.');
        return;
    }

    const response = await fetch('/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, email, password, role})
    });

    const data = await response.json();
    if (!response.ok) {
        alert(data.message || 'Registration failed');
        return;
    }

    alert(data.message || 'Registration complete. Await master approval.');
    document.getElementById('registerUsername').value = '';
    document.getElementById('registerEmail').value = '';
    document.getElementById('registerPassword').value = '';
    document.getElementById('registerConfirmPassword').value = '';
    switchAuthTab('login');
}

async function checkUser2FAStatus(username) {
    const noteEl = document.getElementById('login2faNote');
    if (!noteEl) return;
    try {
        const res = await fetch(`/public/user-2fa-status?username=${encodeURIComponent(username)}`);
        if (!res.ok) {
            noteEl.textContent = '';
            return;
        }
        const data = await res.json();
        if (data && data.two_factor_enabled) {
            noteEl.textContent = 'This account requires a one-time code (2FA). Enter code from your authenticator app.';
        } else {
            noteEl.textContent = '2FA not configured for this account (optional).';
        }
    } catch (e) {
        noteEl.textContent = '';
    }
}

async function handleLogin() {
    console.log('handleLogin triggered');
    const username = document.getElementById('loginUsername')?.value?.trim();
    const password = document.getElementById('loginPassword')?.value?.trim();
    const otp = document.getElementById('loginOtp')?.value?.trim();

    console.log('login payload', { username, passwordPresent: Boolean(password), otpPresent: Boolean(otp) });

    setLoginError('');
    if (!username || !password) {
        setLoginError('Username and password are required.');
        return;
    }

    // pre-clear 2FA note
    const noteEl = document.getElementById('login2faNote');
    if (noteEl) noteEl.textContent = '';

    let response;
    try {
        response = await fetch('/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, password, otp})
        });
    } catch (error) {
        console.error('Login request failed', error);
        setLoginError('Unable to reach login endpoint. Check your network connection.');
        return;
    }

    // If server indicates 2FA is required, surface that to the user and keep OTP field focused
    if (!response.ok) {
        let data = {};
        try { data = await response.json(); } catch (e) {}
        const msg = data.message || 'Login failed';
        // common backend message when OTP is required
        if (msg.toLowerCase().includes('2fa') || msg.toLowerCase().includes('otp') || msg.toLowerCase().includes('code required')) {
            if (noteEl) noteEl.textContent = 'One-time code required for this account. Enter code from your authenticator app.';
            document.getElementById('loginOtp')?.focus();
            setLoginError(msg);
            return;
        }
        setLoginError(msg);
        return;
    }

    const data = await response.json();
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    localStorage.setItem('inventoryAccessToken', accessToken);
    localStorage.setItem('inventoryRefreshToken', refreshToken);
    updateSessionExpiry();
    const loggedIn = await loadProfile();
    if (loggedIn) {
        await loadTankData();
        setupLiveStream();
        closeSettingsPanel();
        setConnectionStatus(true);
        alert('Signed in successfully. Dashboard is now visible.');
    }
}

function toggleForgotPasswordPanel(show) {
    const resetPanel = document.getElementById('forgotPasswordPanel');
    if (!resetPanel) return;
    resetPanel.classList.toggle('hidden', !show);
}

async function handleForgotPassword() {
    const username = document.getElementById('resetUsername')?.value?.trim();
    const email = document.getElementById('resetEmail')?.value?.trim();
    const password = document.getElementById('resetPassword')?.value || '';
    const confirmPassword = document.getElementById('resetConfirmPassword')?.value || '';

    if (!username || !email || !password || !confirmPassword) {
        alert('Username, email, and new password are required.');
        return;
    }
    if (password !== confirmPassword) {
        alert('Passwords do not match.');
        return;
    }
    if (password.length < 8) {
        alert('Password must be at least 8 characters.');
        return;
    }

    const response = await fetch('/forgot-password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, email, password, confirm_password: confirmPassword})
    });

    const data = await response.json();
    if (!response.ok) {
        alert(data.message || 'Unable to reset password.');
        return;
    }

    alert(data.message || 'Password reset successfully. You may now sign in.');
    document.getElementById('resetUsername').value = '';
    document.getElementById('resetEmail').value = '';
    document.getElementById('resetPassword').value = '';
    document.getElementById('resetConfirmPassword').value = '';
    toggleForgotPasswordPanel(false);
}

async function handleProfileSave() {
    const password = document.getElementById('newPassword')?.value?.trim();
    const roleSelect = document.getElementById('updateRole');
    const role = roleSelect ? roleSelect.value : undefined;
    const body = {};

    if (password) {
        if (password.length < 8) {
            alert('Password must be at least 8 characters.');
            return;
        }
        body.password = password;
    }

    if (role && role !== profileData.role) {
        body.role = role;
    }

    if (!Object.keys(body).length) {
        alert('Change your password or role before saving.');
        return;
    }

    const response = await apiFetch('/api/profile', {
        method: 'PUT',
        body
    });

    const data = await response.json();
    if (!response.ok) {
        alert(data.message || 'Unable to save profile.');
        return;
    }

    document.getElementById('newPassword').value = '';
    alert(data.message || 'Profile saved successfully.');
    await loadProfile();
}

async function handleLogout() {
    if (refreshToken) {
        await apiFetch('/logout', {
            method: 'POST',
            body: {refresh_token: refreshToken}
        });
    }
    clearAuth();
    renderSettings();
    showLoginOnlyState();
    window.location.href = '/login';
}

async function handle2FASetup() {
    const response = await apiFetch('/api/profile/2fa/setup', {method: 'POST'});
    if (!response.ok) {
        const data = await response.json();
        alert(data.message || 'Unable to setup 2FA');
        return;
    }
    twoFactorSetup = await response.json();
    renderSettings();
}

async function handle2FAVerify() {
    const otp = document.getElementById('verifyOtp')?.value?.trim();
    if (!otp) {
        alert('Enter the 2FA code from your authenticator app.');
        return;
    }
    const response = await apiFetch('/api/profile/2fa/verify', {
        method: 'POST',
        body: {otp}
    });
    if (!response.ok) {
        const data = await response.json();
        alert(data.message || 'Invalid code');
        return;
    }
    twoFactorSetup = null;
    await loadProfile();
    alert('Two-factor authentication enabled.');
}

async function handleConfigure2FANow() {
    const username = document.getElementById('loginUsername')?.value?.trim();
    const password = document.getElementById('loginPassword')?.value || '';
    if (!username || !password) {
        alert('Username and password are required to configure 2FA.');
        return;
    }

    const loginRes = await fetch('/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, password})
    });
    if (!loginRes.ok) {
        const d = await loginRes.json().catch(() => ({}));
        alert(d.message || 'Unable to sign in.');
        return;
    }
    const loginData = await loginRes.json();
    accessToken = loginData.access_token;
    refreshToken = loginData.refresh_token;
    localStorage.setItem('inventoryAccessToken', accessToken);
    localStorage.setItem('inventoryRefreshToken', refreshToken);
    updateSessionExpiry();

    const res = await apiFetch('/api/profile/2fa/setup', {method: 'POST'});
    if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.message || 'Unable to start 2FA setup.');
        return;
    }
    twoFactorSetup = await res.json();
    await loadProfile();
    openSettings();
    // user should scan the QR with an authenticator app and enter the 6-digit code
}

// Note: we intentionally do not auto-generate or display the TOTP here.
// The user should scan the QR with their authenticator app and enter the 6-digit code.

async function handle2FADisable() {
    const response = await apiFetch('/api/profile/2fa/disable', {method: 'POST'});
    if (!response.ok) {
        const data = await response.json();
        alert(data.message || 'Unable to disable 2FA');
        return;
    }
    await loadProfile();
}

function openSettings() {
    settingsPanel?.classList.remove('hidden');
    renderSettings();
}

function closeSettingsPanel() {
    settingsPanel?.classList.add('hidden');
}

async function openTankModal(tankName) {
    selectedTankName = tankName;
    tankModal?.classList.remove('hidden');
    tankModalContent.innerHTML = `<h2>${tankName}</h2><p>Loading tank history and calibration settings...</p>`;

    const [historyRes, settingsRes] = await Promise.all([
        apiFetch(`/api/tanks/history/${encodeURIComponent(tankName)}?limit=20`),
        apiFetch(`/api/tanks/${encodeURIComponent(tankName)}/settings`)
    ]);

    const historyData = historyRes.ok ? await historyRes.json() : [];
    const settingsData = settingsRes.ok ? await settingsRes.json() : null;
    const displayName = settingsData?.display_name || tankName;
    const maLow = Number.isFinite(settingsData?.ma_low) ? settingsData.ma_low : 4.0;
    const maHigh = Number.isFinite(settingsData?.ma_high) ? settingsData.ma_high : 20.0;
    const levelMin = Number.isFinite(settingsData?.level_min) ? settingsData.level_min : 0.0;
    const levelMax = Number.isFinite(settingsData?.level_max) ? settingsData.level_max : 100.0;
    const signalText = historyData[0] && Number.isFinite(historyData[0].control_signal_ma) ? `${historyData[0].control_signal_ma.toFixed(1)} mA` : 'N/A';

    if (!Array.isArray(historyData) || historyData.length === 0) {
        tankModalContent.innerHTML = `
            <h2>${displayName}</h2>
            <p>No history available.</p>
            <div class="modal-section">
                <h3>4-20 mA calibration</h3>
                <div class="settings-field">
                    <label for="displayNameInput">Display name</label>
                    <input id="displayNameInput" value="${displayName}">
                </div>
                <div class="settings-field">
                    <label for="maLowInput">4 mA level</label>
                    <input id="maLowInput" type="number" step="0.1" value="${maLow}">
                </div>
                <div class="settings-field">
                    <label for="maHighInput">20 mA level</label>
                    <input id="maHighInput" type="number" step="0.1" value="${maHigh}">
                </div>
                <div class="settings-field">
                    <label for="levelMinInput">Minimum percent</label>
                    <input id="levelMinInput" type="number" step="0.1" value="${levelMin}">
                </div>
                <div class="settings-field">
                    <label for="levelMaxInput">Maximum percent</label>
                    <input id="levelMaxInput" type="number" step="0.1" value="${levelMax}">
                </div>
                <div class="settings-field">
                    <label>Current estimated signal</label>
                    <div class="tank-signal">${signalText}</div>
                </div>
                ${profileData && ['operator', 'master'].includes(profileData.role) ? '<button class="button" id="saveCalibrationButton">Save calibration</button><p id="calibrationMessage"></p>' : '<p class="settings-note">Only operator or master users may save calibration settings.</p>'}
            </div>
        `;
    } else {
        const historyHtml = historyData.map(entry => `
            <div class="tank-history-item">
                <p><strong>Time:</strong> ${formatTimestamp(entry.timestamp)}</p>
                <p><strong>Level:</strong> ${entry.level ?? 'N/A'}%</p>
                <p><strong>Temperature:</strong> ${entry.temperature ?? 'N/A'} °C</p>
                <p><strong>Pressure:</strong> ${entry.pressure ?? 'N/A'} bar</p>
                <p><strong>Volume:</strong> ${entry.volume ?? 'N/A'} mm</p>
                <p><strong>Output:</strong> ${Number.isFinite(entry.control_signal_ma) ? `${entry.control_signal_ma.toFixed(1)} mA` : 'N/A'}</p>
            </div>
        `).join('');
        tankModalContent.innerHTML = `
            <h2>${displayName}</h2>
            <div class="tank-history">${historyHtml}</div>
            <div class="modal-section">
                <h3>4-20 mA calibration</h3>
                <div class="settings-field">
                    <label for="displayNameInput">Display name</label>
                    <input id="displayNameInput" value="${displayName}">
                </div>
                <div class="settings-field">
                    <label for="maLowInput">4 mA level</label>
                    <input id="maLowInput" type="number" step="0.1" value="${maLow}">
                </div>
                <div class="settings-field">
                    <label for="maHighInput">20 mA level</label>
                    <input id="maHighInput" type="number" step="0.1" value="${maHigh}">
                </div>
                <div class="settings-field">
                    <label for="levelMinInput">Minimum percent</label>
                    <input id="levelMinInput" type="number" step="0.1" value="${levelMin}">
                </div>
                <div class="settings-field">
                    <label for="levelMaxInput">Maximum percent</label>
                    <input id="levelMaxInput" type="number" step="0.1" value="${levelMax}">
                </div>
                <div class="settings-field">
                    <label>Current estimated signal</label>
                    <div class="tank-signal">${signalText}</div>
                </div>
                ${profileData && ['operator', 'master'].includes(profileData.role) ? '<button class="button" id="saveCalibrationButton">Save calibration</button><p id="calibrationMessage"></p>' : '<p class="settings-note">Only operator or master users may save calibration settings.</p>'}
            </div>
        `;
    }

    document.getElementById('exportXmlButton')?.addEventListener('click', () => exportTankXml(tankName));
    const saveButton = document.getElementById('saveCalibrationButton');
    if (saveButton) {
        saveButton.addEventListener('click', async () => {
            const payload = {
                display_name: document.getElementById('displayNameInput').value.trim(),
                ma_low: Number(document.getElementById('maLowInput').value),
                ma_high: Number(document.getElementById('maHighInput').value),
                level_min: Number(document.getElementById('levelMinInput').value),
                level_max: Number(document.getElementById('levelMaxInput').value)
            };
            const response = await apiFetch(`/api/tanks/${encodeURIComponent(tankName)}/settings`, {
                method: 'PUT',
                body: payload
            });
            const result = await response.json();
            const messageEl = document.getElementById('calibrationMessage');
            if (!response.ok) {
                if (messageEl) messageEl.textContent = result.message || 'Unable to save calibration settings.';
                return;
            }
            if (messageEl) messageEl.textContent = 'Calibration saved successfully.';
            await loadTankData();
        });
    }
}

function setupSessionWatcher() {
    ['click', 'keydown', 'mousemove', 'touchstart'].forEach((eventName) => {
        document.addEventListener(eventName, updateSessionExpiry);
    });
    setInterval(enforceSessionTimeout, SESSION_CHECK_MS);
}

function closeTankModal() {
    tankModal?.classList.add('hidden');
}

async function exportTankXml(tankName) {
    if (!tankName) return;
    const response = await apiFetch(`/api/tanks/${encodeURIComponent(tankName)}/export`);
    if (!response.ok) {
        const data = await response.json();
        alert(data.message || 'Unable to export XML');
        return;
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${tankName.replace(/[^a-z0-9_-]/gi, '_')}-history.xml`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
}

async function loadTankData() {
    if (!accessToken) {
        showLoginOnlyState();
        return;
    }
    try {
        const response = await apiFetch('/api/tanks');
        if (!response.ok) {
            throw new Error('Failed to load tank data');
        }
        const data = await response.json();

        grid.innerHTML = '';
        activeCards = {};

        if (!Array.isArray(data) || data.length === 0) {
            emptyState.textContent = 'No tank data available.';
            emptyState.style.display = 'block';
            setConnectionStatus(true);
            renderSummary([]);
            return;
        }

        emptyState.style.display = 'none';
        data.forEach(tank => updateTankCard(tank));
        renderSummary(data);
        setConnectionStatus(true);
        setLastUpdate(new Date().toLocaleTimeString());
    } catch (error) {
        console.error('Unable to load tank data:', error);
        showLoginOnlyState();
    }
}

function setupLiveStream() {
    if (!window.EventSource || !accessToken) {
        return;
    }

    const source = new EventSource(`/api/tanks/live?access_token=${encodeURIComponent(accessToken)}`);
    source.onopen = () => setConnectionStatus(true);
    source.onerror = () => setConnectionStatus(false);
    source.onmessage = function(event) {
        const tank = JSON.parse(event.data);
        updateTankCard(tank);
        emptyState.style.display = 'none';
        setLastUpdate(new Date().toLocaleTimeString());
    };
}

window.addEventListener('load', async () => {
    if (isSessionExpired()) {
        clearAuth();
    }

    setupSessionWatcher();
    const loggedIn = await loadProfile();
    if (loggedIn) {
        await loadTankData();
        setupLiveStream();
    } else {
        showLoginOnlyState();
    }
    setInterval(loadTankData, 15000);
});

settingsToggle?.addEventListener('click', openSettings);
closeSettings?.addEventListener('click', closeSettingsPanel);
closeTankModalBtn?.addEventListener('click', closeTankModal);

if (settingsBody) {
    settingsBody.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.id === 'loginButton') {
            event.preventDefault();
            handleLogin();
        }
        if (target.id === 'registerButton') {
            event.preventDefault();
            handleRegister();
        }
        if (target.id === 'configure2faNowButton') {
            event.preventDefault();
            handleConfigure2FANow();
        }
        if (target.id === 'resetPasswordButton') {
            event.preventDefault();
            handleForgotPassword();
        }
        if (target.id === 'cancelResetPassword') {
            event.preventDefault();
            toggleForgotPasswordPanel(false);
        }
        if (target.id === 'forgotPasswordToggle') {
            event.preventDefault();
            toggleForgotPasswordPanel(true);
        }
    });

    settingsBody.addEventListener('keydown', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (event.key === 'Enter' && ['loginUsername', 'loginPassword', 'loginOtp'].includes(target.id)) {
            event.preventDefault();
            handleLogin();
        }
    });
}
