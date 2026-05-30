document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('logoutLink')?.addEventListener('click', (event) => {
        event.preventDefault();
        logoutAndRedirect();
    });
});
