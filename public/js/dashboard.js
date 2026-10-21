// IMECS Caregiver Command Dashboard Script with Microsoft Azure Suite

let map;
let alertMarker = null;
let safeZoneCircle = null;
let hospitalMarkers = [];
let nodeMarkers = [];
let contacts = [];
let alertHistory = [];
let medicalProfile = null;

// Simulation State
let activeNodesCount = 12;
let relayHops = 2.4;
let coveragePercent = 94;
let latencyMs = 38;
let disruptionLevel = 0;
let nodeStates = {
  towers: 'active',
  mesh: 'active',
  drones: []
};

// Default Simulation Node Coordinates (Vellore VIT Area)
const SIM_NODES = [
  { id: 0, type: 'base', name: 'HQ Emergency Command', lat: 12.9735, lng: 79.1590, status: 'active' },
  { id: 1, type: 'tower', name: 'Cell Tower North', lat: 12.9775, lng: 79.1625, status: 'active' },
  { id: 2, type: 'tower', name: 'Cell Tower East', lat: 12.9715, lng: 79.1685, status: 'active' },
  { id: 3, type: 'tower', name: 'Cell Tower South', lat: 12.9655, lng: 79.1555, status: 'active' },
  { id: 4, type: 'mesh', name: 'LoRa Mesh Node A', lat: 12.9750, lng: 79.1530, status: 'active' },
  { id: 5, type: 'mesh', name: 'LoRa Mesh Node B', lat: 12.9690, lng: 79.1620, status: 'active' },
  { id: 6, type: 'mesh', name: 'LoRa Mesh Node C', lat: 12.9675, lng: 79.1575, status: 'active' },
  { id: 7, type: 'responder', name: 'Ambulance Unit Alpha', lat: 12.9725, lng: 79.1510, status: 'active' },
  { id: 8, type: 'responder', name: 'Mobile Patrol Bravo', lat: 12.9685, lng: 79.1650, status: 'active' }
];

// Nearest Emergency Hospital Facilities
const HOSPITALS = [
  { name: 'Apollo Specialty Emergency Care', lat: 12.9698, lng: 79.1652, phone: '+91 416 222 1000', distance: '850m' },
  { name: 'CMC Vellore Trauma Center', lat: 12.9248, lng: 79.1352, phone: '+91 416 228 1000', distance: '5.2km' }
];

// Audio Alert Context
let audioCtx = null;

// Left Tab Switcher
window.switchLeftTab = function(tabName, btnEl) {
  ['contacts', 'medical', 'safezone'].forEach(t => {
    const el = document.getElementById(`left-tab-${t}`);
    if (el) el.style.display = t === tabName ? 'block' : 'none';
  });
  const tabs = btnEl.parentElement.querySelectorAll('.subnav-tab');
  tabs.forEach(t => t.classList.remove('active'));
  btnEl.classList.add('active');
};

// Right Tab Switcher
window.switchRightTab = function(tabName, btnEl) {
  ['azure', 'sim', 'logs'].forEach(t => {
    const el = document.getElementById(`right-tab-${t}`);
    if (el) el.style.display = t === tabName ? 'flex' : 'none';
  });
  const tabs = btnEl.parentElement.querySelectorAll('.subnav-tab');
  tabs.forEach(t => t.classList.remove('active'));
  btnEl.classList.add('active');
};

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  loadContacts();
  loadAlertHistory();
  loadMedicalProfile();
  loadSystemSettings();
  setupNotifications();
  setupSSE();
  setupAudioUnlock();

  // Contact Form
  const contactForm = document.getElementById('contact-form');
  if (contactForm) contactForm.addEventListener('submit', handleContactSubmit);
  const formCancelBtn = document.getElementById('form-cancel-btn');
  if (formCancelBtn) formCancelBtn.addEventListener('click', resetContactForm);

  // Medical Profile Form
  const medicalForm = document.getElementById('medical-form');
  if (medicalForm) medicalForm.addEventListener('submit', handleMedicalFormSubmit);

  // Safe Zone Form & Slider
  const safezoneForm = document.getElementById('safezone-form');
  if (safezoneForm) safezoneForm.addEventListener('submit', handleSafeZoneFormSubmit);
  const szRadiusInput = document.getElementById('sz-input-radius');
  if (szRadiusInput) {
    szRadiusInput.addEventListener('input', (e) => {
      const radius = parseInt(e.target.value);
      document.getElementById('sz-radius-label').textContent = `${radius}m`;
      if (safeZoneCircle) {
        safeZoneCircle.setRadius(radius);
      }
    });
  }

  // Gateway Config Form & Selectors
  const smsConfigForm = document.getElementById('sms-config-form');
  if (smsConfigForm) smsConfigForm.addEventListener('submit', handleGatewayConfigSubmit);
  const gatewaySelect = document.getElementById('gateway-provider-select');
  if (gatewaySelect) {
    gatewaySelect.addEventListener('change', (e) => {
      updateGatewayFieldsVisibility(e.target.value);
    });
  }

  // Test SMS Dispatch Button
  const sendTestSmsBtn = document.getElementById('send-test-sms-btn');
  if (sendTestSmsBtn) sendTestSmsBtn.addEventListener('click', handleSendTestSms);

  // Sync Azure Storage Button
  const syncAzureStorageBtn = document.getElementById('sync-azure-storage-btn');
  if (syncAzureStorageBtn) syncAzureStorageBtn.addEventListener('click', handleSyncAzureStorage);

  // Clear Logs Button
  const clearLogsBtn = document.getElementById('clear-logs-btn');
  if (clearLogsBtn) clearLogsBtn.addEventListener('click', clearAlertLogs);

  // Export Logs Button
  const exportLogsBtn = document.getElementById('export-logs-btn');
  if (exportLogsBtn) exportLogsBtn.addEventListener('click', exportIncidentSummaryReport);
});

// Audio unlock helper on user interaction
function setupAudioUnlock() {
  const unlock = () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  };
  window.addEventListener('click', unlock, { capture: true, passive: true });
  window.addEventListener('touchstart', unlock, { capture: true, passive: true });
}

// ==========================================
// LEAFLET MAP INITIALIZATION
// ==========================================
function initMap() {
  const vitLat = 12.9716;
  const vitLng = 79.1594;

  map = L.map('map', {
    zoomControl: true
  }).setView([vitLat, vitLng], 15);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  // Add Initial Simulation Nodes
  renderSimulationNodes();

  // Add Emergency Hospitals
  renderHospitalMarkers();

  // Create Safe Zone Circle
  renderSafeZoneCircle(vitLat, vitLng, 600);
}

function renderSimulationNodes() {
  nodeMarkers.forEach(m => map.removeLayer(m));
  nodeMarkers = [];

  SIM_NODES.forEach(node => {
    let iconHtml = '📡';
    if (node.type === 'base') iconHtml = '🏢';
    if (node.type === 'mesh') iconHtml = '🟢';
    if (node.type === 'responder') iconHtml = '🚑';

    const customIcon = L.divIcon({
      html: `<div style="font-size:18px; line-height:1; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));">${iconHtml}</div>`,
      className: 'sim-node-icon',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const marker = L.marker([node.lat, node.lng], { icon: customIcon }).addTo(map);
    marker.bindPopup(`<b>${node.name}</b><br>Type: ${node.type.toUpperCase()}<br>Status: ${node.status}`);
    nodeMarkers.push(marker);
  });
}

function renderHospitalMarkers() {
  hospitalMarkers.forEach(m => map.removeLayer(m));
  hospitalMarkers = [];

  HOSPITALS.forEach(h => {
    const customIcon = L.divIcon({
      html: `<div style="background:#ffffff; border:2px solid #d9383a; border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; font-size:14px; box-shadow:0 2px 6px rgba(0,0,0,0.25);">🏥</div>`,
      className: 'hospital-node-icon',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    const marker = L.marker([h.lat, h.lng], { icon: customIcon }).addTo(map);
    marker.bindPopup(`
      <div style="font-size:12px;">
        <b style="color:#d9383a;">🏥 ${h.name}</b><br>
        <span>Distance: ${h.distance}</span><br>
        <span>Emergency ER: <a href="tel:${h.phone}">${h.phone}</a></span><br>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}" target="_blank" style="color:#0078d4; font-weight:700; text-decoration:none; display:inline-block; margin-top:4px;">
          Directions via Maps &rarr;
        </a>
      </div>
    `);
    hospitalMarkers.push(marker);
  });
}

function renderSafeZoneCircle(lat, lng, radius) {
  if (safeZoneCircle) {
    map.removeLayer(safeZoneCircle);
  }

  safeZoneCircle = L.circle([lat, lng], {
    radius: radius,
    color: '#0078d4',
    fillColor: '#0078d4',
    fillOpacity: 0.10,
    weight: 2,
    dashArray: '6, 8'
  }).addTo(map);

  safeZoneCircle.bindTooltip("🛡️ Residential Safe Zone Boundary", { permanent: false, direction: 'top' });
}

window.centerMapOnSafeZone = function() {
  if (medicalProfile && medicalProfile.safeZone) {
    map.setView([medicalProfile.safeZone.latitude, medicalProfile.safeZone.longitude], 15);
  }
};

// ==========================================
// SSE STREAM & REAL-TIME ALERTS
// ==========================================
function setupSSE() {
  const eventSource = new EventSource('/api/alerts/stream');

  eventSource.onopen = () => {
    console.log('[SSE] Connected to backend alert stream.');
    document.getElementById('system-status-dot').className = 'status-dot';
  };

  eventSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'sos_triggered') {
        handleIncomingSOS(payload.data);
      } else if (payload.type === 'telemetry_updated') {
        handleTelemetryUpdate(payload.data);
      } else if (payload.type === 'medical_updated') {
        medicalProfile = payload.data;
        populateMedicalUI(medicalProfile);
      } else if (payload.type === 'status_updated') {
        updateAlertStatusInFeed(payload.data);
      } else if (payload.type === 'logs_cleared') {
        alertHistory = [];
        renderAlertFeed();
      }
    } catch (e) {
      console.warn('[SSE] Parse error:', e);
    }
  };

  eventSource.onerror = () => {
    console.warn('[SSE] Connection lost. Reconnecting...');
    document.getElementById('system-status-dot').className = 'status-dot danger';
  };
}

// Handle Incoming SOS Distress Alert
function handleIncomingSOS(alertData) {
  alertHistory.unshift(alertData);
  renderAlertFeed();
  playAlertSound();
  showBrowserNotification(alertData);
  showCaregiverAlertBanner(alertData);

  // Update System Status Banner
  const statusEl = document.getElementById('system-alert-status');
  statusEl.className = 'badge badge-danger';
  statusEl.textContent = 'CRITICAL DISTRESS ALERT';

  // Plot patient location on map
  plotAlertLocation(alertData);
}

function plotAlertLocation(alertData) {
  if (alertMarker) {
    map.removeLayer(alertMarker);
  }

  const pulseIcon = L.divIcon({
    html: `
      <div style="position:relative; width:36px; height:36px;">
        <div style="position:absolute; width:36px; height:36px; border-radius:50%; background:rgba(217, 56, 58, 0.4); animation:pulse-ring 1.5s infinite;"></div>
        <div style="position:absolute; top:4px; left:4px; width:28px; height:28px; border-radius:50%; background:#d9383a; border:3px solid white; display:flex; align-items:center; justify-content:center; color:white; font-size:14px; font-weight:800; box-shadow:0 4px 10px rgba(0,0,0,0.3);">🚨</div>
      </div>
    `,
    className: 'alert-pulse-marker',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  alertMarker = L.marker([alertData.latitude, alertData.longitude], { icon: pulseIcon }).addTo(map);

  const triage = alertData.triageAssessment || {};
  const med = alertData.medicalProfile || {};
  const gMapsUrl = `https://maps.google.com/?q=${alertData.latitude},${alertData.longitude}`;
  const gMapsDir = `https://www.google.com/maps/dir/?api=1&destination=${alertData.latitude},${alertData.longitude}`;

  const popupHtml = `
    <div style="font-size:12px; min-width:260px; padding:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <b style="color:#d9383a; font-size:14px;">🚨 DISTRESS LOCATION</b>
        <span class="triage-pill ${triage.triageLevel ? triage.triageLevel.toLowerCase() : 'red'}">${triage.triageLevel || 'CRITICAL'}</span>
      </div>
      <div><b>Patient:</b> ${alertData.sender}</div>
      <div><b>Coordinates:</b> <span style="font-family:monospace; font-weight:700;">${alertData.latitude}, ${alertData.longitude}</span></div>
      <div><b>Heart Rate:</b> ${alertData.vitalSigns ? alertData.vitalSigns.heartRate : 76} BPM | <b>SpO2:</b> ${alertData.vitalSigns ? alertData.vitalSigns.bloodOxygen : 98}%</div>
      ${med.bloodGroup ? `<div><b>Blood:</b> <span style="color:#d9383a; font-weight:700;">${med.bloodGroup}</span> | <b>Allergies:</b> ${med.allergies || 'None'}</div>` : ''}
      ${alertData.voiceMemoUrl ? `<div style="margin-top:6px;"><b>🎙️ Voice Memo:</b><br><audio src="${alertData.voiceMemoUrl}" controls style="width:100%; height:28px; margin-top:3px;"></audio></div>` : ''}
      
      <div style="margin-top:10px; display:flex; flex-direction:column; gap:6px;">
        <a href="${gMapsUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm" style="background:#1a73e8; color:white; font-weight:700; text-decoration:none; display:flex; align-items:center; justify-content:center; gap:5px; padding:6px 10px; border-radius:6px; box-shadow:0 1px 3px rgba(0,0,0,0.2);">
          📍 Open Live Pin in Google Maps &nearr;
        </a>
        <a href="${gMapsDir}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-primary" style="text-align:center; text-decoration:none; color:white; font-size:11px; padding:5px 8px; border-radius:6px;">
          🚗 Start Turn-by-Turn Navigation
        </a>
      </div>
    </div>
  `;

  alertMarker.bindPopup(popupHtml).openPopup();
  map.setView([alertData.latitude, alertData.longitude], 16);
}

// Handle Azure IoT Telemetry Updates
function handleTelemetryUpdate(twinData) {
  const vitals = twinData.vitals || {};
  const hrEl = document.getElementById('dash-hr-val');
  const spo2El = document.getElementById('dash-spo2-val');

  if (hrEl) hrEl.textContent = vitals.heartRate || 76;
  if (spo2El) spo2El.textContent = `${vitals.bloodOxygen || 98}%`;

  if (vitals.fallDetected) {
    document.getElementById('system-alert-status').className = 'badge badge-danger';
    document.getElementById('system-alert-status').textContent = 'FALL EVENT DETECTED';
  }
}

// Play Warning Siren
function playAlertSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(950, now + (i * 0.4));
      osc.frequency.exponentialRampToValueAtTime(380, now + (i * 0.4) + 0.3);
      gain.gain.setValueAtTime(0.2, now + (i * 0.4));
      gain.gain.exponentialRampToValueAtTime(0.01, now + (i * 0.4) + 0.35);
      osc.start(now + (i * 0.4));
      osc.stop(now + (i * 0.4) + 0.38);
    }
  } catch (e) {
    console.warn('Audio siren unavailable:', e);
  }
}

// Browser Push Notification
function setupNotifications() {
  const btn = document.getElementById('notify-perm-btn');
  if (!btn) return;

  if ('Notification' in window && Notification.permission === 'granted') {
    btn.textContent = '🔔 Push Alerts Active';
    btn.style.color = '#1b8552';
  }

  btn.addEventListener('click', () => {
    if ('Notification' in window) {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          btn.textContent = '🔔 Push Alerts Active';
          btn.style.color = '#1b8552';
          new Notification('IMECS Command Hub', {
            body: 'Audio and emergency desktop notifications are active.'
          });
        }
      });
    }
  });
}

function showBrowserNotification(alertData) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(`🚨 IMECS SOS: ${alertData.sender} in Distress!`, {
      body: `Location: Lat ${alertData.latitude}, Lng ${alertData.longitude}. Triage: ${alertData.triageAssessment ? alertData.triageAssessment.triageLevel : 'RED'}`
    });
  }
}

// ==========================================
// INCIDENT FEED & ACTIONS
// ==========================================
async function loadAlertHistory() {
  try {
    const res = await fetch('/api/alerts');
    if (res.ok) {
      alertHistory = await res.json();
      renderAlertFeed();
    }
  } catch (e) {
    console.error('Failed to load alert history:', e);
  }
}

function renderAlertFeed() {
  const container = document.getElementById('log-feed-container');
  if (!container) return;

  if (alertHistory.length === 0) {
    container.innerHTML = `<div style="font-size:11px; color:var(--text-tertiary); text-align:center; padding:20px;">No events recorded. Waiting for alerts...</div>`;
    return;
  }

  container.innerHTML = alertHistory.map(alert => {
    const triage = alert.triageAssessment || {};
    const med = alert.medicalProfile || {};
    const vitals = alert.vitalSigns || {};
    const levelClass = triage.triageLevel ? triage.triageLevel.toLowerCase() : 'red';
    const statusText = alert.status || 'Active (Unresolved)';

    return `
      <div class="log-item danger" style="margin-bottom:8px; border-left:4px solid ${levelClass === 'red' ? '#d9383a' : (levelClass === 'orange' ? '#d97706' : '#ca8a04')};">
        <div class="log-meta">
          <span style="font-weight:700; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
            <span>🚨 ${alert.sender}</span>
            <span class="triage-pill ${levelClass}">${triage.triageLevel || 'RED'}</span>
          </span>
          <span style="font-size:10px; color:var(--text-tertiary);">${new Date(alert.timestamp).toLocaleTimeString()}</span>
        </div>

        <div style="font-size:11px; margin:4px 0;">
          <b>Coords:</b> Lat ${alert.latitude}, Lng ${alert.longitude} • <b>Route:</b> ${alert.chosenChannel} • <b>Batt:</b> ${alert.batteryLevel}%
        </div>

        <div style="font-size:11px; color:var(--text-secondary);">
          <b>Vitals (IoT):</b> HR: ${vitals.heartRate || 76} BPM | SpO2: ${vitals.bloodOxygen || 98}% ${vitals.fallDetected ? ' | <b style="color:#d9383a;">FALL DETECTED</b>' : ''}
        </div>

        ${med.bloodGroup ? `
          <div style="font-size:10.5px; background:rgba(0,0,0,0.02); padding:4px 6px; border-radius:4px; margin-top:4px;">
            <b>Med ID:</b> Blood <b style="color:#d9383a;">${med.bloodGroup}</b> | Allergies: ${med.allergies || 'None'} | Doctor: ${med.doctor || 'None'}
          </div>
        ` : ''}

        <!-- Azure AI Clinical Summary -->
        <div class="triage-card ${levelClass}" style="margin-top:6px; padding:8px;">
          <div style="font-size:10.5px; font-weight:700; color:var(--text-primary);">
            🤖 Azure AI Clinical Assessment (${triage.urgencyMinutes || 5} min urgency):
          </div>
          <div style="font-size:10px; color:var(--text-secondary); margin-top:2px;">
            ${triage.clinicalSummary || 'Emergency triage evaluation complete.'}
          </div>
          ${triage.recommendedActions && triage.recommendedActions.length ? `
            <ul class="triage-actions-list" style="font-size:10px; margin-top:4px;">
              ${triage.recommendedActions.slice(0, 2).map(a => `<li>${a}</li>`).join('')}
            </ul>
          ` : ''}
        </div>

        <!-- Voice Memo Player -->
        ${alert.voiceMemoUrl ? `
          <div style="margin-top:6px; background:var(--bg-primary); padding:6px; border-radius:6px; border:1px solid var(--border-primary);">
            <div style="font-size:10px; font-weight:700; margin-bottom:2px;">🎙️ Emergency Voice Recording:</div>
            <audio src="${alert.voiceMemoUrl}" controls style="width:100%; height:28px;"></audio>
          </div>
        ` : ''}

        <!-- Responder Action Controls -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; flex-wrap:wrap; gap:6px;">
          <span style="font-size:10px; font-weight:700; color:${statusText.includes('Resolved') ? '#1b8552' : '#d9383a'};">
            Status: ${statusText}
          </span>
          <div class="responder-actions-bar" style="margin-top:0;">
            <a href="https://maps.google.com/?q=${alert.latitude},${alert.longitude}" target="_blank" rel="noopener noreferrer" class="btn btn-sm" style="background:#1a73e8; color:white; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,0.15);" title="Open exact coordinate pin in Google Maps">
              📍 Google Maps (${alert.latitude.toFixed(4)}, ${alert.longitude.toFixed(4)}) &nearr;
            </a>
            <button class="btn btn-sm" onclick="updateIncidentStatus('${alert.id}', 'Dispatched EMS')" style="background:#eef7ff; color:#0078d4; border-color:#0078d4;">
              🚑 Dispatch EMS
            </button>
            <button class="btn btn-sm" onclick="updateIncidentStatus('${alert.id}', 'Resolved')" style="background:#edfbf4; color:#1b8552; border-color:#1b8552;">
              ✓ Mark Resolved
            </button>
            <button class="btn btn-sm" onclick="centerOnAlert(${alert.latitude}, ${alert.longitude})">
              Map Fix
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.centerOnAlert = function(lat, lng) {
  map.setView([lat, lng], 17);
};

window.updateIncidentStatus = async function(alertId, newStatus) {
  try {
    const res = await fetch(`/api/alerts/${alertId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      const data = await res.json();
      updateAlertStatusInFeed(data.alert);
    }
  } catch (e) {
    console.error('Failed to update status:', e);
  }
};

function updateAlertStatusInFeed(updatedAlert) {
  const index = alertHistory.findIndex(a => a.id === updatedAlert.id);
  if (index !== -1) {
    alertHistory[index] = updatedAlert;
    renderAlertFeed();
  }
}

async function clearAlertLogs() {
  if (!confirm('Clear all recorded incident alert history?')) return;
  try {
    await fetch('/api/alerts/clear', { method: 'POST' });
    alertHistory = [];
    renderAlertFeed();
  } catch (e) {
    console.error('Failed to clear logs:', e);
  }
}

// Export Incident Summary JSON / Printable
window.exportIncidentSummaryReport = function() {
  if (alertHistory.length === 0) {
    alert('No incident logs to export.');
    return;
  }
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(alertHistory, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `IMECS_Incident_Report_${Date.now()}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
};

// ==========================================
// MEDICAL PROFILE API & GEOFENCE
// ==========================================
async function loadMedicalProfile() {
  try {
    const res = await fetch('/api/medical-profile');
    if (res.ok) {
      medicalProfile = await res.json();
      populateMedicalUI(medicalProfile);
      if (medicalProfile.safeZone) {
        renderSafeZoneCircle(
          medicalProfile.safeZone.latitude,
          medicalProfile.safeZone.longitude,
          medicalProfile.safeZone.radiusMeters || 600
        );
      }
    }
  } catch (e) {
    console.error('Failed to load medical profile:', e);
  }
}

function populateMedicalUI(profile) {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.value = val;
  };
  setVal('med-input-name', profile.fullName);
  setVal('med-input-age', profile.age);
  setVal('med-input-blood', profile.bloodGroup);
  setVal('med-input-allergies', profile.allergies);
  setVal('med-input-conditions', profile.conditions);
  setVal('med-input-meds', profile.medications);
  setVal('med-input-doctor', profile.emergencyDoctor);
  setVal('med-input-hospital', profile.preferredHospital);

  if (profile.safeZone) {
    setVal('sz-input-name', profile.safeZone.name);
    setVal('sz-input-lat', profile.safeZone.latitude);
    setVal('sz-input-lng', profile.safeZone.longitude);
    setVal('sz-input-radius', profile.safeZone.radiusMeters || 600);
    const radLabel = document.getElementById('sz-radius-label');
    if (radLabel) radLabel.textContent = `${profile.safeZone.radiusMeters || 600}m`;
  }
}

async function handleMedicalFormSubmit(e) {
  e.preventDefault();
  const payload = {
    fullName: document.getElementById('med-input-name').value,
    age: parseInt(document.getElementById('med-input-age').value) || 74,
    bloodGroup: document.getElementById('med-input-blood').value,
    allergies: document.getElementById('med-input-allergies').value,
    conditions: document.getElementById('med-input-conditions').value,
    medications: document.getElementById('med-input-meds').value,
    emergencyDoctor: document.getElementById('med-input-doctor').value,
    preferredHospital: document.getElementById('med-input-hospital').value
  };

  try {
    const res = await fetch('/api/medical-profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      alert('Medical ID Profile updated successfully!');
    }
  } catch (err) {
    alert('Failed to update medical profile: ' + err.message);
  }
}

async function handleSafeZoneFormSubmit(e) {
  e.preventDefault();
  const lat = parseFloat(document.getElementById('sz-input-lat').value);
  const lng = parseFloat(document.getElementById('sz-input-lng').value);
  const radius = parseInt(document.getElementById('sz-input-radius').value);
  const name = document.getElementById('sz-input-name').value;

  const safeZone = { name, latitude: lat, longitude: lng, radiusMeters: radius };

  try {
    const res = await fetch('/api/medical-profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ safeZone })
    });
    if (res.ok) {
      renderSafeZoneCircle(lat, lng, radius);
      map.setView([lat, lng], 15);
      alert(`Safe Zone Geofence updated! Radius set to ${radius}m.`);
    }
  } catch (err) {
    alert('Failed to update safe zone: ' + err.message);
  }
}

// ==========================================
// SYSTEM SETTINGS & MICROSOFT AZURE GATEWAY
// ==========================================
async function loadSystemSettings() {
  try {
    const res = await fetch('/api/system-info');
    if (res.ok) {
      const data = await res.json();
      const gatewaySelect = document.getElementById('gateway-provider-select');
      if (gatewaySelect) {
        gatewaySelect.value = data.gatewayProvider || 'simulated';
        updateGatewayFieldsVisibility(data.gatewayProvider || 'simulated');
      }

      // Update Azure ACS status
      const gateStatus = document.getElementById('sms-gate-status');
      if (gateStatus) {
        if (data.hasAzureAcs) {
          gateStatus.textContent = 'Azure ACS Active';
          gateStatus.className = 'badge badge-azure';
        } else if (data.hasTwilio) {
          gateStatus.textContent = 'Twilio Active';
          gateStatus.className = 'badge badge-info';
        } else {
          gateStatus.textContent = 'Simulated';
          gateStatus.className = 'badge';
        }
      }

      // Azure Storage badge
      const storageBadge = document.getElementById('storage-status-badge');
      if (storageBadge) {
        storageBadge.textContent = data.hasAzureStorage ? 'Azure Blob Online' : 'Local Backup';
      }

      // Fill Twilio fields
      if (data.twilioDetails && data.twilioDetails.phone) {
        const phoneEl = document.getElementById('twilio-phone');
        if (phoneEl) phoneEl.value = data.twilioDetails.phone;
      }
      if (data.azureDetails && data.azureDetails.acsPhone) {
        const acsPhoneEl = document.getElementById('azure-acs-phone');
        if (acsPhoneEl) acsPhoneEl.value = data.azureDetails.acsPhone;
      }
    }
  } catch (e) {
    console.error('Failed to load system settings:', e);
  }
}

function updateGatewayFieldsVisibility(provider) {
  const azureFields = document.getElementById('azure-acs-fields');
  const twilioFields = document.getElementById('twilio-fields');

  if (provider === 'azure') {
    if (azureFields) azureFields.style.display = 'flex';
    if (twilioFields) twilioFields.style.display = 'none';
  } else if (provider === 'twilio') {
    if (azureFields) azureFields.style.display = 'none';
    if (twilioFields) twilioFields.style.display = 'flex';
  } else if (provider === 'hybrid') {
    if (azureFields) azureFields.style.display = 'flex';
    if (twilioFields) twilioFields.style.display = 'flex';
  } else {
    // Simulated
    if (azureFields) azureFields.style.display = 'none';
    if (twilioFields) twilioFields.style.display = 'none';
  }
}

async function handleGatewayConfigSubmit(e) {
  e.preventDefault();
  const provider = document.getElementById('gateway-provider-select').value;
  const payload = {
    gatewayProvider: provider,
    simulateSms: provider === 'simulated',
    azureAcsConnStr: document.getElementById('azure-acs-conn')?.value || undefined,
    azureAcsPhone: document.getElementById('azure-acs-phone')?.value || undefined,
    twilioSid: document.getElementById('twilio-sid')?.value || undefined,
    twilioToken: document.getElementById('twilio-token')?.value || undefined,
    twilioPhone: document.getElementById('twilio-phone')?.value || undefined
  };

  try {
    const res = await fetch('/api/system-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      alert(`Gateway configuration saved! Active provider: ${provider.toUpperCase()}`);
      loadSystemSettings();
    }
  } catch (err) {
    alert('Failed to save configuration: ' + err.message);
  }
}

async function handleSendTestSms() {
  const testPhone = document.getElementById('test-sms-phone')?.value;
  if (!testPhone) {
    alert('Please enter a phone number to test SMS delivery.');
    return;
  }

  try {
    const res = await fetch('/api/gateway/test-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testPhone })
    });
    const data = await res.json();
    alert(`Test Message Result:\n${JSON.stringify(data.logs || data, null, 2)}`);
  } catch (err) {
    alert('Test SMS Failed: ' + err.message);
  }
}

async function handleSyncAzureStorage() {
  const btn = document.getElementById('sync-azure-storage-btn');
  btn.textContent = 'Syncing to Azure...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/azure/storage/sync', { method: 'POST' });
    const data = await res.json();
    alert(`Azure Blob Storage Sync:\n${data.message}\nContainer: ${data.container}`);
  } catch (err) {
    alert('Azure Storage Sync error: ' + err.message);
  } finally {
    btn.textContent = '☁️ Sync Incidents to Azure Blob Storage';
    btn.disabled = false;
  }
}

// ==========================================
// SIMULATION SCENARIO TESTS
// ==========================================
window.triggerSimEvent = function(type) {
  if (type === 'blackout') {
    activeNodesCount = 4;
    coveragePercent = 42;
    latencyMs = 120;
    relayHops = 4.8;
    alert('Scenario Triggered: Cell Tower Blackout. Switching to LoRa Mesh.');
  } else if (type === 'flood') {
    disruptionLevel = 2;
    coveragePercent = 68;
    latencyMs = 85;
    alert('Scenario Triggered: Flood in Zone B. Rerouting distress packets.');
  } else if (type === 'drone') {
    activeNodesCount += 2;
    coveragePercent = Math.min(100, coveragePercent + 20);
    latencyMs = 32;
    alert('Scenario Triggered: Aerial Relay Drone Deployed.');
  } else if (type === 'restore') {
    activeNodesCount = 12;
    coveragePercent = 94;
    latencyMs = 38;
    relayHops = 2.4;
    alert('System Restored: All primary cellular & LoRa gateways nominal.');
  }

  document.getElementById('m-nodes').textContent = activeNodesCount;
  document.getElementById('m-hops').textContent = relayHops;
  document.getElementById('m-cov').textContent = `${coveragePercent}%`;
};

window.simulateFallAlertOnDashboard = function() {
  fetch('/api/sos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitude: 12.9712,
      longitude: 79.1585,
      senderName: medicalProfile ? medicalProfile.fullName : "Senior Resident",
      batteryLevel: 72,
      triggerType: 'fall_detected',
      chosenChannel: 'LoRa Mesh Network',
      vitalSigns: { heartRate: 118, bloodOxygen: 95, fallDetected: true, impactGForce: 3.6 },
      isSimulated: true
    })
  });
};

window.simulateCardiacEmergency = function() {
  fetch('/api/sos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitude: 12.9730,
      longitude: 79.1605,
      senderName: medicalProfile ? medicalProfile.fullName : "Senior Resident",
      batteryLevel: 65,
      triggerType: 'cardiac_alert',
      chosenChannel: 'Cellular Data',
      vitalSigns: { heartRate: 138, bloodOxygen: 91, fallDetected: false, impactGForce: 1.0 },
      isSimulated: true
    })
  });
};

window.simulateGeofenceBreach = function() {
  fetch('/api/sos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitude: 12.9850, // Outside safe zone
      longitude: 79.1750,
      senderName: medicalProfile ? medicalProfile.fullName : "Senior Resident",
      batteryLevel: 45,
      triggerType: 'geofence_breach',
      chosenChannel: 'SMS Gateway',
      vitalSigns: { heartRate: 98, bloodOxygen: 96, fallDetected: false, impactGForce: 1.0 },
      isSimulated: true
    })
  });
};

// ==========================================
// CONTACTS CRUD
// ==========================================
async function loadContacts() {
  try {
    const res = await fetch('/api/contacts');
    if (res.ok) {
      contacts = await res.json();
      renderContacts();
    }
  } catch (e) {
    console.error('Failed to load contacts:', e);
  }
}

function renderContacts() {
  const container = document.getElementById('contacts-container');
  const badge = document.getElementById('contacts-badge');
  if (!container) return;

  if (badge) badge.textContent = `${contacts.length} Contacts`;

  if (contacts.length === 0) {
    container.innerHTML = `<p style="font-size:12px; color:var(--text-tertiary); text-align:center; padding:20px;">No contacts added yet.</p>`;
    return;
  }

  container.innerHTML = contacts.map(c => `
    <div class="contact-card" style="padding:10px; margin-bottom:8px; background:var(--bg-secondary); border-radius:8px; border:1px solid var(--border-primary);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <b style="font-size:13px;">${c.name}</b>
          <div style="font-size:11px; color:var(--text-secondary);">${c.relationship} • <a href="tel:${c.phone}" style="color:var(--color-info); text-decoration:none;">${c.phone}</a></div>
        </div>
        <span class="badge ${c.active ? 'badge-success' : 'badge-danger'}" style="font-size:9px; padding:2px 6px;">
          ${c.active ? 'Active' : 'Muted'}
        </span>
      </div>
      <div style="display:flex; gap:6px; margin-top:8px; justify-content:flex-end; flex-wrap:wrap;">
        <button class="btn btn-sm" onclick="sendLiveGpsToContact('${c.id}', '${c.name}')" style="font-size:10px; padding:2px 8px; background:#eef7ff; color:#0078d4; border-color:#0078d4;" title="Send Live GPS link directly to this contact via SMS">
          📍 Send Live GPS SMS
        </button>
        <button class="btn btn-sm" onclick="editContact('${c.id}')" style="font-size:10px; padding:2px 8px;">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteContact('${c.id}')" style="font-size:10px; padding:2px 8px;">Delete</button>
      </div>
    </div>
  `).join('');
}

async function handleContactSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('edit-contact-id').value;
  const name = document.getElementById('contact-name').value;
  const phone = document.getElementById('contact-phone').value;
  const relationship = document.getElementById('contact-rel').value;
  const active = document.getElementById('contact-active').checked;

  const method = editId ? 'PUT' : 'POST';
  const url = editId ? `/api/contacts/${editId}` : '/api/contacts';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, relationship, active })
    });
    if (res.ok) {
      resetContactForm();
      loadContacts();
    }
  } catch (err) {
    alert('Failed to save contact: ' + err.message);
  }
}

window.sendLiveGpsToContact = async function(contactId, contactName) {
  let lat = 12.9716;
  let lng = 79.1594;
  if (alertHistory.length > 0 && alertHistory[0].latitude) {
    lat = alertHistory[0].latitude;
    lng = alertHistory[0].longitude;
  }
  const sender = medicalProfile ? medicalProfile.fullName : "Senior Resident";
  try {
    const res = await fetch(`/api/contacts/${contactId}/send-location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: lat, longitude: lng, senderName: sender })
    });
    const data = await res.json();
    alert(`Live Location & Google Maps Link dispatched to ${contactName}!\n\nGoogle Maps Pin: ${data.mapsUrl}`);
  } catch (err) {
    alert(`Failed to send location SMS: ${err.message}`);
  }
};

window.editContact = function(id) {
  const contact = contacts.find(c => c.id === id);
  if (!contact) return;
  document.getElementById('edit-contact-id').value = contact.id;
  document.getElementById('contact-name').value = contact.name;
  document.getElementById('contact-phone').value = contact.phone;
  document.getElementById('contact-rel').value = contact.relationship;
  document.getElementById('contact-active').checked = contact.active;
  document.getElementById('form-submit-btn').textContent = 'Update Contact';
  document.getElementById('form-cancel-btn').style.display = 'inline-block';
};

window.deleteContact = async function(id) {
  if (!confirm('Are you sure you want to delete this contact?')) return;
  try {
    await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
    loadContacts();
  } catch (e) {
    console.error('Failed to delete contact:', e);
  }
};

function resetContactForm() {
  const form = document.getElementById('contact-form');
  if (form) form.reset();
  document.getElementById('edit-contact-id').value = '';
  document.getElementById('form-submit-btn').textContent = 'Save Contact';
  document.getElementById('form-cancel-btn').style.display = 'none';
}

// Emergency Floating Banner when new distress arrives
function showCaregiverAlertBanner(alertData) {
  const existing = document.getElementById('caregiver-emergency-modal');
  if (existing) existing.remove();

  const gMapsUrl = `https://maps.google.com/?q=${alertData.latitude},${alertData.longitude}`;
  const gMapsDir = `https://www.google.com/maps/dir/?api=1&destination=${alertData.latitude},${alertData.longitude}`;
  const triage = alertData.triageAssessment || {};

  const banner = document.createElement('div');
  banner.id = 'caregiver-emergency-modal';
  banner.className = 'custom-modal-backdrop active';
  banner.style.zIndex = '99999';
  banner.innerHTML = `
    <div class="custom-modal-card" style="border: 2px solid #d9383a; box-shadow: 0 12px 36px rgba(217, 56, 58, 0.4);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:24px;">🚨</span>
          <div>
            <h3 style="font-size:16px; font-weight:800; color:#d9383a; margin:0;">INCOMING DISTRESS ALERT!</h3>
            <span style="font-size:10px; color:var(--text-secondary);">${new Date(alertData.timestamp).toLocaleTimeString()}</span>
          </div>
        </div>
        <span class="triage-pill ${triage.triageLevel ? triage.triageLevel.toLowerCase() : 'red'}">${triage.triageLevel || 'CRITICAL'}</span>
      </div>

      <div style="background:var(--bg-secondary); padding:12px; border-radius:10px; font-size:12px; margin-bottom:14px;">
        <div><b>Patient:</b> <span style="font-size:13px; font-weight:700;">${alertData.sender}</span></div>
        <div style="margin-top:4px;"><b>📍 GPS Fix:</b> <span style="font-family:monospace; font-weight:700;">Lat ${alertData.latitude}, Lng ${alertData.longitude}</span></div>
        <div style="margin-top:4px;"><b>Route:</b> ${alertData.chosenChannel} | <b>Battery:</b> ${alertData.batteryLevel}%</div>
        ${alertData.vitalSigns ? `<div style="margin-top:4px;"><b>Vitals:</b> HR ${alertData.vitalSigns.heartRate || 76} BPM | SpO2 ${alertData.vitalSigns.bloodOxygen || 98}%</div>` : ''}
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <a href="${gMapsUrl}" target="_blank" rel="noopener noreferrer" class="btn" style="background:#1a73e8; color:white; font-weight:700; text-decoration:none; display:flex; align-items:center; justify-content:center; gap:8px; padding:10px; border-radius:8px; font-size:13px; box-shadow:0 2px 6px rgba(26,115,232,0.3);">
          📍 Open Live Location in Google Maps &nearr;
        </a>
        <a href="${gMapsDir}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="text-align:center; text-decoration:none; color:white; font-size:12px; padding:8px; border-radius:8px;">
          🚗 Start Turn-by-Turn Navigation to Patient
        </a>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-sm" onclick="centerOnAlert(${alertData.latitude}, ${alertData.longitude}); this.closest('.custom-modal-backdrop').remove();" style="flex:1; background:var(--bg-secondary); padding:8px;">
            Center Leaflet Map
          </button>
          <button class="btn btn-sm" onclick="this.closest('.custom-modal-backdrop').remove()" style="flex:1; background:var(--bg-secondary); padding:8px;">
            Acknowledge & Dismiss
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(banner);
}
