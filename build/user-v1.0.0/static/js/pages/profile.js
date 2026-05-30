async function renderProfile() {
    const profile = await loadProfile();
    if (!profile) return;

    document.getElementById('profileUsername').textContent = profile.username;
    document.getElementById('profileEmail').textContent = profile.email || 'Not provided';
    document.getElementById('profileRole').textContent = profile.role;
    document.getElementById('profileStatus').textContent = profile.approved ? 'Approved' : 'Pending approval';

    document.getElementById('profileForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const password = document.getElementById('profilePassword').value.trim();
        if (!password) {
            alert('Enter a password to update.');
            return;
        }
        if (password.length < 8) {
            alert('Password must be at least 8 characters.');
            return;
        }
        const response = await secureFetch('/api/profile', {
            method: 'PUT',
            body: {password}
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            alert(data.message || 'Unable to update profile.');
            return;
        }
        alert('Password updated successfully.');
        document.getElementById('profilePassword').value = '';
    });

    document.getElementById('logoutLink')?.addEventListener('click', (event) => {
        event.preventDefault();
        logoutAndRedirect();
    });
}

document.addEventListener('DOMContentLoaded', renderProfile);
