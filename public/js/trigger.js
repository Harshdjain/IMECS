// IMECS SOS PWA Client Script (Real-Life Sensor & Emergency Suite)

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('IMECS PWA Service Worker registered:', reg.scope))
      .catch(err => console.error('Service Worker registration failed:', err));
  });
}

// State variables
let coordinates = { latitude: 12.9716, longitude: 79.1594 }; // Default to VIT Vellore
let batteryLevel = 85;
let signalStrength = -75; // dBm
let latency = 45; // ms
let contacts = [];
let medicalProfile = null;
let systemMode = 'Ready';
let countdownInterval = null;
let currentScoreChannel = 'cellular';
let serverStatus = 'Offline';
let currentTriggerMode = 'manual';
let activeAlertId = null;
let breadcrumbInterval = null;

// Sensor & Bystander States
let shakeEnabled = true;
let bystanderSirenActive = false;
let sirenAudioCtx = null;
let sirenOscillator = null;

// Constants for decision calculations
const WEIGHT_SIGNAL = 0.30;
const WEIGHT_LATENCY = 0.25;
const WEIGHT_BATTERY = 0.20;
const WEIGHT_SUCCESS = 0.25;

// DOM Elements
const gpsPos = document.getElementById('gps-pos');
const battLev = document.getElementById('batt-lev');
const triggerSosBtn = document.getElementById('trigger-sos-btn');
const stopSosBtn = document.getElementById('stop-sos-btn');
const pwaCountdownOverlay = document.getElementById('pwa-countdown-overlay');
const pwaCountdownNum = document.getElementById('pwa-countdown-num');
const countdownTitle = document.getElementById('countdown-title');
const countdownSub = document.getElementById('countdown-sub');
const sysModeBadge = document.getElementById('sys-mode-badge');
const offlineBadge = document.getElementById('offline-badge');
const offlineQueueStatus = document.getElementById('offline-queue-status');

// Diagnostic UI Elements
const diagSignal = document.getElementById('diag-signal');
const diagLatency = document.getElementById('diag-latency');
const diagHandshake = document.getElementById('diag-handshake');
const diagSms = document.getElementById('diag-sms');
const pwaContactsContainer = document.getElementById('pwa-contacts-container');

// Channel Score UI Bars
const barCell = document.getElementById('bar-cell');
const valCell = document.getElementById('val-cell');
const barSms = document.getElementById('bar-sms');
const valSms = document.getElementById('val-sms');
const barMesh = document.getElementById('bar-mesh');
const valMesh = document.getElementById('val-mesh');

// Medical Profile UI
const medBloodBadge = document.getElementById('med-blood-badge');
const medNameDisplay = document.getElementById('med-name-display');
const medSubDisplay = document.getElementById('med-sub-display');
const medConditionsBadges = document.getElementById('med-conditions-badges');
const medAllergiesBadges = document.getElementById('med-allergies-badges');
const medMedicationsList = document.getElementById('med-medications-list');
const medNotesDisplay = document.getElementById('med-notes-display');
const medicalEditForm = document.getElementById('medical-edit-form');

// View Tab Navigation
window.switchView = function(viewName, clickedEl) {
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  
  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.add('active');
  if (clickedEl) clickedEl.classList.add('active');
  
  if (viewName === 'contacts') {
    fetchContactsList();
  } else if (viewName === 'medical') {
    fetchMedicalProfile();
  }
};

// Initialize Application
function initApp() {
  setupBattery();
  setupGeolocation();
  fetchMedicalProfile();
  setupNetworkListeners();
  setupShakeDetection();
  pingServer();
  
  // Scoring updates
  evaluateChannels();
  setInterval(() => {
    evaluateChannels();
    pingServer();
  }, 3000);
  
  // Event listeners
  const sosBtn = document.getElementById('trigger-sos-btn');
  const cancelBtn = document.getElementById('stop-sos-btn');
  if (sosBtn) sosBtn.onclick = () => startSOSCountdown('manual');
  if (cancelBtn) cancelBtn.onclick = cancelSOSCountdown;
  
  // Check offline queue
  updateOfflineQueueUI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Setup Network Listeners & Offline Queue Sync
function setupNetworkListeners() {
  const updateOnlineStatus = () => {
    if (navigator.onLine) {
      if (offlineBadge) offlineBadge.style.display = 'none';
      syncOfflineQueue();
    } else {
      if (offlineBadge) offlineBadge.style.display = 'inline-block';
    }
  };
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
}

function updateOfflineQueueUI() {
  const queue = JSON.parse(localStorage.getItem('imecs_offline_queue') || '[]');
  if (offlineQueueStatus) {
    offlineQueueStatus.textContent = `${queue.length} Queued`;
    offlineQueueStatus.className = queue.length > 0 ? 'sys-badge sending' : 'sys-badge ready';
  }
}

async function syncOfflineQueue() {
  const queue = JSON.parse(localStorage.getItem('imecs_offline_queue') || '[]');
  if (queue.length === 0) return;

  console.log(`[Offline Sync] Attempting to flush ${queue.length} queued alert(s)...`);
  const remaining = [];
  for (const alertPayload of queue) {
    try {
      const res = await fetch('/api/sos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alertPayload)
      });
      if (!res.ok) remaining.push(alertPayload);
    } catch (e) {
      remaining.push(alertPayload);
    }
  }
  localStorage.setItem('imecs_offline_queue', JSON.stringify(remaining));
  updateOfflineQueueUI();
}

// Setup Battery Level
function setupBattery() {
  if (navigator.getBattery) {
    navigator.getBattery().then(batt => {
      updateBatteryUI(batt.level * 100);
      batt.addEventListener('levelchange', () => {
        updateBatteryUI(batt.level * 100);
      });
    });
  } else {
    updateBatteryUI(Math.floor(70 + Math.random() * 25));
  }
}

function updateBatteryUI(level) {
  batteryLevel = Math.round(level);
  if (battLev) battLev.textContent = `${batteryLevel}%`;
}

// Setup Geolocation & Continuous Watcher
function setupGeolocation() {
  if (navigator.geolocation) {
    gpsPos.textContent = "Acquiring Fix...";
    navigator.geolocation.watchPosition(
      (position) => {
        coordinates.latitude = parseFloat(position.coords.latitude.toFixed(6));
        coordinates.longitude = parseFloat(position.coords.longitude.toFixed(6));
        gpsPos.innerHTML = `${coordinates.latitude}, ${coordinates.longitude}`;
      },
      (error) => {
        console.warn("Using simulated coordinates:", error);
        gpsPos.innerHTML = `${coordinates.latitude} (Sim), ${coordinates.longitude} (Sim)`;
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  } else {
    gpsPos.innerHTML = `${coordinates.latitude} (Sim), ${coordinates.longitude} (Sim)`;
  }
}

// ==========================================
// ACCELEROMETER SHAKE DETECTION
// ==========================================
let lastX, lastY, lastZ;
let lastShakeTime = 0;
let shakeCount = 0;

function setupShakeDetection() {
  if (!window.DeviceMotionEvent) return;

  window.addEventListener('devicemotion', (event) => {
    if (!shakeEnabled || systemMode === 'Alerting' || systemMode === 'Dispatched') return;

    const acc = event.accelerationIncludingGravity || event.acceleration;
    if (!acc) return;

    const curTime = Date.now();
    if ((curTime - lastShakeTime) > 100) {
      const diffTime = curTime - lastShakeTime;
      lastShakeTime = curTime;

      const speed = Math.abs(acc.x + acc.y + acc.z - (lastX || 0) - (lastY || 0) - (lastZ || 0)) / diffTime * 10000;

      if (speed > 2500) { // Threshold for vigorous shaking
        shakeCount++;
        if (shakeCount >= 2) {
          shakeCount = 0;
          console.log('[Sensor] Vigorous shake detected -> Triggering SOS Countdown!');
          startSOSCountdown('shake');
        }
      } else {
        shakeCount = Math.max(0, shakeCount - 0.2);
      }

      lastX = acc.x;
      lastY = acc.y;
      lastZ = acc.z;
    }
  });
}

window.toggleShakeFeature = function(enabled) {
  shakeEnabled = enabled;
  if (enabled && typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission().then(response => {
      console.log('[iOS Permission] Shake motion permission:', response);
    }).catch(console.error);
  }
};

// ==========================================
// SIMULATED FALL DETECTION
// ==========================================
window.simulateFallEvent = function() {
  console.log('[Sensor] Simulating sudden drop/impact...');
  startSOSCountdown('fall');
};

// ==========================================
// SPEED DIAL RECORDER
// ==========================================
window.recordSpeedDial = function(serviceName) {
  console.log(`[Speed Dial] Calling ${serviceName}`);
  // Dispatch a lightweight ping to the backend logging speed dial use
  fetch('/api/sos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      senderName: `Elderly User (${serviceName})`,
      batteryLevel: batteryLevel,
      signalStrength: signalStrength,
      latency: latency,
      chosenChannel: 'Direct Cellular Voice',
      triggerType: 'speed_dial',
      isSimulated: true
    })
  }).catch(() => {});
};

// ==========================================
// AUDIBLE BYSTANDER SIREN & FLASH STROBE
// ==========================================
window.toggleBystanderSiren = function() {
  bystanderSirenActive = !bystanderSirenActive;
  const btn = document.getElementById('btn-toggle-siren');
  const btnText = document.getElementById('siren-btn-text');

  if (bystanderSirenActive) {
    document.body.classList.add('strobe-active');
    btn.classList.add('active');
    btnText.textContent = 'Stop Siren';
    startSirenSound();
  } else {
    document.body.classList.remove('strobe-active');
    btn.classList.remove('active');
    btnText.textContent = 'Bystander Siren';
    stopSirenSound();
  }
};

function startSirenSound() {
  try {
    if (!sirenAudioCtx) {
      sirenAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (sirenAudioCtx.state === 'suspended') {
      sirenAudioCtx.resume();
    }

    const osc = sirenAudioCtx.createOscillator();
    const gain = sirenAudioCtx.createGain();
    osc.type = 'sawtooth';
    osc.connect(gain);
    gain.connect(sirenAudioCtx.destination);

    // Loud repeating siren frequency sweep
    gain.gain.setValueAtTime(0.7, sirenAudioCtx.currentTime);
    const now = sirenAudioCtx.currentTime;
    for (let i = 0; i < 30; i++) {
      osc.frequency.setValueAtTime(650, now + i * 0.5);
      osc.frequency.linearRampToValueAtTime(1200, now + i * 0.5 + 0.25);
      osc.frequency.linearRampToValueAtTime(650, now + i * 0.5 + 0.5);
    }
    osc.start();
    sirenOscillator = osc;
  } catch (e) {
    console.error('Audio siren error:', e);
  }
}

function stopSirenSound() {
  try {
    if (sirenOscillator) {
      sirenOscillator.stop();
      sirenOscillator.disconnect();
      sirenOscillator = null;
    }
  } catch (e) {}
}

// ==========================================
// MEDICAL PROFILE API CALLS & UI
// ==========================================
async function fetchMedicalProfile() {
  try {
    const res = await fetch('/api/medical-profile');
    if (res.ok) {
      medicalProfile = await res.json();
      renderMedicalProfile();
    }
  } catch (e) {
    console.error('Failed to load medical profile:', e);
  }
}

function renderMedicalProfile() {
  if (!medicalProfile) return;

  if (medBloodBadge) medBloodBadge.textContent = `Blood: ${medicalProfile.bloodGroup || 'Unknown'}`;
  if (medNameDisplay) medNameDisplay.textContent = medicalProfile.fullName || 'Registered Patient';
  if (medSubDisplay) medSubDisplay.textContent = `Age: ${medicalProfile.age || '--'} • Insurance: ${medicalProfile.insuranceId || 'None'}`;

  if (medConditionsBadges) {
    const conds = medicalProfile.chronicConditions || [];
    medConditionsBadges.innerHTML = conds.map(c => `<span class="medical-badge badge-cond">${c}</span>`).join('') || '<span style="font-size:11px; color:var(--text-sub);">None recorded</span>';
  }

  if (medAllergiesBadges) {
    const algs = medicalProfile.allergies || [];
    medAllergiesBadges.innerHTML = algs.map(a => `<span class="medical-badge badge-allergy">${a}</span>`).join('') || '<span style="font-size:11px; color:var(--text-sub);">None</span>';
  }

  if (medMedicationsList) {
    const meds = medicalProfile.medications || [];
    medMedicationsList.innerHTML = meds.map(m => `<div>• ${m}</div>`).join('') || '<div>None active</div>';
  }

  if (medNotesDisplay) {
    medNotesDisplay.innerHTML = `<b>Doctor:</b> ${medicalProfile.primaryPhysician || 'None'}<br><b>Notes:</b> ${medicalProfile.emergencyNotes || 'None'}`;
  }

  // Pre-fill edit form
  document.getElementById('input-med-name').value = medicalProfile.fullName || '';
  document.getElementById('input-med-age').value = medicalProfile.age || '';
  document.getElementById('input-med-blood').value = medicalProfile.bloodGroup || '';
  document.getElementById('input-med-conds').value = (medicalProfile.chronicConditions || []).join(', ');
  document.getElementById('input-med-allergies').value = (medicalProfile.allergies || []).join(', ');
  document.getElementById('input-med-doctor').value = medicalProfile.primaryPhysician || '';
  document.getElementById('input-med-notes').value = medicalProfile.emergencyNotes || '';
}

window.toggleMedicalEditor = function() {
  if (!medicalEditForm) return;
  medicalEditForm.style.display = medicalEditForm.style.display === 'none' ? 'block' : 'none';
};

window.saveMedicalProfile = async function(e) {
  e.preventDefault();
  const updated = {
    fullName: document.getElementById('input-med-name').value.trim(),
    age: parseInt(document.getElementById('input-med-age').value) || 70,
    bloodGroup: document.getElementById('input-med-blood').value.trim(),
    chronicConditions: document.getElementById('input-med-conds').value.split(',').map(s => s.trim()).filter(Boolean),
    allergies: document.getElementById('input-med-allergies').value.split(',').map(s => s.trim()).filter(Boolean),
    primaryPhysician: document.getElementById('input-med-doctor').value.trim(),
    emergencyNotes: document.getElementById('input-med-notes').value.trim(),
    medications: medicalProfile ? medicalProfile.medications : [],
    insuranceId: medicalProfile ? medicalProfile.insuranceId : ''
  };

  try {
    const res = await fetch('/api/medical-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
    if (res.ok) {
      medicalProfile = updated;
      renderMedicalProfile();
      toggleMedicalEditor();
      alert('Medical ID Profile updated successfully!');
    }
  } catch (err) {
    console.error('Error saving medical profile:', err);
  }
};

// ==========================================
// CAREGIVER CONTACTS
// ==========================================
async function fetchContactsList() {
  try {
    const res = await fetch('/api/contacts');
    if (res.ok) {
      contacts = await res.json();
      renderContactsPWA();
    }
  } catch (error) {
    pwaContactsContainer.innerHTML = `<p style="font-size:12px; color:#d9383a; text-align:center; padding:20px;">Could not connect to database.</p>`;
  }
}

function renderContactsPWA() {
  if (contacts.length === 0) {
    pwaContactsContainer.innerHTML = `<p style="font-size:12px; color:var(--text-sub); text-align:center; padding:20px;">No emergency contacts added yet.</p>`;
    return;
  }

  pwaContactsContainer.innerHTML = contacts.map(c => {
    const initial = c.name ? c.name.charAt(0).toUpperCase() : '?';
    return `
      <div style="display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--border-color); opacity:${c.active ? 1 : 0.55}">
        <div style="width:34px; height:34px; border-radius:50%; background:var(--accent-red-light); color:var(--accent-red); font-weight:700; display:flex; align-items:center; justify-content:center;">${initial}</div>
        <div style="flex:1;">
          <div style="font-size:13px; font-weight:700;">${c.name}</div>
          <div style="font-size:11px; color:var(--text-sub);">${c.relationship} • ${c.phone}</div>
        </div>
        <span class="sys-badge ${c.active ? 'ready' : 'sending'}" style="font-size:9px; padding:2px 8px;">
          ${c.active ? 'Active' : 'Muted'}
        </span>
      </div>
    `;
  }).join('');
}

// Ping Server to check handshake connection
async function pingServer() {
  try {
    const res = await fetch('/api/system-info');
    if (res.ok) {
      const data = await res.json();
      serverStatus = 'Online';
      diagHandshake.textContent = 'Connected (0.0.0.0)';
      diagHandshake.style.color = '#1b8552';
      diagSms.textContent = data.simulateSms ? 'Simulated logs' : 'Active Carrier (Twilio)';
      diagSms.style.color = data.simulateSms ? '#c27803' : '#1b8552';
    }
  } catch (error) {
    serverStatus = 'Offline';
    diagHandshake.textContent = 'Server Unreachable';
    diagHandshake.style.color = '#d9383a';
  }
}

// Evaluate channels dynamically
function evaluateChannels() {
  signalStrength = Math.round(-65 - Math.random() * 40);
  latency = Math.round(25 + Math.random() * 110);
  
  if (diagSignal) diagSignal.textContent = `${signalStrength} dBm`;
  if (diagLatency) diagLatency.textContent = `${latency} ms`;

  let cellSignalScore = Math.max(0, Math.min(100, ((signalStrength + 110) / 60) * 100));
  let cellLatencyScore = Math.max(0, Math.min(100, ((300 - latency) / 280) * 100));
  let cellSuccessRate = 94;
  let cellScore = Math.round((cellSignalScore * WEIGHT_SIGNAL) + (cellLatencyScore * WEIGHT_LATENCY) + (batteryLevel * WEIGHT_BATTERY) + (cellSuccessRate * WEIGHT_SUCCESS));

  let smsSignalScore = Math.max(0, Math.min(100, ((signalStrength + 120) / 70) * 100));
  let smsLatencyScore = 15;
  let smsSuccessRate = 98;
  let smsScore = Math.round((smsSignalScore * WEIGHT_SIGNAL) + (smsLatencyScore * WEIGHT_LATENCY) + (batteryLevel * WEIGHT_BATTERY) + (smsSuccessRate * WEIGHT_SUCCESS));

  let meshSignalScore = 80;
  let meshLatencyScore = 40;
  let meshSuccessRate = 78;
  let meshScore = Math.round((meshSignalScore * WEIGHT_SIGNAL) + (meshLatencyScore * WEIGHT_LATENCY) + (batteryLevel * WEIGHT_BATTERY) + (meshSuccessRate * WEIGHT_SUCCESS));

  updateBar(barCell, valCell, cellScore);
  updateBar(barSms, valSms, smsScore);
  updateBar(barMesh, valMesh, meshScore);

  if (cellScore >= smsScore && cellScore >= meshScore) {
    currentScoreChannel = 'Cellular Data';
  } else if (smsScore >= cellScore && smsScore >= meshScore) {
    currentScoreChannel = 'SMS Gateway';
  } else {
    currentScoreChannel = 'LoRa Mesh';
  }
}

function updateBar(barEl, valEl, score) {
  if (barEl) barEl.style.width = `${score}%`;
  if (valEl) valEl.textContent = score;
}

// ==========================================
// SOS COUNTDOWN & DISPATCH
// ==========================================
function startSOSCountdown(mode = 'manual') {
  currentTriggerMode = mode;
  systemMode = 'Alerting';
  
  const badge = document.getElementById('sys-mode-badge');
  if (badge) {
    badge.className = 'sys-badge ready';
    badge.style.background = '#fff1f0';
    badge.style.color = '#cf1322';
    badge.textContent = 'Countdown (5s)';
  }

  const titleEl = document.getElementById('countdown-title');
  const subEl = document.getElementById('countdown-sub');
  if (mode === 'fall') {
    if (titleEl) titleEl.textContent = '💥 FALL DETECTED!';
    if (subEl) subEl.textContent = 'Impact threshold exceeded. Initiating emergency rescue alert in...';
  } else if (mode === 'shake') {
    if (titleEl) titleEl.textContent = '📳 SHAKE TRIGGER DETECTED!';
    if (subEl) subEl.textContent = 'Rapid gesture registered. Dispatching emergency alert in...';
  } else {
    if (titleEl) titleEl.textContent = '🚨 SOS BUTTON PRESSED';
    if (subEl) subEl.textContent = 'Dispatching distress signal and Medical ID to caregivers in...';
  }
  
  let count = 5;
  const numEl = document.getElementById('pwa-countdown-num');
  const overlayEl = document.getElementById('pwa-countdown-overlay');
  const btnMain = document.getElementById('sos-btn-main-text');

  if (numEl) numEl.textContent = count;
  if (btnMain) btnMain.textContent = '🚨 ' + count;
  if (overlayEl) {
    overlayEl.classList.add('active');
    overlayEl.style.display = 'flex';
  }
  
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    count--;
    if (count > 0) {
      if (numEl) numEl.textContent = count;
      if (btnMain) btnMain.textContent = '🚨 ' + count;
      if (badge) badge.textContent = `Countdown (${count}s)`;
    } else {
      clearInterval(countdownInterval);
      dispatchPWASOS();
    }
  }, 1000);
}

function cancelSOSCountdown() {
  clearInterval(countdownInterval);
  
  const overlayEl = document.getElementById('pwa-countdown-overlay');
  if (overlayEl) {
    overlayEl.classList.remove('active');
    overlayEl.style.display = 'none';
  }
  
  const btnMain = document.getElementById('sos-btn-main-text');
  if (btnMain) btnMain.textContent = 'SOS';

  systemMode = 'Ready';
  const badge = document.getElementById('sys-mode-badge');
  if (badge) {
    badge.className = 'sys-badge ready';
    badge.style.background = 'var(--accent-red-light)';
    badge.style.color = 'var(--accent-red)';
    badge.textContent = 'Ready';
  }

  // Stop breadcrumb live updates if canceled
  if (breadcrumbInterval) {
    clearInterval(breadcrumbInterval);
    breadcrumbInterval = null;
  }
}

// Expose globally for HTML onclick handlers
window.startSOSCountdown = startSOSCountdown;
window.cancelSOSCountdown = cancelSOSCountdown;

// Send SOS REST trigger & activate Live Breadcrumb transmission
async function dispatchPWASOS() {
  const overlayEl = document.getElementById('pwa-countdown-overlay');
  if (overlayEl) {
    overlayEl.classList.remove('active');
    overlayEl.style.display = 'none';
  }

  const btnMain = document.getElementById('sos-btn-main-text');
  if (btnMain) btnMain.textContent = 'SENT';

  const badge = document.getElementById('sys-mode-badge');
  if (badge) badge.textContent = 'Sending...';
  
  const payload = {
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    senderName: medicalProfile && medicalProfile.fullName ? medicalProfile.fullName : "Elderly User (Mobile PWA)",
    batteryLevel: batteryLevel,
    signalStrength: signalStrength,
    latency: latency,
    chosenChannel: currentScoreChannel,
    triggerType: currentTriggerMode,
    isSimulated: false
  };

  try {
    const res = await fetch('/api/sos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      systemMode = 'Dispatched';
      sysModeBadge.className = 'sys-badge sent';
      sysModeBadge.style.background = '#e6f7ff';
      sysModeBadge.style.color = '#1890ff';
      sysModeBadge.textContent = 'Dispatched';

      activeAlertId = data.alert.id;
      startBreadcrumbTransmitter(activeAlertId);

      alert(`Distress Alert Sent Successfully!\nMode: ${currentTriggerMode.toUpperCase()}\nPathway: ${payload.chosenChannel}\nLive tracking breadcrumbs active.`);
    } else {
      throw new Error('Server returned error');
    }
  } catch (error) {
    console.warn("Network failed -> Queueing in offline storage", error);
    const queue = JSON.parse(localStorage.getItem('imecs_offline_queue') || '[]');
    queue.push(payload);
    localStorage.setItem('imecs_offline_queue', JSON.stringify(queue));
    updateOfflineQueueUI();

    systemMode = 'Queued';
    sysModeBadge.className = 'sys-badge offline';
    sysModeBadge.textContent = 'Queued Offline';
    alert(`Alert Queued in Offline Storage!\nNetwork is unavailable. The distress signal will be dispatched automatically as soon as connectivity resumes.`);
  }
}

// Periodic Breadcrumb Transmitter
function startBreadcrumbTransmitter(alertId) {
  if (breadcrumbInterval) clearInterval(breadcrumbInterval);

  breadcrumbInterval = setInterval(() => {
    // Transmit slight movement variation to demonstrate real-time movement trajectory
    const latDelta = (Math.random() - 0.5) * 0.0004;
    const lngDelta = (Math.random() - 0.5) * 0.0004;
    const liveLat = parseFloat((coordinates.latitude + latDelta).toFixed(6));
    const liveLng = parseFloat((coordinates.longitude + lngDelta).toFixed(6));

    fetch(`/api/sos/${alertId}/breadcrumb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: liveLat, longitude: liveLng })
    }).catch(err => console.log('[Breadcrumb] Error sending live point:', err));
  }, 10000);
}
