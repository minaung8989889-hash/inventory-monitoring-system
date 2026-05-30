const USER_ROLES = ['viewer', 'auditor', 'operator', 'master', 'administrator'];
let loadedUsers = [];

function formatLastSeen(lastSeenValue) {
    if (!lastSeenValue) return 'Never';
    const dt = new Date(lastSeenValue);
    if (Number.isNaN(dt.getTime())) return 'Invalid';
    return dt.toLocaleString();
}

function buildUserCard(user) {
    return `
        <div class="user-row">
            <div class="user-info">
                <div class="user-identity">
                    <strong>${user.username}</strong>
                    <small>${user.email || 'No email provided'}</small>
                </div>
                <div class="user-meta">
                    <span class="badge badge-role">${user.role}</span>
                    <span class="badge ${user.disabled ? 'badge-disabled' : user.approved ? 'badge-approved' : 'badge-pending'}">${user.disabled ? 'Disabled' : user.approved ? 'Approved' : 'Pending'}</span>
                </div>
                <div class="user-last-seen">Last seen: ${formatLastSeen(user.last_seen)}</div>
                <div class="user-token-row">
                    <span class="badge ${user.has_api_token ? 'badge-approved' : 'badge-pending'}">${user.has_api_token ? 'API token active' : 'No API token'}</span>
                    ${user.api_token_created_at ? `<small>Issued: ${formatLastSeen(user.api_token_created_at)}</small>` : ''}
                </div>
            </div>
            <div class="user-actions">
                <label class="field-label">Role</label>
                <select class="role-select" data-user="${user.username}">
                    ${USER_ROLES.map((role) => `<option value="${role}" ${user.role === role ? 'selected' : ''}>${role}</option>`).join('')}
                </select>
                <button class="button button-secondary save-role-button" data-user="${user.username}">Save</button>
                <button class="button button-secondary approve-user-button" data-user="${user.username}" data-approved="${!user.approved}">${user.approved ? 'Revoke' : 'Approve'}</button>
                <button class="button button-danger disable-user-button" data-user="${user.username}" data-disabled="${!user.disabled}">${user.disabled ? 'Enable' : 'Disable'}</button>
                <button class="button button-secondary token-create-button" data-user="${user.username}">${user.has_api_token ? 'Regenerate token' : 'Generate token'}</button>
                ${user.has_api_token ? `<button class="button button-secondary token-revoke-button" data-user="${user.username}">Revoke token</button>` : ''}
            </div>
        </div>
    `;
}

function renderUsers(users) {
    const container = document.getElementById('userManagementContent');
    const countBadge = document.getElementById('userCountBadge');
    if (!Array.isArray(users) || !users.length) {
        container.innerHTML = '<div class="empty-state">No users found.</div>';
        countBadge.textContent = '0 users';
        return;
    }
    countBadge.textContent = `${users.length} user${users.length === 1 ? '' : 's'}`;
    container.innerHTML = users.map(buildUserCard).join('');
    attachUserActionHandlers();
}

function attachUserActionHandlers() {
    document.querySelectorAll('.save-role-button').forEach((button) => {
        button.addEventListener('click', async () => {
            const username = button.dataset.user;
            const select = document.querySelector(`select[data-user="${username}"]`);
            if (!select) return;
            const changed = await updateUserRole(username, select.value);
            if (changed) loadUserList();
        });
    });

    document.querySelectorAll('.approve-user-button').forEach((button) => {
        button.addEventListener('click', async () => {
            const username = button.dataset.user;
            const approved = button.dataset.approved === 'true';
            const changed = await approveUser(username, approved);
            if (changed) loadUserList();
        });
    });

    document.querySelectorAll('.disable-user-button').forEach((button) => {
        button.addEventListener('click', async () => {
            const username = button.dataset.user;
            const disabled = button.dataset.disabled === 'true';
            const changed = await disableUser(username, disabled);
            if (changed) loadUserList();
        });
    });

    document.querySelectorAll('.token-create-button').forEach((button) => {
        button.addEventListener('click', async () => {
            const username = button.dataset.user;
            const result = await createUserToken(username);
            if (result) {
                alert('API token created and copied to clipboard. Share it securely.');
                loadUserList();
            }
        });
    });

    document.querySelectorAll('.token-revoke-button').forEach((button) => {
        button.addEventListener('click', async () => {
            const username = button.dataset.user;
            const confirmed = window.confirm(`Revoke API token for ${username}?`);
            if (!confirmed) return;
            const changed = await revokeUserToken(username);
            if (changed) loadUserList();
        });
    });
}

async function createUserToken(username) {
    const response = await secureFetch(`/api/users/${encodeURIComponent(username)}/token`, {
        method: 'POST'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        alert(data.message || 'Unable to generate API token.');
        return null;
    }
    if (data.token) {
        await navigator.clipboard.writeText(data.token).catch(() => {
            alert('API token generated, but copy to clipboard failed. Please copy it manually.');
        });
    }
    return data.token;
}

async function revokeUserToken(username) {
    const response = await secureFetch(`/api/users/${encodeURIComponent(username)}/token`, {
        method: 'DELETE'
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        alert(data.message || 'Unable to revoke token.');
        return false;
    }
    alert('API token revoked successfully');
    return true;
}

async function updateUserRole(username, role) {
    const response = await secureFetch(`/api/users/${encodeURIComponent(username)}/role`, {
        method: 'PUT',
        body: {role}
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        alert(data.message || 'Unable to save role change.');
        return false;
    }
    return true;
}

async function approveUser(username, approved) {
    const response = await secureFetch(`/api/users/${encodeURIComponent(username)}/approve`, {
        method: 'PUT',
        body: {approved}
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        alert(data.message || 'Unable to update approval.');
        return false;
    }
    return true;
}

async function disableUser(username, disabled) {
    const response = await secureFetch(`/api/users/${encodeURIComponent(username)}/disable`, {
        method: 'PUT',
        body: {disabled}
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        alert(data.message || 'Unable to update disabled state.');
        return false;
    }
    return true;
}

function filterUsers(query) {
    const lowerQuery = query.trim().toLowerCase();
    if (!lowerQuery) {
        renderUsers(loadedUsers);
        return;
    }
    const filtered = loadedUsers.filter((user) => {
        return user.username.toLowerCase().includes(lowerQuery)
            || (user.email || '').toLowerCase().includes(lowerQuery)
            || user.role.toLowerCase().includes(lowerQuery);
    });
    renderUsers(filtered);
}

async function loadUserList() {
    const response = await secureFetch('/api/users');
    if (!response.ok) {
        document.getElementById('userManagementContent').innerHTML = '<div class="empty-state">Unable to load users.</div>';
        document.getElementById('userCountBadge').textContent = 'Error';
        return;
    }
    loadedUsers = await response.json();
    renderUsers(loadedUsers);
}

async function renderUserManagement() {
    const profile = await loadProfile();
    if (!profile) return;

    document.getElementById('logoutLink')?.addEventListener('click', (event) => {
        event.preventDefault();
        logoutAndRedirect();
    });

    document.getElementById('userSearch')?.addEventListener('input', (event) => {
        filterUsers(event.target.value);
    });

    await loadUserList();
}

document.addEventListener('DOMContentLoaded', renderUserManagement);
