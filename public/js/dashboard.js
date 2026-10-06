// IMECS Caregiver Dashboard Script

let map;
let alertMarker = null;
let breadcrumbPolyline = null;
let nodeMarkers = [];
let contacts = [];
let alertHistory = [];

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
  { id: 0, type: 'base', name: 'HQ Command', lat: 12.9735, lng: 79.1590, status: 'active' },
  { id: 1, type: 'tower', name: 'Cell Tower North', lat: 12.9775, lng: 79.1625, status: 'active' },
  { id: 2, type: 'tower', name: 'Cell Tower East', lat: 12.9715, lng: 79.1685, status: 'active' },
  { id: 3, type: 'tower', name: 'Cell Tower South', lat: 12.9655, lng: 79.1555, status: 'active' },
  { id: 4, type: 'mesh', name: 'LoRa Mesh Node A', lat: 12.9750, lng: 79.1530, status: 'active' },
  { id: 5, type: 'mesh', name: 'LoRa Mesh Node B', lat: 12.9690, lng: 79.1620, status: 'active' },
  { id: 6, type: 'mesh', name: 'LoRa Mesh Node C', lat: 12.9675, lng: 79.1575, status: 'active' },
  { id: 7, type: 'responder', name: 'Unit Alpha', lat: 12.9725, lng: 79.1510, status: 'active' },
  { id: 8, type: 'responder', name: 'Unit Bravo', lat: 12.9685, lng: 79.1650, status: 'active' }
];

// Audio Alert Context
let audioCtx = null;

// DOM Elements
const contactsContainer = document.getElementById('contacts-container');
const contactsBadge = document.getElementById('contacts-badge');
const contactForm = document.getElementById('contact-form');
const contactNameInput = document.getElementById('contact-name');
const contactPhoneInput = document.getElementById('contact-phone');
const contactRelSelect = document.getElementById('contact-rel');
const contactActiveCheck = document.getElementById('contact-active');
const editIdInput = document.getElementById('edit-contact-id');
const formSubmitBtn = document.getElementById('form-submit-btn');
const formCancelBtn = document.getElementById('form-cancel-btn');
const logFeedContainer = document.getElementById('log-feed-container');
const clearLogsBtn = document.getElementById('clear-logs-btn');

// Metrics UI Elements
const mNodes = document.getElementById('m-nodes');
const mHops = document.getElementById('m-hops');
const mCov = document.getElementById('m-cov');
const mLat = document.getElementById('m-lat');
const systemAlertStatus = document.getElementById('system-alert-status');
const systemStatusDot = document.getElementById('system-status-dot');

// Gateway Configuration Elements
const smsSimulateToggle = document.getElementById('sms-simulate-toggle');
const twilioFields = document.getElementById('twilio-fields');
const smsGateStatus = document.getElementById('sms-gate-status');
const twilioSidInput = document.getElementById('twilio-sid');
const twilioTokenInput = document.getElementById('twilio-token');
const twilioPhoneInput = document.getElementById('twilio-phone');
const smsConfigForm = document.getElementById('sms-config-form');
const notifyPermBtn = document.getElementById('notify-perm-btn');

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  loadContacts();
  loadAlertHistory();
  loadSystemSettings();
  setupNotifications();
  setupSSE();
  updateMetricsUI();
  
  // Event listeners
  contactForm.addEventListener('submit', handleContactSubmit);
  formCancelBtn.addEventListener('click', resetContactForm);
  clearLogsBtn.addEventListener('click', clearAlertLogs);
  
  smsConfigForm.addEventListener('submit', handleGateConfigSubmit);
  smsSimulateToggle.addEventListener('change', (e) => {
    twilioFields.style.display = e.target.checked ? 'none' : 'flex';
  });

  // Global capturing listener on window for click and touchstart to unlock AudioContext
  const unlockAudio = () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => {
        console.log('[Audio] AudioContext resumed successfully on window gesture.');
        playWakeUpBeep();
      });
    } else {
      playWakeUpBeep();
    }
  };

  window.addEventListener('click', unlockAudio, { capture: true, passive: true });
  window.addEventListener('touchstart', unlockAudio, { capture: true, passive: true });
});

// Play a microscopic sound on click to force browser AudioContext unlock
function playWakeUpBeep() {
  try {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    // Very quiet (0.005 gain) and very short (0.02s) beep
    gain.gain.setValueAtTime(0.005, audioCtx.currentTime);
    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.02);
  } catch (e) {
    console.warn("Failed to play wake up beep:", e);
  }
}

// Sound Synthesizer for alerts - 3 loud warning beeps
function playAlertSound() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    const startTime = audioCtx.currentTime;
    // Play 3 high-pitch siren pulses spaced 0.4s apart
    for (let i = 0; i < 3; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.type = 'sawtooth';
      // Pitch sweeps down from 950Hz to 350Hz
      osc.frequency.setValueAtTime(950, startTime + (i * 0.4));
      osc.frequency.exponentialRampToValueAtTime(350, startTime + (i * 0.4) + 0.3);
      
      // Volume starts at 0.5 and fades out
      gain.gain.setValueAtTime(0.5, startTime + (i * 0.4));
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + (i * 0.4) + 0.3);
      
      osc.start(startTime + (i * 0.4));
      osc.stop(startTime + (i * 0.4) + 0.35);
    }
    console.log('[Audio] Siren alarm generated successfully.');
  } catch (error) {
    console.error("Audio playback error:", error);
  }
}

// Setup Push Notification Permissions
function setupNotifications() {
  if (!("Notification" in window)) {
    notifyPermBtn.textContent = '🔕 Alerts Not Supported';
    notifyPermBtn.style.color = 'var(--text-tertiary)';
    return;
  }

  // Check if secure context (localhost or HTTPS is required for notifications)
  if (!window.isSecureContext) {
    notifyPermBtn.textContent = '⚠️ Push alerts require Localhost/HTTPS';
    notifyPermBtn.style.color = 'var(--color-warning)';
    return;
  }

  if (Notification.permission === "granted") {
    notifyPermBtn.textContent = '🔔 Alerts Configured';
    notifyPermBtn.style.color = 'var(--color-success)';
  } else if (Notification.permission === "denied") {
    notifyPermBtn.textContent = '🔕 Alerts Blocked (Reset in Browser)';
    notifyPermBtn.style.color = 'var(--color-danger)';
  }

  notifyPermBtn.addEventListener('click', async () => {
    // Play test sound on click to initiate AudioContext unlock
    playAlertSound();
    
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      notifyPermBtn.textContent = '🔔 Alerts Configured';
      notifyPermBtn.style.color = 'var(--color-success)';
      new Notification("System Connected", { body: "Push notifications successfully enabled for IMECS." });
    } else {
      notifyPermBtn.textContent = '🔕 Alerts Blocked (Reset in Browser)';
      notifyPermBtn.style.color = 'var(--color-danger)';
    }
  });
}

// Trigger Local Notification & Vibrate Mobile Phone
function triggerLocalNotification(alertData) {
  // Trigger Browser Push Notification if granted
  if (Notification.permission === "granted") {
    new Notification(`🚨 DISTRESS SOS: ${alertData.sender}`, {
      body: `Location: Lat ${alertData.latitude}, Lng ${alertData.longitude}. Route: ${alertData.chosenChannel}. Battery: ${alertData.batteryLevel}%`,
      tag: alertData.id
    });
  }

  // Trigger Device Vibration (vibrations work on Android devices)
  if (navigator.vibrate) {
    navigator.vibrate([400, 100, 400, 100, 400]);
  }
}

// Initialize Leaflet Map
function initMap() {
  map = L.map('map', {
    zoomControl: true,
    maxZoom: 18,
    minZoom: 10
  }).setView([12.9716, 79.1594], 14);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  drawSimNodes();
}

// Draw initial nodes
function drawSimNodes() {
  nodeMarkers.forEach(m => map.removeLayer(m));
  nodeMarkers = [];

  const icons = {
    base: L.divIcon({ className: '', html: `<div style="background:#9F3FBF; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 0 6px rgba(0,0,0,0.3);"></div>` }),
    tower: L.divIcon({ className: '', html: `<div id="node-tower" style="background:#3B8BD4; width:10px; height:10px; border-radius:50%; border:2px solid white; box-shadow:0 0 6px rgba(0,0,0,0.3);"></div>` }),
    mesh: L.divIcon({ className: '', html: `<div id="node-mesh" style="background:#1D9E75; width:8px; height:8px; border-radius:50%; border:1.5px solid white; box-shadow:0 0 4px rgba(0,0,0,0.3);"></div>` }),
    responder: L.divIcon({ className: '', html: `<div style="background:#E24B4A; width:8px; height:8px; border-radius:50%; border:1.5px solid white; box-shadow:0 0 4px rgba(0,0,0,0.3);"></div>` }),
    drone: L.divIcon({ className: '', html: `<div style="background:#EF9F27; width:9px; height:9px; border-radius:50%; border:1.5px solid white; box-shadow:0 0 4px rgba(0,0,0,0.3); animation: pulse-ring 1s infinite;"></div>` })
  };

  SIM_NODES.forEach(n => {
    let active = true;
    if (n.type === 'tower' && nodeStates.towers === 'offline') active = false;
    if (n.type === 'mesh' && nodeStates.mesh === 'offline') active = false;

    if (active) {
      const marker = L.marker([n.lat, n.lng], { icon: icons[n.type] })
        .bindPopup(`<b>${n.name}</b><br>Type: ${n.type.toUpperCase()}<br>Status: Operational`)
        .addTo(map);
      nodeMarkers.push(marker);
    }
  });

  nodeStates.drones.forEach(d => {
    const marker = L.marker([d.lat, d.lng], { icon: icons.drone })
      .bindPopup(`<b>${d.name}</b><br>Type: Emergency Relay<br>Status: Hovering`)
      .addTo(map);
    nodeMarkers.push(marker);
  });
}

// Get contacts from API
async function loadContacts() {
  try {
    const response = await fetch('/api/contacts');
    if (response.ok) {
      contacts = await response.json();
      renderContacts();
    }
  } catch (error) {
    console.error("Error fetching contacts:", error);
    contactsContainer.innerHTML = `<p style="font-size:12px; color:var(--color-danger); text-align:center; padding:20px;">Failed to load contacts.</p>`;
  }
}

// Render contacts list in sidebar
function renderContacts() {
  contactsBadge.textContent = `${contacts.length} Contacts`;
  
  if (contacts.length === 0) {
    contactsContainer.innerHTML = `<p style="font-size:12px; color:var(--text-tertiary); text-align:center; padding:20px;">No contacts saved. Create one above.</p>`;
    return;
  }

  contactsContainer.innerHTML = contacts.map(c => `
    <div class="contact-card" style="opacity: ${c.active ? 1 : 0.65}">
      <span class="contact-name">${c.name}</span>
      <span class="contact-details">${c.relationship} • ${c.phone}</span>
      
      <div class="contact-toggle">
        <input type="checkbox" id="check-${c.id}" ${c.active ? 'checked' : ''} onchange="toggleContactActive('${c.id}', this.checked)">
      </div>
      
      <div class="contact-actions">
        <button class="btn btn-sm" onclick="editContact('${c.id}')" style="padding: 2px 6px;">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteContact('${c.id}')" style="padding: 2px 6px;">Delete</button>
      </div>
    </div>
  `).join('');
}

// Add/Edit Contact Submit
async function handleContactSubmit(e) {
  e.preventDefault();
  
  const id = editIdInput.value;
  const name = contactNameInput.value.trim();
  const phone = contactPhoneInput.value.trim();
  const relationship = contactRelSelect.value;
  const active = contactActiveCheck.checked;

  const payload = { name, phone, relationship, active };
  
  try {
    let response;
    if (id) {
      response = await fetch(`/api/contacts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      response = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (response.ok) {
      resetContactForm();
      loadContacts();
      addSystemLog(`Contact successfully ${id ? 'updated' : 'added'}: ${name}`, 'success');
    } else {
      const err = await response.json();
      alert(`Error: ${err.error}`);
    }
  } catch (error) {
    console.error("Error submitting contact:", error);
  }
}

function editContact(id) {
  const contact = contacts.find(c => c.id === id);
  if (!contact) return;

  editIdInput.value = contact.id;
  contactNameInput.value = contact.name;
  contactPhoneInput.value = contact.phone;
  contactRelSelect.value = contact.relationship;
  contactActiveCheck.checked = contact.active;

  formSubmitBtn.textContent = 'Update Contact';
  formCancelBtn.style.display = 'inline-flex';
}

function resetContactForm() {
  editIdInput.value = '';
  contactForm.reset();
  formSubmitBtn.textContent = 'Save Contact';
  formCancelBtn.style.display = 'none';
}

async function deleteContact(id) {
  if (!confirm("Are you sure?")) return;
  try {
    const response = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
    if (response.ok) {
      loadContacts();
      addSystemLog("Emergency contact deleted.", "info");
    }
  } catch (error) {
    console.error("Error deleting contact:", error);
  }
}

async function toggleContactActive(id, checked) {
  try {
    await fetch(`/api/contacts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: checked })
    });
    loadContacts();
  } catch (error) {
    console.error("Error updating active state:", error);
  }
}

// Load Alerts History
async function loadAlertHistory() {
  try {
    const response = await fetch('/api/alerts');
    if (response.ok) {
      alertHistory = await response.json();
      renderAlertsLogs();
      if (alertHistory.length > 0) {
        showAlertOnMap(alertHistory[0]);
      }
    }
  } catch (error) {
    console.error("Error loading alert history:", error);
  }
}

// Clear all logs
async function clearAlertLogs() {
  if (!confirm("Are you sure?")) return;
  try {
    const response = await fetch('/api/alerts/clear', { method: 'POST' });
    if (response.ok) {
      alertHistory = [];
      renderAlertsLogs();
      if (alertMarker) {
        map.removeLayer(alertMarker);
        alertMarker = null;
      }
      addSystemLog("Incidents log cleared.", "info");
    }
  } catch (error) {
    console.error(error);
  }
}

// Show alert coordinate position on Map
function showAlertOnMap(alertData) {
  if (alertMarker) {
    map.removeLayer(alertMarker);
  }

  // Update Live Incident & Medical ID Banner
  const banner = document.getElementById('live-incident-banner');
  if (banner) {
    banner.style.display = 'block';
    const mode = alertData.triggerType || 'manual';
    document.getElementById('banner-incident-title').textContent = 
      mode === 'fall' ? '💥 FALL IMPACT DETECTED!' :
      (mode === 'shake' ? '📳 SHAKE GESTURE DETECTED!' : '🚨 DISTRESS SIGNAL DETECTED');
    document.getElementById('banner-trigger-mode').textContent = mode.toUpperCase();
    document.getElementById('banner-incident-time').textContent = new Date(alertData.timestamp).toLocaleTimeString();
    document.getElementById('banner-patient-name').textContent = alertData.sender || 'Unknown';
    
    const med = alertData.medicalProfile || {};
    document.getElementById('banner-blood-group').textContent = `Blood: ${med.bloodGroup || 'N/A'}`;
    document.getElementById('banner-conditions').textContent = (med.chronicConditions || []).join(', ') || 'None';
    document.getElementById('banner-allergies').textContent = (med.allergies || []).join(', ') || 'None';
    
    const count = (alertData.breadcrumbs || []).length || 1;
    document.getElementById('banner-breadcrumbs-count').textContent = `${count} GPS Fixes (Tracking)`;
  }

  // Draw or reset Live Breadcrumb Trail
  if (breadcrumbPolyline) {
    map.removeLayer(breadcrumbPolyline);
  }
  if (alertData.breadcrumbs && alertData.breadcrumbs.length > 0) {
    const latlngs = alertData.breadcrumbs.map(b => [b.latitude, b.longitude]);
    breadcrumbPolyline = L.polyline(latlngs, { color: '#ff3b30', weight: 4, opacity: 0.85, dashArray: '6, 6' }).addTo(map);
  } else {
    breadcrumbPolyline = L.polyline([[alertData.latitude, alertData.longitude]], { color: '#ff3b30', weight: 4, opacity: 0.85, dashArray: '6, 6' }).addTo(map);
  }

  const redPulsatingIcon = L.divIcon({
    className: '',
    html: `
      <div style="position:relative;">
        <div style="background:var(--color-danger); width:18px; height:18px; border-radius:50%; border:3px solid white; box-shadow:0 0 8px var(--color-danger); position:absolute; left:-9px; top:-9px; z-index:100;"></div>
        <div style="background:var(--color-danger); width:36px; height:36px; border-radius:50%; position:absolute; left:-18px; top:-18px; opacity:0.4; animation: pulse-ring 1.5s infinite; pointer-events:none;"></div>
      </div>
    `
  });

  const med = alertData.medicalProfile || {};
  const medInfo = med.bloodGroup ? `<br><b>Blood:</b> ${med.bloodGroup} &bull; <b>Allergies:</b> ${(med.allergies || []).join(', ') || 'None'}` : '';

  alertMarker = L.marker([alertData.latitude, alertData.longitude], { icon: redPulsatingIcon })
    .bindPopup(`
      <div style="font-size:12px;">
        <b style="color:var(--color-danger);">🚨 DISTRESS SIGNAL DETECTED</b><br>
        <b>User:</b> ${alertData.sender}<br>
        <b>Trigger:</b> ${(alertData.triggerType || 'manual').toUpperCase()}<br>
        <b>Location:</b> ${alertData.latitude}, ${alertData.longitude}<br>
        <b>Battery:</b> ${alertData.batteryLevel}% &bull; <b>Route:</b> ${alertData.chosenChannel}${medInfo}<br>
        <b>Time:</b> ${new Date(alertData.timestamp).toLocaleTimeString()}<br>
        <a href="https://www.google.com/maps?q=${alertData.latitude},${alertData.longitude}" target="_blank" style="color:var(--color-info); text-decoration:underline;">Open in Google Maps</a>
      </div>
    `)
    .addTo(map);

  map.setView([alertData.latitude, alertData.longitude], 15);
  alertMarker.openPopup();
}

// Render log items
function renderAlertsLogs() {
  if (alertHistory.length === 0) {
    logFeedContainer.innerHTML = `<div style="font-size:11px; color:var(--text-tertiary); text-align:center; padding:20px;">No alerts triggered. System ready.</div>`;
    return;
  }

  logFeedContainer.innerHTML = alertHistory.map(a => {
    const timeStr = new Date(a.timestamp).toLocaleTimeString();
    return `
      <div class="log-item danger" onclick="zoomToAlert('${a.id}')" style="cursor:pointer;">
        <div class="log-meta">
          <span>🚨 SOS Triggered — ${a.sender}</span>
          <span>${timeStr}</span>
        </div>
        <div class="log-msg" style="margin-bottom: 6px;">
          Channel: <b>${a.chosenChannel}</b> | Lat: ${a.latitude}, Lng: ${a.longitude}
        </div>
        <div style="font-size:9px; border-top:1px solid rgba(0,0,0,0.05); padding-top:4px; display:flex; flex-direction:column; gap:2px;">
          ${a.dispatchLogs.map(dl => `
            <div style="display:flex; justify-content:space-between;">
              <span>To: ${dl.name} (${dl.phone})</span>
              <span style="font-weight:600; color: ${dl.status === 'Sent' || dl.status === 'Simulated' ? 'var(--color-success)' : 'var(--color-danger)'}">${dl.status}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

window.zoomToAlert = function(alertId) {
  const alertItem = alertHistory.find(a => a.id === alertId);
  if (alertItem) showAlertOnMap(alertItem);
};

// Add system log entry
function addSystemLog(message, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const logItem = document.createElement('div');
  logItem.className = `log-item ${type}`;
  logItem.innerHTML = `
    <div class="log-meta">
      <span>⚙️ System Event</span>
      <span>${time}</span>
    </div>
    <div class="log-msg">${message}</div>
  `;
  
  if (logFeedContainer.firstChild && logFeedContainer.firstChild.textContent.includes('No alerts triggered')) {
    logFeedContainer.innerHTML = '';
  }
  logFeedContainer.insertBefore(logItem, logFeedContainer.firstChild);
}

// Load Twilio configurations from server
async function loadSystemSettings() {
  try {
    const response = await fetch('/api/system-info');
    if (response.ok) {
      const data = await response.json();
      
      smsSimulateToggle.checked = data.simulateSms;
      twilioFields.style.display = data.simulateSms ? 'none' : 'flex';
      
      if (data.hasTwilio && !data.simulateSms) {
        smsGateStatus.textContent = 'Active Carrier';
        smsGateStatus.className = 'badge badge-success';
      } else {
        smsGateStatus.textContent = 'Simulated';
        smsGateStatus.className = 'badge badge-warning';
      }
      
      // Load partially hidden values
      if (data.twilioDetails) {
        if (data.twilioDetails.sid) twilioSidInput.placeholder = `${data.twilioDetails.sid} (Saved)`;
        twilioPhoneInput.value = data.twilioDetails.phone || '';
      }
    }
  } catch (error) {
    console.error("Error getting settings:", error);
  }
}

// Update SMS Gateway Settings API
async function handleGateConfigSubmit(e) {
  e.preventDefault();
  
  const simulateSms = smsSimulateToggle.checked;
  const twilioSid = twilioSidInput.value.trim();
  const twilioToken = twilioTokenInput.value.trim();
  const twilioPhone = twilioPhoneInput.value.trim();

  // Validate if not simulating
  if (!simulateSms && (!twilioSid && twilioSidInput.placeholder.indexOf('Saved') === -1 || !twilioPhone)) {
    alert("Twilio SID, Token, and Phone are required when Simulation is disabled!");
    return;
  }

  const payload = {
    simulateSms,
    twilioPhone
  };
  
  if (twilioSid) payload.twilioSid = twilioSid;
  if (twilioToken) payload.twilioToken = twilioToken;

  try {
    const response = await fetch('/api/system-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const data = await response.json();
      addSystemLog("Twilio SMS configuration updated successfully.", "success");
      
      if (data.hasTwilio && !data.simulateSms) {
        smsGateStatus.textContent = 'Active Carrier';
        smsGateStatus.className = 'badge badge-success';
      } else {
        smsGateStatus.textContent = 'Simulated';
        smsGateStatus.className = 'badge badge-warning';
      }
      
      twilioSidInput.value = '';
      twilioTokenInput.value = '';
      loadSystemSettings();
      alert("SMS Gateway configuration updated successfully!");
    } else {
      alert("Failed to update gateway settings.");
    }
  } catch (error) {
    console.error(error);
  }
}

// Setup SSE Listener
function setupSSE() {
  const source = new EventSource('/api/alerts/stream');

  source.addEventListener('sos_triggered', (event) => {
    const alertData = JSON.parse(event.data);
    
    // Save locally
    alertHistory.unshift(alertData);
    renderAlertsLogs();
    showAlertOnMap(alertData);
    
    // Sound & native browser alert
    playAlertSound();
    triggerLocalNotification(alertData);
    
    const triggerLabel = (alertData.triggerType || 'manual').toUpperCase();
    addSystemLog(`INCOMING ${triggerLabel} SOS: Triggered phone alerts for ${alertData.contactsNotifiedCount} active contacts.`, 'danger');
  });

  // Handle live breadcrumbs movement stream
  source.addEventListener('sos_breadcrumb', (event) => {
    const data = JSON.parse(event.data);
    const { breadcrumb, alert } = data;
    
    if (alertMarker) {
      alertMarker.setLatLng([breadcrumb.latitude, breadcrumb.longitude]);
    }
    if (breadcrumbPolyline) {
      breadcrumbPolyline.addLatLng([breadcrumb.latitude, breadcrumb.longitude]);
    }
    
    const countEl = document.getElementById('banner-breadcrumbs-count');
    if (countEl && alert && alert.breadcrumbs) {
      countEl.textContent = `${alert.breadcrumbs.length} GPS Fixes (Tracking)`;
    }
    addSystemLog(`Live Breadcrumb Update: Lat ${breadcrumb.latitude}, Lng ${breadcrumb.longitude}`, 'info');
  });

  source.addEventListener('logs_cleared', () => {
    alertHistory = [];
    renderAlertsLogs();
    if (alertMarker) {
      map.removeLayer(alertMarker);
      alertMarker = null;
    }
    if (breadcrumbPolyline) {
      map.removeLayer(breadcrumbPolyline);
      breadcrumbPolyline = null;
    }
    const banner = document.getElementById('live-incident-banner');
    if (banner) banner.style.display = 'none';
  });

  source.onerror = (err) => {
    console.error("SSE connection closed/error:", err);
  };
}

// Medical Profile Modal Handler
window.openMedicalModal = async function() {
  const modal = document.getElementById('medical-modal');
  const content = document.getElementById('modal-medical-content');
  if (!modal || !content) return;
  modal.style.display = 'flex';
  content.innerHTML = '<p>Loading patient medical details...</p>';

  try {
    const res = await fetch('/api/medical-profile');
    if (res.ok) {
      const p = await res.json();
      content.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h4 style="font-size:15px; font-weight:800; color:var(--text-primary);">${p.fullName || 'Registered Patient'}</h4>
            <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">Age: ${p.age || '--'} &bull; Policy ID: ${p.insuranceId || 'None'}</div>
          </div>
          <span style="background:#fee2e2; color:#991b1b; padding:4px 10px; border-radius:6px; font-weight:800; font-size:13px;">Blood: ${p.bloodGroup || 'N/A'}</span>
        </div>
        <div style="margin-bottom:8px;"><b>Chronic Conditions:</b> ${(p.chronicConditions || []).join(', ') || 'None recorded'}</div>
        <div style="margin-bottom:8px;"><b>Known Allergies:</b> <span style="color:var(--color-danger); font-weight:700;">${(p.allergies || []).join(', ') || 'None'}</span></div>
        <div style="margin-bottom:8px;"><b>Active Medications:</b> ${(p.medications || []).join('; ') || 'None'}</div>
        <div style="margin-bottom:8px;"><b>Primary Physician:</b> ${p.primaryPhysician || 'None'}</div>
        <div style="background:var(--bg-secondary); padding:10px 14px; border-radius:8px; margin-top:10px; border:1px solid var(--border-primary);">
          <b>Emergency Protocols & Responder Notes:</b><br>${p.emergencyNotes || 'None'}
        </div>
      `;
    } else {
      content.innerHTML = '<p style="color:var(--color-danger);">Failed to retrieve profile.</p>';
    }
  } catch (e) {
    content.innerHTML = '<p style="color:var(--color-danger);">Connection error.</p>';
  }
};

window.closeMedicalModal = function() {
  const modal = document.getElementById('medical-modal');
  if (modal) modal.style.display = 'none';
};

// Metrics calculations
function updateMetricsUI() {
  mNodes.textContent = activeNodesCount;
  mHops.textContent = relayHops.toFixed(1);
  mCov.textContent = `${coveragePercent}%`;
  mLat.textContent = `${latencyMs}ms`;

  mNodes.style.color = activeNodesCount >= 10 ? 'var(--color-success)' : activeNodesCount >= 6 ? 'var(--color-warning)' : 'var(--color-danger)';
  mCov.style.color = coveragePercent >= 80 ? 'var(--color-success)' : coveragePercent >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
  mLat.style.color = latencyMs <= 50 ? 'var(--color-success)' : latencyMs <= 100 ? 'var(--color-warning)' : 'var(--color-danger)';

  if (disruptionLevel > 50) {
    systemAlertStatus.textContent = 'CRITICAL';
    systemAlertStatus.className = 'badge badge-danger';
    systemStatusDot.className = 'status-dot danger';
  } else if (disruptionLevel > 15) {
    systemAlertStatus.textContent = 'ELEVATED';
    systemAlertStatus.className = 'badge badge-warning';
    systemStatusDot.className = 'status-dot';
    systemStatusDot.style.background = 'var(--color-warning)';
    systemStatusDot.style.boxShadow = '0 0 8px var(--color-warning)';
  } else {
    systemAlertStatus.textContent = 'NORMAL OPS';
    systemAlertStatus.className = 'badge badge-success';
    systemStatusDot.className = 'status-dot';
    systemStatusDot.style.background = 'var(--color-success)';
    systemStatusDot.style.boxShadow = '0 0 8px var(--color-success)';
  }
}

// Trigger simulation
window.triggerSimEvent = function(type) {
  if (type === 'blackout') {
    if (nodeStates.towers === 'offline') return;
    nodeStates.towers = 'offline';
    activeNodesCount -= 3;
    coveragePercent -= 25;
    latencyMs += 40;
    relayHops += 0.8;
    disruptionLevel += 30;
    addSystemLog("Simulated Cell Tower Blackout! Cellular routing degraded.", "danger");
  } else if (type === 'flood') {
    if (nodeStates.mesh === 'offline') return;
    nodeStates.mesh = 'offline';
    activeNodesCount -= 3;
    coveragePercent -= 30;
    latencyMs += 50;
    relayHops += 1.2;
    disruptionLevel += 40;
    addSystemLog("Simulated Flood Event! 3 LoRa nodes submerged.", "danger");
  } else if (type === 'drone') {
    const droneId = nodeStates.drones.length + 1;
    const lat = 12.9730 + (Math.random() - 0.5) * 0.01;
    const lng = 79.1594 + (Math.random() - 0.5) * 0.01;
    nodeStates.drones.push({ id: droneId, name: `Relay Drone #${droneId}`, lat, lng });
    activeNodesCount += 1;
    coveragePercent = Math.min(100, coveragePercent + 15);
    latencyMs = Math.max(25, latencyMs - 15);
    relayHops = Math.max(1.0, relayHops - 0.4);
    disruptionLevel = Math.max(0, disruptionLevel - 20);
    addSystemLog(`Deployed Relay Drone #${droneId} link interface.`, "success");
  } else if (type === 'restore') {
    activeNodesCount = 12;
    relayHops = 2.4;
    coveragePercent = 94;
    latencyMs = 38;
    disruptionLevel = 0;
    nodeStates = { towers: 'active', mesh: 'active', drones: [] };
    addSystemLog("All channels and relays fully restored.", "success");
  }
  drawSimNodes();
  updateMetricsUI();
};
