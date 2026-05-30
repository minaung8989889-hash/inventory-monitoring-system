function getAuthHeaders() {
    const token = localStorage.getItem('inventoryAccessToken') || '';
    return token ? {'Authorization': `Bearer ${token}`} : {};
}

function clearAuthState() {
    localStorage.removeItem('inventoryAccessToken');
    localStorage.removeItem('inventoryRefreshToken');
}

function getPageNoticeContainer() {
    let notice = document.getElementById('pageNotice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'pageNotice';
        notice.className = 'page-notice hidden';
        const pageMain = document.querySelector('.page-main') || document.body;
        pageMain.insertBefore(notice, pageMain.firstChild);
    }
    return notice;
}

function showPageNotice(message, type = 'error') {
    const notice = getPageNoticeContainer();
    notice.textContent = message;
    notice.className = `page-notice page-notice-${type}`;
}

function clearPageNotice() {
    const notice = document.getElementById('pageNotice');
    if (notice) {
        notice.className = 'page-notice hidden';
        notice.textContent = '';
    }
}

async function secureFetch(url, options = {}) {
    options.headers = {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...(options.headers || {})
    };
    if (options.body && typeof options.body !== 'string') {
        options.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, options);
    if (response.status === 401) {
        clearAuthState();
        showPageNotice('Session expired or token missing. Redirecting to login...', 'error');
        window.setTimeout(() => {
            window.location.href = '/login';
        }, 1100);
        return response;
    }
    if (response.status === 403) {
        showPageNotice('You do not have permission to perform this action.', 'warning');
    }
    return response;
}

async function postJson(url, body = {}) {
    return secureFetch(url, {
        method: 'POST',
        body
    });
}

async function loadProfile() {
    const response = await secureFetch('/api/profile');
    if (!response.ok) {
        return null;
    }
    return response.json();
}

async function logoutAndRedirect() {
    const refreshToken = localStorage.getItem('inventoryRefreshToken');
    const ok = window.confirm('Are you sure you want to log out?');
    if (!ok) return;
    if (refreshToken) {
        await secureFetch('/logout', {
            method: 'POST',
            body: {refresh_token: refreshToken}
        });
    }
    localStorage.removeItem('inventoryAccessToken');
    localStorage.removeItem('inventoryRefreshToken');
    window.location.href = '/login';
}
