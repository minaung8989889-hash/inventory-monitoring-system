function setAuthError(elementId, message) {
    const errorEl = document.getElementById(elementId);
    if (!errorEl) return;
    if (!message) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
        return;
    }
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
}

async function postJson(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    return {response, data};
}

function showForgotPasswordPanel(show) {
    const panel = document.getElementById('forgotPasswordPanel');
    if (!panel) return;
    panel.classList.toggle('hidden', !show);
}

async function handleLoginPage() {
    setAuthError('loginError', '');
    const username = document.getElementById('loginUsername')?.value?.trim();
    const password = document.getElementById('loginPassword')?.value || '';
    const otp = document.getElementById('loginOtp')?.value?.trim();

    if (!username || !password) {
        setAuthError('loginError', 'Username and password are required.');
        return;
    }

    const {response, data} = await postJson('/login', {username, password, otp});
    if (!response.ok) {
        setAuthError('loginError', data.message || 'Login failed.');
        return;
    }

    localStorage.setItem('inventoryAccessToken', data.access_token);
    localStorage.setItem('inventoryRefreshToken', data.refresh_token);
    window.location.href = '/dashboard';
}

async function handleRegisterPage() {
    setAuthError('registerError', '');
    const username = document.getElementById('registerUsername')?.value?.trim();
    const email = document.getElementById('registerEmail')?.value?.trim();
    const password = document.getElementById('registerPassword')?.value || '';
    const confirmPassword = document.getElementById('registerConfirmPassword')?.value || '';
    const role = document.getElementById('registerRole')?.value || 'viewer';

    if (!username || !email || !password || !confirmPassword) {
        setAuthError('registerError', 'Username, email, and password are required.');
        return;
    }
    if (password !== confirmPassword) {
        setAuthError('registerError', 'Passwords do not match.');
        return;
    }

    const {response, data} = await postJson('/register', {username, email, password, role});
    if (!response.ok) {
        setAuthError('registerError', data.message || 'Registration failed.');
        return;
    }

    alert(data.message || 'Registration complete. Please sign in.');
    window.location.href = '/login';
}

async function handleForgotPasswordPage() {
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

    const {response, data} = await postJson('/forgot-password', {
        username,
        email,
        password,
        confirm_password: confirmPassword
    });

    if (!response.ok) {
        alert(data.message || 'Unable to reset password.');
        return;
    }

    alert(data.message || 'Password reset successfully. Please sign in.');
    showForgotPasswordPanel(false);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loginButton')?.addEventListener('click', handleLoginPage);
    document.getElementById('registerButton')?.addEventListener('click', handleRegisterPage);
    document.getElementById('forgotPasswordToggle')?.addEventListener('click', () => showForgotPasswordPanel(true));
    document.getElementById('cancelResetPassword')?.addEventListener('click', () => showForgotPasswordPanel(false));
    document.getElementById('resetPasswordButton')?.addEventListener('click', handleForgotPasswordPage);
    document.getElementById('registerToLogin')?.addEventListener('click', () => {
        window.location.href = '/login';
    });

    document.addEventListener('keydown', (event) => {
        const activeId = document.activeElement?.id;
        if (event.key !== 'Enter') {
            return;
        }
        if (['loginUsername', 'loginPassword', 'loginOtp'].includes(activeId) && document.getElementById('loginButton')) {
            event.preventDefault();
            handleLoginPage();
            return;
        }
        if (['registerUsername', 'registerEmail', 'registerPassword', 'registerConfirmPassword'].includes(activeId) && document.getElementById('registerButton')) {
            event.preventDefault();
            handleRegisterPage();
            return;
        }
        if (['resetUsername', 'resetEmail', 'resetPassword', 'resetConfirmPassword'].includes(activeId) && document.getElementById('resetPasswordButton')) {
            event.preventDefault();
            handleForgotPasswordPage();
            return;
        }
    });
});
