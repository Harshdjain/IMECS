// IMECS SOS PWA Client Script with Microsoft Azure IoT & Health Telemetry

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('IMECS PWA Service Worker registered:', reg.scope))
      .catch(err => console.error('Service Worker registration failed:', err));
  });
}

// State variables
let coordinates = { latitude: 12.9716, longitude: 79.1594 }; // Default VIT Vellore coordinates
let batteryLevel = 88;
let signalStrength = -72; // dBm
let latency = 38; // ms
let currentScoreChannel = 'Cellular Data';
let serverStatus = 'Offline';
let currentTriggerType = 'manual_sos';
let countdownInterval = null;

// Health Vitals (Azure IoT Hub Connected)
let vitals = {
  heartRate: 76,
  bloodOxygen: 98,
  skinTemp: 36.8,
  fallDetected: false,
  impactGForce: 1.02
};

// Medical Profile & Safe Zone
let medicalProfile = null;
let isOutsideSafeZone = false;
let safeZoneDistanceMeters = 0;

// Audio Recording (Voice Memo)
let mediaRecorder = null;
let audioChunks = [];
let voiceMemoBase64 = null;
let isRecordingVoice = false;

// DOM Elements
const gpsPos = document.getElementById('gps-pos');
const safezoneIcon = document.getElementById('safezone-icon');
const safezoneText = document.getElementById('safezone-text');
const triggerSosBtn = document.getElementById('trigger-sos-btn');
const stopSosBtn = document.getElementById('stop-sos-btn');
const simulateFallBtn = document.getElementById('simulate-fall-btn');

// Vitals DOM Elements
const vitHr = document.getElementById('vit-hr');
const vitSpo2 = document.getElementById('vit-spo2');
const vitTemp = document.getElementById('vit-temp');
const vitalsPageHr = document.getElementById('vitals-page-hr');
const vitalsPageSpo2 = document.getElementById('vitals-page-spo2');
const vitalsPageTemp = document.getElementById('vitals-page-temp');
const vitalsPageGforce = document.getElementById('vitals-page-gforce');
const simTachycardiaBtn = document.getElementById('sim-tachycardia-btn');
const simNormalVitalsBtn = document.getElementById('sim-normalvitals-btn');

// Voice Memo Elements
const voiceRecordBtn = document.getElementById('voice-record-btn');
const voiceMemoStatus = document.getElementById('voice-memo-status');
const voiceAudioPreview = document.getElementById('voice-audio-preview');
const micIcon = document.getElementById('mic-icon');
const micText = document.getElementById('mic-text');

// Overlay Elements
const pwaCountdownOverlay = document.getElementById('pwa-countdown-overlay');
const pwaCountdownNum = document.getElementById('pwa-countdown-num');
const countdownTitle = document.getElementById('countdown-title');
const countdownTriggerType = document.getElementById('countdown-trigger-type');
const sysModeBadge = document.getElementById('sys-mode-badge');
const azureStatusPill = document.getElementById('azure-status-pill');

// Channel Score UI Bars
const barCell = document.getElementById('bar-cell');
const valCell = document.getElementById('val-cell');
const barSms = document.getElementById('bar-sms');
const valSms = document.getElementById('val-sms');
const barMesh = document.getElementById('bar-mesh');
const valMesh = document.getElementById('val-mesh');

// Diagnostics Elements
const diagSignal = document.getElementById('diag-signal');
const diagLatency = document.getElementById('diag-latency');
const diagHandshake = document.getElementById('diag-handshake');
const diagAzureAcs = document.getElementById('diag-azure-acs');
const diagSafezone = document.getElementById('diag-safezone');

// Tab Switcher
window.switchView = function(viewName, clickedEl) {
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.add('active');
  if (clickedEl) clickedEl.classList.add('active');
  
  if (viewName === 'medical') {
    fetchMedicalProfile();
  }
};

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
  setupBattery();
  setupGeolocation();
  setupFallDetectionSensor();
  setupVoiceMemoRecorder();
  fetchMedicalProfile();
  pingServer();

  // Periodic channel evaluation and vitals telemetry sync
  evaluateChannels();
  setInterval(() => {
    fluctuateVitals();
    evaluateChannels();
    pingServer();
  }, 4000);

  // Event Listeners
  if (triggerSosBtn) triggerSosBtn.addEventListener('click', () => startSOSCountdown('manual_sos', 5));
  if (stopSosBtn) stopSosBtn.addEventListener('click', cancelSOSCountdown);
  if (simulateFallBtn) simulateFallBtn.addEventListener('click', handleSimulateFall);

  if (simTachycardiaBtn) simTachycardiaBtn.addEventListener('click', () => {
    vitals.heartRate = 132;
    vitals.bloodOxygen = 93;
    updateVitalsUI();
    pushAzureIoTTelemetry();
  });

  if (simNormalVitalsBtn) simNormalVitalsBtn.addEventListener('click', () => {
    vitals.heartRate = 74;
    vitals.bloodOxygen = 98;
    vitals.fallDetected = false;
    vitals.impactGForce = 1.02;
    updateVitalsUI();
    pushAzureIoTTelemetry();
  });
});

// ==========================================
// BATTERY & GEOLOCATION
// ==========================================
function setupBattery() {
  if (navigator.getBattery) {
    navigator.getBattery().then(batt => {
      batteryLevel = Math.round(batt.level * 100);
      batt.addEventListener('levelchange', () => {
        batteryLevel = Math.round(batt.level * 100);
      });
    });
  } else {
    batteryLevel = Math.floor(75 + Math.random() * 20);
  }
}

function setupGeolocation() {
  if (navigator.geolocation) {
    gpsPos.textContent = "Acquiring Fix...";
    navigator.geolocation.watchPosition(
      (position) => {
        coordinates.latitude = parseFloat(position.coords.latitude.toFixed(6));
        coordinates.longitude = parseFloat(position.coords.longitude.toFixed(6));
        gpsPos.innerHTML = `${coordinates.latitude}, ${coordinates.longitude}`;
        evaluateSafeZoneDistance();
      },
      (error) => {
        console.warn("Using simulated coordinates:", error);
        gpsPos.innerHTML = `${coordinates.latitude} (Sim), ${coordinates.longitude} (Sim)`;
        evaluateSafeZoneDistance();
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  } else {
    gpsPos.innerHTML = `${coordinates.latitude} (Sim), ${coordinates.longitude} (Sim)`;
    evaluateSafeZoneDistance();
  }
}

// Distance calculation
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function evaluateSafeZoneDistance() {
  if (!medicalProfile || !medicalProfile.safeZone) return;
  const sz = medicalProfile.safeZone;
  const dist = calculateDistanceMeters(coordinates.latitude, coordinates.longitude, sz.latitude, sz.longitude);
  safeZoneDistanceMeters = Math.round(dist);
  const radius = sz.radiusMeters || 600;

  isOutsideSafeZone = safeZoneDistanceMeters > radius;

  if (safezoneText) {
    if (isOutsideSafeZone) {
      safezoneText.innerHTML = `⚠️ Outside Zone (${safeZoneDistanceMeters}m)`;
      safezoneText.style.color = '#d9383a';
      if (safezoneIcon) safezoneIcon.textContent = '⚠️';
      if (diagSafezone) {
        diagSafezone.textContent = `Breached (${safeZoneDistanceMeters}m from Center)`;
        diagSafezone.style.color = '#d9383a';
      }
    } else {
      safezoneText.innerHTML = `Inside Zone (${safeZoneDistanceMeters}m)`;
      safezoneText.style.color = '#1b8552';
      if (safezoneIcon) safezoneIcon.textContent = '🛡️';
      if (diagSafezone) {
        diagSafezone.textContent = `Normal (Within ${radius}m Perimeter)`;
        diagSafezone.style.color = '#1b8552';
      }
    }
  }
}

// ==========================================
// AUTOMATIC FALL DETECTION SENSOR
// ==========================================
function setupFallDetectionSensor() {
  if (window.DeviceMotionEvent) {
    let lastAccel = 0;
    window.addEventListener('devicemotion', (event) => {
      const acc = event.accelerationIncludingGravity;
      if (!acc) return;
      
      const x = acc.x || 0;
      const y = acc.y || 0;
      const z = acc.z || 0;
      const totalAccel = Math.sqrt(x*x + y*y + z*z);
      const gForce = totalAccel / 9.81;

      // Update live sensor reading
      if (vitalsPageGforce && !vitals.fallDetected) {
        vitalsPageGforce.textContent = gForce.toFixed(2);
      }

      // Detect sudden shock (impact spike > 26 m/s² or ~2.7G)
      if (totalAccel > 26 && lastAccel < 15 && !vitals.fallDetected) {
        console.warn(`[FALL SENSOR] Potential fall impact detected: ${gForce.toFixed(2)}G!`);
        triggerFallDetectedEvent(gForce);
      }
      lastAccel = totalAccel;
    });
  }
}

function handleSimulateFall() {
  triggerFallDetectedEvent(3.4);
}

function triggerFallDetectedEvent(gForce) {
  vitals.fallDetected = true;
  vitals.impactGForce = parseFloat(gForce.toFixed(2));
  updateVitalsUI();

  // Send instant telemetry to Azure IoT Hub
  fetch('/api/azure/iot/fall-alert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      impactGForce: vitals.impactGForce,
      coordinates
    })
  }).catch(e => console.warn('Fall alert push failed:', e));

  // Audio siren beep
  playFallAlertBeeps();

  // Start 10-second cancel window
  startSOSCountdown('fall_detected', 10);
}

function playFallAlertBeeps() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, ctx.currentTime + (i * 0.25));
      gain.gain.setValueAtTime(0.15, ctx.currentTime + (i * 0.25));
      osc.start(ctx.currentTime + (i * 0.25));
      osc.stop(ctx.currentTime + (i * 0.25) + 0.18);
    }
  } catch (e) {
    console.warn('Audio beeps unavailable:', e);
  }
}

// ==========================================
// EMERGENCY VOICE MEMO RECORDER
// ==========================================
function setupVoiceMemoRecorder() {
  if (!voiceRecordBtn) return;

  voiceRecordBtn.addEventListener('click', async () => {
    if (isRecordingVoice) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  });
}

async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(audioBlob);
      if (voiceAudioPreview) {
        voiceAudioPreview.src = audioUrl;
        voiceAudioPreview.style.display = 'block';
      }

      // Convert to base64 Data URI
      const reader = new FileReader();
      reader.onloadend = () => {
        voiceMemoBase64 = reader.result;
        if (voiceMemoStatus) {
          voiceMemoStatus.textContent = 'Voice note recorded and attached to SOS! Click play to test.';
          voiceMemoStatus.style.color = '#1b8552';
        }
      };
      reader.readAsDataURL(audioBlob);

      // Stop audio tracks
      stream.getTracks().forEach(t => t.stop());
    };

    mediaRecorder.start();
    isRecordingVoice = true;
    voiceRecordBtn.classList.add('active');
    if (micIcon) micIcon.textContent = '⏹️';
    if (micText) micText.textContent = 'Stop Recording';
    if (voiceMemoStatus) {
      voiceMemoStatus.textContent = 'Recording distress message (Max 6s)...';
      voiceMemoStatus.style.color = '#d9383a';
    }

    // Auto stop after 6 seconds
    setTimeout(() => {
      if (isRecordingVoice) stopVoiceRecording();
    }, 6000);

  } catch (err) {
    console.warn('Microphone access denied or unsupported:', err);
    alert('Microphone access is required to record distress voice memos.');
  }
}

function stopVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecordingVoice = false;
  voiceRecordBtn.classList.remove('active');
  if (micIcon) micIcon.textContent = '🔴';
  if (micText) micText.textContent = 'Re-record Voice';
}

// ==========================================
// HEALTH VITALS & AZURE IOT TELEMETRY
// ==========================================
function fluctuateVitals() {
  // Minor natural variation if normal
  if (!vitals.fallDetected && vitals.heartRate < 120) {
    vitals.heartRate = Math.round(72 + (Math.random() * 8 - 4));
    vitals.skinTemp = parseFloat((36.7 + (Math.random() * 0.3 - 0.15)).toFixed(1));
    vitals.bloodOxygen = Math.round(97 + Math.random() * 2);
  }
  updateVitalsUI();
  pushAzureIoTTelemetry();
}

function updateVitalsUI() {
  if (vitHr) vitHr.textContent = vitals.heartRate;
  if (vitSpo2) vitSpo2.textContent = `${vitals.bloodOxygen}%`;
  if (vitTemp) vitTemp.textContent = `${vitals.skinTemp}°C`;

  if (vitalsPageHr) vitalsPageHr.textContent = vitals.heartRate;
  if (vitalsPageSpo2) vitalsPageSpo2.textContent = vitals.bloodOxygen;
  if (vitalsPageTemp) vitalsPageTemp.textContent = vitals.skinTemp;
  if (vitalsPageGforce) vitalsPageGforce.textContent = vitals.impactGForce;
}

async function pushAzureIoTTelemetry() {
  try {
    await fetch('/api/azure/iot/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...vitals,
        battery: batteryLevel
      })
    });
  } catch (e) {
    // Offline or server down
  }
}

// ==========================================
// MEDICAL PROFILE API
// ==========================================
async function fetchMedicalProfile() {
  try {
    const res = await fetch('/api/medical-profile');
    if (res.ok) {
      medicalProfile = await res.json();
      populateMedicalProfileUI(medicalProfile);
      evaluateSafeZoneDistance();
    }
  } catch (e) {
    console.warn('Failed to load medical profile:', e);
  }
}

function populateMedicalProfileUI(profile) {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || 'Not specified';
  };
  setVal('med-fullname', `${profile.fullName || 'Senior Resident'}, Age ${profile.age || 74}`);
  setVal('med-blood', profile.bloodGroup ? `${profile.bloodGroup} Positive` : 'O+');
  setVal('med-allergies', profile.allergies);
  setVal('med-conditions', profile.conditions);
  setVal('med-meds', profile.medications);
  setVal('med-doctor', profile.emergencyDoctor);
  setVal('med-hospital', profile.preferredHospital);
}

// ==========================================
// CHANNEL SCORING & DECISION ENGINE
// ==========================================
function evaluateChannels() {
  signalStrength = Math.round(-65 - Math.random() * 35);
  latency = Math.round(25 + Math.random() * 90);

  if (diagSignal) diagSignal.textContent = `${signalStrength} dBm`;
  if (diagLatency) diagLatency.textContent = `${latency} ms`;

  const wSig = 0.30, wLat = 0.25, wBat = 0.20, wSucc = 0.25;

  let cellSig = Math.max(0, Math.min(100, ((signalStrength + 110) / 60) * 100));
  let cellLat = Math.max(0, Math.min(100, ((300 - latency) / 280) * 100));
  let cellScore = Math.round((cellSig * wSig) + (cellLat * wLat) + (batteryLevel * wBat) + (95 * wSucc));

  let smsSig = Math.max(0, Math.min(100, ((signalStrength + 120) / 70) * 100));
  let smsScore = Math.round((smsSig * wSig) + (15 * wLat) + (batteryLevel * wBat) + (98 * wSucc));

  let meshScore = Math.round((80 * wSig) + (40 * wLat) + (batteryLevel * wBat) + (78 * wSucc));

  updateBar(barCell, valCell, cellScore);
  updateBar(barSms, valSms, smsScore);
  updateBar(barMesh, valMesh, meshScore);

  if (cellScore >= smsScore && cellScore >= meshScore) {
    currentScoreChannel = 'Cellular Data';
  } else if (smsScore >= cellScore && smsScore >= meshScore) {
    currentScoreChannel = 'SMS Gateway (Azure/Twilio)';
  } else {
    currentScoreChannel = 'LoRa Mesh Network';
  }
}

function updateBar(barEl, valEl, score) {
  if (barEl) barEl.style.width = `${score}%`;
  if (valEl) valEl.textContent = score;
}

// ==========================================
// SERVER PING & HANDSHAKE
// ==========================================
async function pingServer() {
  try {
    const res = await fetch('/api/system-info');
    if (res.ok) {
      const data = await res.json();
      serverStatus = 'Online';
      if (diagHandshake) {
        diagHandshake.textContent = 'Connected (0.0.0.0)';
        diagHandshake.style.color = '#1b8552';
      }

      if (azureStatusPill) {
        if (data.hasAzureAcs || data.hasAzureStorage) {
          azureStatusPill.textContent = '☁️ Azure Connected';
          azureStatusPill.style.background = '#eef7ff';
          azureStatusPill.style.color = '#0078d4';
        } else {
          azureStatusPill.textContent = '☁️ Azure Ready';
        }
      }

      if (diagAzureAcs) {
        diagAzureAcs.textContent = data.hasAzureAcs ? 'Active ACS Primary' : 'Simulated / Standby';
        diagAzureAcs.style.color = data.hasAzureAcs ? '#0078d4' : '#5e5d56';
      }
    }
  } catch (err) {
    serverStatus = 'Offline';
    if (diagHandshake) {
      diagHandshake.textContent = 'Server Unreachable';
      diagHandshake.style.color = '#d9383a';
    }
  }
}

// ==========================================
// SOS COUNTDOWN & DISPATCH
// ==========================================
function startSOSCountdown(triggerType = 'manual_sos', durationSeconds = 5) {
  currentTriggerType = triggerType;
  sysModeBadge.className = 'sys-badge ready';
  sysModeBadge.style.background = '#fef3c7';
  sysModeBadge.style.color = '#854d0e';
  sysModeBadge.style.border = '1px solid #f59e0b';
  sysModeBadge.textContent = 'Alerting';

  if (countdownTitle) {
    countdownTitle.textContent = triggerType === 'fall_detected' ? '⚠️ FALL DETECTED!' : '🚨 SOS ALERT INITIATED';
  }
  if (countdownTriggerType) {
    countdownTriggerType.textContent = triggerType === 'fall_detected' ?
      `Impact Shock: ${vitals.impactGForce}G detected` : 'Manual Single-Touch Distress';
  }

  let count = durationSeconds;
  pwaCountdownNum.textContent = count;
  pwaCountdownOverlay.classList.add('active');

  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    count--;
    if (count > 0) {
      pwaCountdownNum.textContent = count;
    } else {
      clearInterval(countdownInterval);
      dispatchPWASOS();
    }
  }, 1000);
}

function cancelSOSCountdown() {
  clearInterval(countdownInterval);
  pwaCountdownOverlay.classList.remove('active');
  vitals.fallDetected = false;
  sysModeBadge.className = 'sys-badge ready';
  sysModeBadge.style.background = 'var(--accent-yellow-light)';
  sysModeBadge.style.color = 'var(--accent-yellow-text)';
  sysModeBadge.style.border = '1px solid var(--accent-yellow-border)';
  sysModeBadge.textContent = 'Ready';
}

// Force high-accuracy GPS fix at the exact moment of distress trigger
async function acquireFreshCoordinates() {
  if (!navigator.geolocation) return coordinates;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        coordinates.latitude = parseFloat(pos.coords.latitude.toFixed(6));
        coordinates.longitude = parseFloat(pos.coords.longitude.toFixed(6));
        if (gpsPos) gpsPos.innerHTML = `${coordinates.latitude}, ${coordinates.longitude}`;
        evaluateSafeZoneDistance();
        resolve(coordinates);
      },
      (err) => {
        console.warn('Live GPS acquisition warning, utilizing cached coordinate fix:', err.message);
        resolve(coordinates);
      },
      { enableHighAccuracy: true, timeout: 3500, maximumAge: 0 }
    );
  });
}

async function dispatchPWASOS() {
  pwaCountdownOverlay.classList.remove('active');
  sysModeBadge.textContent = 'Acquiring GPS & Dispatching...';

  // Acquire fresh live hardware GPS fix
  await acquireFreshCoordinates();

  const payload = {
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    senderName: medicalProfile ? medicalProfile.fullName : "Senior Resident",
    batteryLevel: batteryLevel,
    signalStrength: signalStrength,
    latency: latency,
    chosenChannel: currentScoreChannel,
    triggerType: currentTriggerType,
    vitalSigns: vitals,
    voiceMemoBase64: voiceMemoBase64,
    isOutsideSafeZone: isOutsideSafeZone,
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
      sysModeBadge.className = 'sys-badge sent';
      sysModeBadge.style.background = '#e6f7ff';
      sysModeBadge.style.color = '#1890ff';
      sysModeBadge.textContent = 'Dispatched';

      const triage = data.triage || {};
      const gMapsUrl = `https://maps.google.com/?q=${coordinates.latitude},${coordinates.longitude}`;

      // Open a custom modal or alert with the Google Maps link
      showDistressSuccessDialog(data, gMapsUrl);
    } else {
      const err = await res.json();
      throw new Error(err.error || 'Server error');
    }
  } catch (error) {
    console.error("Alert failed:", error);
    sysModeBadge.className = 'sys-badge ready';
    sysModeBadge.style.background = 'var(--accent-yellow-light)';
    sysModeBadge.style.color = 'var(--accent-yellow-text)';
    sysModeBadge.style.border = '1px solid var(--accent-yellow-border)';
    sysModeBadge.textContent = 'Ready';
    alert(`Alert Transmission Error: ${error.message}`);
  }
}

function showDistressSuccessDialog(data, gMapsUrl) {
  const modal = document.createElement('div');
  modal.className = 'custom-modal-backdrop active';
  modal.style.zIndex = '9999';
  modal.innerHTML = `
    <div class="custom-modal-card" style="text-align:center; padding:24px; border:2px solid #eab308; box-shadow:0 12px 32px rgba(234,179,8,0.25);">
      <div style="font-size:42px; margin-bottom:8px;">⚠️</div>
      <h2 style="font-size:18px; color:#854d0e; font-weight:800; margin-bottom:6px;">EMERGENCY DISTRESS DISPATCHED!</h2>
      <p style="font-size:12px; color:var(--text-sub); margin-bottom:14px;">
        Your live GPS location and clinical telemetry have been sent to your caregivers.
      </p>

      <div style="background:var(--bg-app); border:1px solid var(--border-color); border-radius:12px; padding:12px; margin-bottom:16px; text-align:left; font-size:11px;">
        <div><b>📍 Live GPS Coordinates:</b> <span style="font-family:monospace; font-weight:700;">${data.alert.latitude}, ${data.alert.longitude}</span></div>
        <div style="margin-top:4px;"><b>📱 Contacts Notified:</b> ${data.alert.contactsNotifiedCount} Caregivers</div>
        <div style="margin-top:4px;"><b>☁️ Gateway:</b> ${data.gateway}</div>
        <div style="margin-top:4px;"><b>🤖 Azure AI Triage:</b> Level <span style="color:#b45309; font-weight:800;">${data.triage ? data.triage.triageLevel : 'EVALUATED'}</span></div>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <a href="${gMapsUrl}" target="_blank" rel="noopener noreferrer" class="btn" style="background:#ffd000; color:#18181b; border:1px solid #eab308; padding:10px; font-size:12px; text-decoration:none; display:flex; align-items:center; justify-content:center; gap:6px; border-radius:8px; font-weight:800; box-shadow:0 2px 8px rgba(234,179,8,0.35);">
          📍 Open My Live Location in Google Maps &nearr;
        </a>
        <button class="btn btn-sm" onclick="this.closest('.custom-modal-backdrop').remove()" style="padding:8px; font-size:11px; background:var(--bg-app); border:1px solid var(--border-color); border-radius:8px;">
          Close & Return to App
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// Connect to SSE for real-time Reassurance Handshake
function connectTriggerEvents() {
  try {
    const es = new EventSource('/api/events');
    es.addEventListener('sos_acknowledged', (e) => {
      const data = JSON.parse(e.data);
      const banner = document.getElementById('reassurance-banner');
      const msg = document.getElementById('reassurance-msg');
      if (banner && msg) {
        banner.style.display = 'block';
        msg.innerHTML = `<strong>${data.responderName || 'Caregiver'}</strong> acknowledged distress alert at ${new Date(data.timestamp).toLocaleTimeString()} (ETA: ~<strong>${data.etaMinutes || 10} min</strong>). Stay calm, help is on the way!`;
      }
    });
  } catch (err) {
    console.warn('SSE subscription error:', err);
  }
}

window.triggerNativeSmsFallback = function() {
  const lat = (window.coordinates && window.coordinates.latitude) ? window.coordinates.latitude : 12.9716;
  const lng = (window.coordinates && window.coordinates.longitude) ? window.coordinates.longitude : 79.1594;
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const text = encodeURIComponent(`🚨 [IMECS EMERGENCY SOS] I need urgent help! My live location is: ${mapsUrl}`);
  window.location.href = `sms:?body=${text}`;
};

// Initialize SSE listener
connectTriggerEvents();
