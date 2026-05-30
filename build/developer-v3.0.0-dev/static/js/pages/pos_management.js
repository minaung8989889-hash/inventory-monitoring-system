const TANK_IMAGE_MAP = {
    TK101: '/static/images/tanks/tk101.svg',
    TK102: '/static/images/tanks/tk102.svg',
    TK103: '/static/images/tanks/tk103.svg',
    TK104: '/static/images/tanks/tk104.svg',
    TK105: '/static/images/tanks/tk105.svg',
    TK106: '/static/images/tanks/tk106.svg',
    TK107: '/static/images/tanks/tk107.svg',
    TK108: '/static/images/tanks/tk108.svg',
    TK109: '/static/images/tanks/tk109.svg',
    TK110: '/static/images/tanks/tk110.svg'
};
const KNOWN_TANKS = Object.keys(TANK_IMAGE_MAP);

function getLast12Months() {
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i += 1) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
        const label = monthDate.toLocaleString('default', {month: 'short', year: 'numeric'});
        months.push({key: monthKey, label});
    }
    return months;
}

function formatDateTime(value) {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString();
}

function buildSummaryCards(records) {
    const count = records.length;
    const volumeTotal = records.reduce((sum, r) => sum + Number(r.volume || 0), 0);
    const avgLevel = count ? Math.round(records.reduce((sum, r) => sum + Number(r.level || 0), 0) / count) : 0;
    const avgTemp = count ? (records.reduce((sum, r) => sum + Number(r.temperature || 0), 0) / count).toFixed(1) : 'N/A';
    const avgPressure = count ? (records.reduce((sum, r) => sum + Number(r.pressure || 0), 0) / count).toFixed(2) : 'N/A';

    return `
        <div class="summary-card">
            <div class="summary-card-title">Records</div>
            <div class="summary-card-value">${count}</div>
            <div class="summary-card-meta">Records in the selected range</div>
        </div>
        <div class="summary-card">
            <div class="summary-card-title">Avg fill level</div>
            <div class="summary-card-value">${avgLevel}%</div>
            <div class="summary-card-meta">Average operational level</div>
        </div>
        <div class="summary-card">
            <div class="summary-card-title">Avg temp</div>
            <div class="summary-card-value">${avgTemp}°C</div>
            <div class="summary-card-meta">Average temperature</div>
        </div>
        <div class="summary-card">
            <div class="summary-card-title">Avg pressure</div>
            <div class="summary-card-value">${avgPressure} bar</div>
            <div class="summary-card-meta">Average pressure</div>
        </div>
        <div class="summary-card">
            <div class="summary-card-title">Total volume</div>
            <div class="summary-card-value">${volumeTotal.toLocaleString()}</div>
            <div class="summary-card-meta">Total inventory volume</div>
        </div>
    `;
}

function buildExtremeCards(records, role) {
    if (!records.length) {
        return '<div class="empty-state">No extreme records available for selected filters.</div>';
    }

    const highestTemp = records.reduce((best, item) => (!best || Number(item.temperature) > Number(best.temperature) ? item : best), null);
    const highestPressure = records.reduce((best, item) => (!best || Number(item.pressure) > Number(best.pressure) ? item : best), null);
    const highestVolume = records.reduce((best, item) => (!best || Number(item.volume) > Number(best.volume) ? item : best), null);
    const lowestLevel = records.reduce((best, item) => (!best || Number(item.level) < Number(best.level) ? item : best), null);

    return `
        <div class="summary-card summary-card-extreme">
            <div class="summary-card-title">Highest temperature</div>
            <div class="summary-card-value">${highestTemp ? `${Number(highestTemp.temperature).toFixed(1)}°C` : '—'}</div>
            <div class="summary-card-meta">${highestTemp ? `${highestTemp.tank} @ ${formatDateTime(highestTemp.timestamp)}` : 'No record'}</div>
        </div>
        <div class="summary-card summary-card-extreme">
            <div class="summary-card-title">Highest pressure</div>
            <div class="summary-card-value">${highestPressure ? `${Number(highestPressure.pressure).toFixed(2)} bar` : '—'}</div>
            <div class="summary-card-meta">${highestPressure ? `${highestPressure.tank} @ ${formatDateTime(highestPressure.timestamp)}` : 'No record'}</div>
        </div>
        <div class="summary-card summary-card-extreme">
            <div class="summary-card-title">Highest volume</div>
            <div class="summary-card-value">${highestVolume ? highestVolume.volume : '—'}</div>
            <div class="summary-card-meta">${highestVolume ? `${highestVolume.tank} @ ${formatDateTime(highestVolume.timestamp)}` : 'No record'}</div>
        </div>
        <div class="summary-card summary-card-extreme">
            <div class="summary-card-title">Lowest level</div>
            <div class="summary-card-value">${lowestLevel ? `${Number(lowestLevel.level).toFixed(1)}%` : '—'}</div>
            <div class="summary-card-meta">${lowestLevel ? `${lowestLevel.tank} @ ${formatDateTime(lowestLevel.timestamp)}` : 'No record'}</div>
        </div>
        ${role === 'master' ? `
        <div class="summary-card summary-card-master-note">
            <div class="summary-card-title">Master alert</div>
            <div class="summary-card-value">Extreme environment enabled</div>
            <div class="summary-card-meta">High-priority safety thresholds are shown for manager review.</div>
        </div>
        ` : ''}
    `;
}

function buildChart(records) {
    if (!records.length) {
        return '<div class="empty-state">No chart data available for this month.</div>';
    }
    const daily = {};
    records.forEach((r) => {
        const dt = new Date(r.timestamp);
        const dayKey = dt.toLocaleDateString('default', {day: '2-digit'});
        if (!daily[dayKey]) {
            daily[dayKey] = {count: 0, total: 0};
        }
        daily[dayKey].count += 1;
        daily[dayKey].total += Number(r.level || 0);
    });
    const entries = Object.keys(daily).sort().map((day) => {
        const avg = daily[day].count ? daily[day].total / daily[day].count : 0;
        return {day, avg};
    });
    const maxVal = Math.max(60, ...entries.map((item) => item.avg));
    const bars = entries.map((item) => `
        <div class="pos-chart-bar" style="height:${(item.avg / maxVal) * 100}%">
            <span>${Math.round(item.avg)}%</span>
            <small>${item.day}</small>
        </div>
    `).join('');
    return `
        <div class="pos-chart-bars">${bars}</div>
    `;
}

function buildTable(records) {
    if (!records.length) {
        return '<div class="empty-state">No POS records found for selected filters.</div>';
    }
    const highestTempId = records.reduce((best, item) => (!best || Number(item.temperature) > Number(best.temperature) ? item : best), null)?.id;
    const highestPressureId = records.reduce((best, item) => (!best || Number(item.pressure) > Number(best.pressure) ? item : best), null)?.id;
    const highestVolumeId = records.reduce((best, item) => (!best || Number(item.volume) > Number(best.volume) ? item : best), null)?.id;

    const rows = records.map((record) => {
        const highlight = record.id === highestTempId || record.id === highestPressureId || record.id === highestVolumeId;
        return `
            <tr class="${highlight ? 'highlight-row' : ''}">
                <td class="table-thumb"><img src="${getTankImage(record.tank)}" alt="${record.tank}" loading="lazy"></td>
                <td>${formatDateTime(record.timestamp)}</td>
                <td>${record.tank || 'Unknown'}</td>
                <td>${record.level ?? 'N/A'}</td>
                <td>${record.temperature ?? 'N/A'}</td>
                <td>${record.pressure ?? 'N/A'}</td>
                <td>${record.volume ?? 'N/A'}</td>
            </tr>
        `;
    }).join('');

    return `
        <div class="pos-table-controls"><span class="table-badge">${records.length} rows</span></div>
        <table class="pos-table">
            <thead>
                <tr>
                    <th>Tank</th>
                    <th>Timestamp</th>
                    <th>Name</th>
                    <th>Fill level</th>
                    <th>Temperature</th>
                    <th>Pressure</th>
                    <th>Volume</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function downloadCsv(records, tank, month) {
    const header = ['Timestamp', 'Tank', 'Fill level', 'Temperature', 'Pressure', 'Volume'];
    const lines = [header.join(',')];
    records.forEach((record) => {
        const row = [
            `"${formatDateTime(record.timestamp)}"`,
            `"${(record.tank || '').replace(/"/g, '""')}"`,
            `"${record.level ?? ''}"`,
            `"${record.temperature ?? ''}"`,
            `"${record.pressure ?? ''}"`,
            `"${record.volume ?? ''}"`
        ];
        lines.push(row.join(','));
    });
    const content = lines.join('\n');
    const blob = new Blob([content], {type: 'text/csv;charset=utf-8;'});
    const link = document.createElement('a');
    const filename = `tankfarm-pos-${tank}-${month}.csv`;
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function getTankImage(tankName) {
    return TANK_IMAGE_MAP[tankName] || '/static/images/tanks/tk101.svg';
}

function combineDateTime(dateValue, timeValue, endOfDay = false) {
    if (!dateValue) return null;
    const [year, month, day] = dateValue.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (timeValue) {
        const [hours, minutes] = timeValue.split(':').map(Number);
        date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
    } else {
        date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    }
    return date;
}

function filterRecords(records) {
    const selectedTank = document.getElementById('posTankSelect')?.value || '';
    const search = document.getElementById('posSearchText')?.value.trim().toLowerCase();
    const dateFrom = document.getElementById('posDateFrom')?.value;
    const dateTo = document.getElementById('posDateTo')?.value;
    const timeFrom = document.getElementById('posTimeFrom')?.value;
    const timeTo = document.getElementById('posTimeTo')?.value;
    const minVolumeStr = document.getElementById('posMinVolume')?.value || '';
    const maxVolumeStr = document.getElementById('posMaxVolume')?.value || '';
    const minTempStr = document.getElementById('posMinTemp')?.value || '';
    const maxTempStr = document.getElementById('posMaxTemp')?.value || '';
    const minPressureStr = document.getElementById('posMinPressure')?.value || '';
    const maxPressureStr = document.getElementById('posMaxPressure')?.value || '';
    const minVolume = minVolumeStr !== '' ? parseFloat(minVolumeStr) : null;
    const maxVolume = maxVolumeStr !== '' ? parseFloat(maxVolumeStr) : null;
    const minTemp = minTempStr !== '' ? parseFloat(minTempStr) : null;
    const maxTemp = maxTempStr !== '' ? parseFloat(maxTempStr) : null;
    const minPressure = minPressureStr !== '' ? parseFloat(minPressureStr) : null;
    const maxPressure = maxPressureStr !== '' ? parseFloat(maxPressureStr) : null;

    const fromDateTime = dateFrom ? combineDateTime(dateFrom, timeFrom, false) : null;
    const toDateTime = dateTo ? combineDateTime(dateTo, timeTo, true) : null;

    return records.filter((record) => {
        if (selectedTank && record.tank !== selectedTank) {
            return false;
        }
        const recordTs = new Date(record.timestamp);
        if (fromDateTime && recordTs < fromDateTime) {
            return false;
        }
        if (toDateTime && recordTs > toDateTime) {
            return false;
        }
        if (minVolume !== null && Number(record.volume) < minVolume) {
            return false;
        }
        if (maxVolume !== null && Number(record.volume) > maxVolume) {
            return false;
        }
        if (minTemp !== null && Number(record.temperature) < minTemp) {
            return false;
        }
        if (maxTemp !== null && Number(record.temperature) > maxTemp) {
            return false;
        }
        if (minPressure !== null && Number(record.pressure) < minPressure) {
            return false;
        }
        if (maxPressure !== null && Number(record.pressure) > maxPressure) {
            return false;
        }
        if (search) {
            const terms = `${record.tank || ''} ${record.level || ''} ${record.temperature || ''} ${record.pressure || ''} ${record.volume || ''}`.toLowerCase();
            if (!terms.includes(search)) {
                return false;
            }
        }
        return true;
    });
}

function buildTankVisuals(latestReadings, displayMap = {}, role = '', selectedTank = '') {
    const latestByTank = latestReadings.reduce((map, reading) => {
        if (reading.tank) {
            map[reading.tank] = reading;
        }
        return map;
    }, {});

    return KNOWN_TANKS.map((name) => {
        const reading = latestByTank[name] || {};
        const display = displayMap[name] || name;
        const isSelected = !!selectedTank && selectedTank === name;
        const isFiltered = !!selectedTank && !isSelected;
        return `
            <div class="tank-visual-card ${isSelected ? 'selected' : ''} ${isFiltered ? 'drop-off' : ''}" data-tank="${name}">
                <img src="${getTankImage(name)}" alt="${name}" />
                <div class="tank-visual-meta">
                    <div class="tank-visual-title"><span class="tank-tag" data-tank="${name}">${display}</span>
                        ${['master','operator'].includes(role) ? `<button class="tank-edit-btn" data-tank="${name}" title="Edit tag">✎</button>` : ''}
                    </div>
                    <div class="tank-visual-data">Level: ${reading.level ?? '—'}%</div>
                    <div class="tank-visual-data">Temp: ${reading.temperature ?? '—'}°C</div>
                    <div class="tank-visual-data">Pressure: ${reading.pressure ?? '—'} bar</div>
                </div>
            </div>
        `;
    }).join('');
}

async function loadPosPage() {
    const profile = await loadProfile();
    if (!profile) {
        return;
    }

    document.getElementById('logoutLink')?.addEventListener('click', (event) => {
        event.preventDefault();
        logoutAndRedirect();
    });

    const posTankSelect = document.getElementById('posTankSelect');
    const posMonthSelect = document.getElementById('posMonthSelect');
    const reloadButton = document.getElementById('posReloadButton');
    const exportButton = document.getElementById('posExportButton');

    const tanksResponse = await secureFetch('/api/tanks');
    if (!tanksResponse.ok) {
        document.getElementById('posTableWrapper').innerHTML = '<div class="empty-state">Unable to load tank list.</div>';
        return;
    }
    const tanks = await tanksResponse.json();
    const tankNames = [...new Set([...KNOWN_TANKS, ...tanks.map((tank) => tank.tank).filter(Boolean)])];
    // build display name map
    const tankDisplayMap = {};
    tanks.forEach((t) => {
        if (t.tank) tankDisplayMap[t.tank] = t.display_name || t.tank;
    });

    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.text = 'All tanks';
    posTankSelect.appendChild(allOption);

    tankNames.forEach((tankName) => {
        const option = document.createElement('option');
        option.value = tankName;
        option.text = tankDisplayMap[tankName] || tankName;
        posTankSelect.appendChild(option);
    });

    getLast12Months().forEach((month) => {
        const option = document.createElement('option');
        option.value = month.key;
        option.text = month.label;
        posMonthSelect.appendChild(option);
    });

    const selectedMonth = getLast12Months()[0];
    if (selectedMonth) {
        posMonthSelect.value = selectedMonth.key;
    }

    document.getElementById('tankVisualGrid').innerHTML = buildTankVisuals(tanks, tankDisplayMap, profile.role, posTankSelect.value);
    // Ensure tanks 1-4 are ordered first visually
    const visualGrid = document.getElementById('tankVisualGrid');
    if (visualGrid) {
        // reorder children: TK101..TK104 first
        const preferred = ['TK101','TK102','TK103','TK104'];
        const nodes = Array.from(visualGrid.children);
        const ordered = [];
        preferred.forEach((p) => {
            const found = nodes.find(n => n.textContent.includes(p));
            if (found) ordered.push(found);
        });
        nodes.forEach(n => { if (!ordered.includes(n)) ordered.push(n); });
        visualGrid.innerHTML = ordered.map(n => n.outerHTML).join('');
    }

    let currentRecords = [];

    async function refreshData() {
        const query = new URLSearchParams();
        const tank = posTankSelect.value;
        const month = posMonthSelect.value;
        if (tank) query.set('tank', tank);
        if (month) query.set('month', month);

        const response = await secureFetch(`/api/tanks/pos-report?${query.toString()}`);
        if (!response.ok) {
            document.getElementById('posExtremeCards').innerHTML = '';
            document.getElementById('posSummaryCards').innerHTML = '';
            document.getElementById('posChart').innerHTML = '<div class="empty-state">Unable to load POS records.</div>';
            document.getElementById('posTableWrapper').innerHTML = '<div class="empty-state">Unable to load POS records.</div>';
            return;
        }

        currentRecords = await response.json();
        // append new record to live list if SSE provides later
        const filtered = filterRecords(currentRecords);
        const selectedTank = posTankSelect.value;
        document.getElementById('posExtremeCards').innerHTML = buildExtremeCards(filtered, profile.role);
        document.getElementById('posSummaryCards').innerHTML = buildSummaryCards(filtered);
        document.getElementById('posChart').innerHTML = buildChart(filtered);
        document.getElementById('posTableWrapper').innerHTML = buildTable(filtered);
        document.getElementById('tankVisualGrid').innerHTML = buildTankVisuals(currentRecords, tankDisplayMap, profile.role, selectedTank);
        attachTankEditHandlers(tankDisplayMap, profile.role);
    }

    reloadButton.addEventListener('click', refreshData);
    exportButton.addEventListener('click', () => {
        const tank = posTankSelect.value || 'all';
        const month = posMonthSelect.value || 'all';
        downloadCsv(filterRecords(currentRecords), tank, month);
    });

    ['posTankSelect', 'posMonthSelect', 'posDateFrom', 'posDateTo', 'posTimeFrom', 'posTimeTo', 'posSearchText', 'posMinVolume', 'posMaxVolume', 'posMinTemp', 'posMaxTemp', 'posMinPressure', 'posMaxPressure'].forEach((id) => {
        document.getElementById(id)?.addEventListener('input', refreshData);
    });

    await refreshData();

    // Live updates via Server-Sent Events
    try {
        const es = new EventSource('/api/tanks/live', {withCredentials: true});
        es.onmessage = (evt) => {
            try {
                const data = JSON.parse(evt.data);
                // update visuals
                const latestIndex = currentRecords.findIndex(r => r.tank === data.tank && r.id === data.id);
                // add or replace
                if (latestIndex >= 0) {
                    currentRecords[latestIndex] = data;
                } else {
                    currentRecords.push(data);
                }
                // update visuals grid value for the specific tank
                const grid = document.getElementById('tankVisualGrid');
                const selectedTank = posTankSelect.value;
                if (grid) grid.innerHTML = buildTankVisuals(currentRecords, tankDisplayMap, profile.role, selectedTank);
                // if the new record matches current filters, refresh table and summaries
                const filtered = filterRecords(currentRecords);
                document.getElementById('posExtremeCards').innerHTML = buildExtremeCards(filtered, profile.role);
                document.getElementById('posSummaryCards').innerHTML = buildSummaryCards(filtered);
                document.getElementById('posChart').innerHTML = buildChart(filtered);
                document.getElementById('posTableWrapper').innerHTML = buildTable(filtered);
                attachTankEditHandlers(tankDisplayMap, profile.role);
            } catch (e) {
                console.error('SSE parse error', e);
            }
        };
        es.onerror = (err) => {
            console.warn('SSE connection error', err);
            es.close();
        };
    } catch (e) {
        console.warn('EventSource not available', e);
    }
}

function attachTankEditHandlers(displayMap = {}, role = '') {
    if (!['master', 'operator'].includes(role)) return;
    document.querySelectorAll('.tank-edit-btn').forEach((btn) => {
        btn.onclick = handleTankEditClick;
    });

    async function handleTankEditClick(e) {
        const tank = e.currentTarget.getAttribute('data-tank');
        const card = e.currentTarget.closest('.tank-visual-card');
        if (!card) return;
        const tagSpan = card.querySelector('.tank-tag');
        const current = displayMap[tank] || tagSpan?.textContent || tank;

        // Replace tag with input controls
        tagSpan.innerHTML = `<input id="tag-input-${tank}" value="${current}" style="padding:4px;border-radius:6px;border:1px solid #ccc;min-width:90px;">`;
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.className = 'button';
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'button muted';
        e.currentTarget.style.display = 'none';
        tagSpan.appendChild(saveBtn);
        tagSpan.appendChild(cancelBtn);

        cancelBtn.addEventListener('click', () => {
            tagSpan.textContent = displayMap[tank] || tank;
            e.currentTarget.style.display = '';
        }, {once: true});

        saveBtn.addEventListener('click', async () => {
            const input = document.getElementById(`tag-input-${tank}`);
            const newName = input.value.trim();
            if (!newName) { alert('Tag cannot be empty'); return; }
            const res = await secureFetch(`/api/tanks/${tank}/tag`, {method: 'PUT', body: {display_name: newName}});
            if (!res.ok) {
                alert('Unable to save tag');
                return;
            }
            displayMap[tank] = newName;
            // update DOM in-place
            tagSpan.textContent = newName;
            e.currentTarget.style.display = '';
        }, {once: true});
    }
}

document.addEventListener('DOMContentLoaded', loadPosPage);
