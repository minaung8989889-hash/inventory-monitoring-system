async function loadDevSettings() {
    const response = await secureFetch('/api/dev-settings');
    if (!response.ok) {
        document.getElementById('devSettingsMessage').textContent = 'Unable to load developer settings. Please sign in again.';
        return;
    }
    const data = await response.json();
    document.getElementById('publicIp').value = data.public_ip || '';
    document.getElementById('publicDomain').value = data.public_domain || '';
    document.getElementById('publicHost').value = data.public_host || '';
    document.getElementById('mqttBroker').value = data.mqtt_broker || '';
    document.getElementById('nodeRedHost').value = data.node_red_host || '';
    document.getElementById('dataTransmissionTarget').value = data.data_transmission_target || 'cloud';
    document.getElementById('cloudHost').value = data.cloud_host || '';
    document.getElementById('internalHost').value = data.internal_host || '';
    document.getElementById('dataTransmitMode').value = data.data_transmit_mode || 'https';
    document.getElementById('encryptionRequired').checked = Boolean(data.encryption_required);
    document.getElementById('forceSecureTransport').checked = Boolean(data.force_secure_transport);
    document.getElementById('transmitIntervalSec').value = data.transmit_interval_sec || 60;
    document.getElementById('apiKey').value = data.api_key_set ? '*****' : '';
    document.getElementById('apiKeyStatus').textContent = data.api_key_set ? 'A developer API key is already configured.' : 'No developer API key is configured yet.';
}

function generateSecureKey(length = 32) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let value = '';
    for (let i = 0; i < length; i += 1) {
        const randomIndex = Math.floor(Math.random() * charset.length);
        value += charset[randomIndex];
    }
    return value;
}

async function saveDevSettings() {
    const apiKeyInput = document.getElementById('apiKey');
    const payload = {
        public_ip: document.getElementById('publicIp').value.trim(),
        public_domain: document.getElementById('publicDomain').value.trim(),
        public_host: document.getElementById('publicHost').value.trim(),
        mqtt_broker: document.getElementById('mqttBroker').value.trim(),
        node_red_host: document.getElementById('nodeRedHost').value.trim(),
        data_transmission_target: document.getElementById('dataTransmissionTarget').value,
        cloud_host: document.getElementById('cloudHost').value.trim(),
        internal_host: document.getElementById('internalHost').value.trim(),
        data_transmit_mode: document.getElementById('dataTransmitMode').value,
        encryption_required: document.getElementById('encryptionRequired').checked,
        force_secure_transport: document.getElementById('forceSecureTransport').checked,
        transmit_interval_sec: document.getElementById('transmitIntervalSec').value
    };
    const apiKeyValue = apiKeyInput.value.trim();
    if (apiKeyValue && apiKeyValue !== '*****') {
        payload.api_key = apiKeyValue;
    } else if (apiKeyValue === '') {
        payload.api_key = '';
    }
    const response = await secureFetch('/api/dev-settings', {
        method: 'PUT',
        body: payload
    });
    const result = await response.json();
    if (!response.ok) {
        document.getElementById('devSettingsMessage').textContent = result.message || 'Unable to save developer settings.';
        return;
    }
    document.getElementById('devSettingsMessage').textContent = 'Developer settings updated successfully.';
    document.getElementById('apiKeyStatus').textContent = result.settings.api_key_set ? 'A developer API key is configured.' : 'No developer API key is configured.';
    if (result.settings.api_key_set) {
        document.getElementById('apiKey').value = '*****';
    }
}

async function testTransmission() {
    const transmitResult = document.getElementById('transmitResult');
    transmitResult.textContent = 'Sending test transmission...';
    const payload = {
        source: 'developer_panel',
        message: 'Developer transmission test payload',
        timestamp: new Date().toISOString()
    };
    const response = await secureFetch('/api/dev-settings/transmit', {
        method: 'POST',
        body: payload
    });
    const result = await response.json();
    if (!response.ok) {
        transmitResult.textContent = result.message || 'Test transmission failed.';
        return;
    }
    if (result.success) {
        transmitResult.textContent = `Transmission succeeded: ${result.status} ${result.endpoint}`;
    } else {
        transmitResult.textContent = result.message || 'Test transmission failed.';
    }
}

async function loadTotalizer() {
    const totalizerValue = document.getElementById('totalizerValue');
    const response = await secureFetch('/api/totalizer');
    if (!response.ok) {
        totalizerValue.textContent = 'Unavailable';
        return;
    }
    const data = await response.json();
    totalizerValue.textContent = `${data.value.toFixed(2)}`;
}

async function resetTotalizer() {
    const confirmed = window.confirm('Reset the system totalizer to zero? This action cannot be undone.');
    if (!confirmed) {
        return;
    }
    const response = await secureFetch('/api/totalizer/reset', { method: 'POST' });
    const messageField = document.getElementById('totalizerMessage');
    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        messageField.textContent = errorBody.message || 'Unable to reset totalizer.';
        return;
    }
    const result = await response.json();
    messageField.textContent = result.message || 'Totalizer reset successfully.';
    await loadTotalizer();
}

async function loadAdminTools() {
    const profile = await loadProfile();
    const adminSection = document.getElementById('administratorSection');
    if (!profile || profile.role !== 'administrator') {
        if (adminSection) {
            adminSection.classList.add('hidden');
        }
        return;
    }
    if (adminSection) {
        adminSection.classList.remove('hidden');
    }
    document.getElementById('resetTotalizerButton').addEventListener('click', resetTotalizer);
    await loadTotalizer();
}

function initDeveloperPanel() {
    document.getElementById('generateApiKey').addEventListener('click', () => {
        document.getElementById('apiKey').value = generateSecureKey(32);
        document.getElementById('apiKeyStatus').textContent = 'A new API key has been generated. Save to apply it.';
    });
    document.getElementById('saveDevSettings').addEventListener('click', saveDevSettings);
    document.getElementById('testTransmit').addEventListener('click', testTransmission);
    loadDevSettings();
    loadAdminTools();
}

window.addEventListener('DOMContentLoaded', initDeveloperPanel);
