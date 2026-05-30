async function renderSettingsPage() {
    const profile = await loadProfile();
    if (!profile) return;

    document.getElementById('settingsUser').textContent = profile.username;
    document.getElementById('settingsRole').textContent = profile.role;
    document.getElementById('settingsEmail').textContent = profile.email || 'Not provided';

    document.getElementById('settingsForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const newPassword = document.getElementById('settingsPassword').value.trim();
        const newRole = document.getElementById('settingsRoleSelect')?.value;
        const updateBody = {};
        if (newPassword) {
            if (newPassword.length < 8) {
                alert('Password must be at least 8 characters.');
                return;
            }
            updateBody.password = newPassword;
        }
        if (newRole && newRole !== profile.role) {
            updateBody.role = newRole;
        }
        if (!Object.keys(updateBody).length) {
            alert('Make a change before saving.');
            return;
        }
        const response = await secureFetch('/api/profile', {
            method: 'PUT',
            body: updateBody
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            alert(data.message || 'Unable to save settings.');
            return;
        }
        alert('Settings updated successfully.');
        document.getElementById('settingsPassword').value = '';
        renderSettingsPage();
    });

    document.getElementById('logoutLink')?.addEventListener('click', (event) => {
        event.preventDefault();
        logoutAndRedirect();
    });
}

document.addEventListener('DOMContentLoaded', renderSettingsPage);
