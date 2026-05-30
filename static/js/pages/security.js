async function renderSecurityPage() {
    const profile = await loadProfile();
    if (!profile) return;

    document.getElementById('securityUsername').textContent = profile.username;
    document.getElementById('security2faStatus').textContent = profile.two_factor_enabled ? 'Enabled' : 'Disabled';

    document.getElementById('enable2faButton')?.addEventListener('click', async () => {
        const response = await secureFetch('/api/profile/2fa/setup', {method: 'POST'});
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            alert(data.message || 'Unable to start 2FA setup.');
            return;
        }
        const data = await response.json();
        document.getElementById('securitySetupInfo').classList.remove('hidden');
        document.getElementById('securityQrCode').src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(data.otp_auth_url)}`;
        document.getElementById('securityTotpUrl').textContent = data.otp_auth_url;
    });

    document.getElementById('disable2faButton')?.addEventListener('click', async () => {
        const response = await secureFetch('/api/profile/2fa/disable', {method: 'POST'});
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            alert(data.message || 'Unable to disable 2FA.');
            return;
        }
        alert('2FA disabled successfully.');
        renderSecurityPage();
    });

    document.getElementById('verify2faButton')?.addEventListener('click', async () => {
        const otp = document.getElementById('securityOtp')?.value.trim();
        if (!otp) {
            alert('Enter the verification code from your authenticator app.');
            return;
        }
        const response = await secureFetch('/api/profile/2fa/verify', {
            method: 'POST',
            body: {otp}
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            alert(data.message || 'Unable to verify 2FA.');
            return;
        }
        alert('Two-factor authentication enabled.');
        renderSecurityPage();
    });

    document.getElementById('logoutLink')?.addEventListener('click', (event) => {
        event.preventDefault();
        logoutAndRedirect();
    });
}

document.addEventListener('DOMContentLoaded', renderSecurityPage);
