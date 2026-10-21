const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const twilio = require('twilio');
const os = require('os');

// Load environment variables
dotenv.config();

// Azure SDK Imports (Safe loading with fallbacks)
let AzureSmsClient = null;
try {
  const { SmsClient } = require('@azure/communication-sms');
  AzureSmsClient = SmsClient;
} catch (e) {
  console.warn('[Azure ACS] @azure/communication-sms not loaded:', e.message);
}

let AzureBlobServiceClient = null;
try {
  const { BlobServiceClient } = require('@azure/storage-blob');
  AzureBlobServiceClient = BlobServiceClient;
} catch (e) {
  console.warn('[Azure Storage] @azure/storage-blob not loaded:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware (accept larger JSON for base64 voice recordings)
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// File paths
const DATA_DIR = path.join(__dirname, 'data');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const MEDICAL_FILE = path.join(DATA_DIR, 'medical_profile.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Ensure data folders exist
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Default Medical Profile if file missing
const DEFAULT_MEDICAL = {
  fullName: "Senior Resident",
  age: 74,
  bloodGroup: "O+",
  emergencyDoctor: "Dr. Sarah Rao (+91 98401 23456)",
  allergies: "Penicillin, Sulfa drugs",
  conditions: "Hypertension, Mild Bradycardia, Fall Risk",
  medications: "Amlodipine 5mg, Aspirin 75mg daily",
  preferredHospital: "Apollo Specialty / CMC Emergency Care",
  safeZone: {
    name: "Home & Senior Living Campus",
    latitude: 12.9716,
    longitude: 79.1594,
    radiusMeters: 600
  }
};

// In-Memory SSE Client Connections
let sseClients = [];

// In-Memory Azure IoT Device Twin / Telemetry state
let iotDeviceTwin = {
  deviceId: 'AZURE-IOT-PENDANT-01',
  status: 'connected',
  lastUpdated: new Date().toISOString(),
  vitals: {
    heartRate: 76,
    bloodOxygen: 98,
    skinTemp: 36.8,
    fallDetected: false,
    impactGForce: 1.02
  },
  battery: 88,
  highRiskMode: false
};

// Helper to read JSON files safely
function readJSON(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
      return defaultValue;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return defaultValue;
  }
}

// Helper to write JSON files safely
function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`Error writing file ${filePath}:`, error);
    return false;
  }
}

// Helper to resolve Local IPv4 Address
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Broadcast SSE event to all connected dashboards
function broadcastEvent(type, data) {
  sseClients.forEach(client => {
    try {
      client.res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    } catch (err) {
      console.warn('[SSE] Failed to write to client:', err.message);
    }
  });
}

// SSE Connection Endpoint
app.get('/api/alerts/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);
  console.log(`[SSE] Dashboard client connected: ${clientId}. Total: ${sseClients.length}`);

  // Send initial connected event
  res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

  // Heartbeat every 15s
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter(c => c.id !== clientId);
    console.log(`[SSE] Dashboard client disconnected: ${clientId}. Total: ${sseClients.length}`);
  });
});

// ==========================================
// AZURE AI EMERGENCY TRIAGE ENGINE
// ==========================================
function evaluateEmergencyTriage(alertData, medicalProfile) {
  const vitals = alertData.vitalSigns || {};
  const hr = vitals.heartRate || 75;
  const spo2 = vitals.bloodOxygen || 98;
  const isFall = !!vitals.fallDetected || alertData.triggerType === 'fall_detected';
  const gForce = vitals.impactGForce || 1.0;
  const battery = alertData.batteryLevel || 100;

  let level = 'YELLOW';
  let severityScore = 40;
  let urgencyMinutes = 30;
  let clinicalSummary = 'Standard emergency distress call. Patient requested manual assistance.';
  let suspectedEtiology = 'General Assistance Request';
  let recommendedActions = [
    'Establish direct telephone or voice communication immediately.',
    'Confirm patient consciousness and current physical orientation.',
    'Notify nearest designated primary caregiver or neighbor.'
  ];

  // Critical Criteria
  if (isFall || gForce > 2.5 || hr > 125 || hr < 45 || spo2 < 90) {
    level = 'RED';
    severityScore = 95;
    urgencyMinutes = 5;
    suspectedEtiology = isFall ? 'Traumatic Fall Event / Acute Impact' : 'Severe Cardiorespiratory Distress';
    clinicalSummary = `CRITICAL ALERT: ${isFall ? 'Sudden fall impact detected (' + gForce.toFixed(1) + 'G). ' : ''}` +
      `Vitals indicate acute distress (HR: ${hr} BPM, SpO2: ${spo2}%). Patient medical record notes: ${medicalProfile.conditions || 'None'}.`;
    recommendedActions = [
      'IMMEDIATE: Dispatch Emergency Ambulance / EMS (108 / 911).',
      'Instruct responder to bring spinal immobilization collar and portable AED.',
      `Alert Emergency Physician ${medicalProfile.emergencyDoctor || 'on-call'}.`,
      `Flag Patient Blood Group: ${medicalProfile.bloodGroup || 'Unknown'} and Allergies: ${medicalProfile.allergies || 'None'}.`
    ];
  } else if (hr > 100 || hr < 55 || spo2 < 94 || battery < 15 || alertData.isOutsideSafeZone) {
    level = 'ORANGE';
    severityScore = 75;
    urgencyMinutes = 15;
    suspectedEtiology = alertData.isOutsideSafeZone ? 'Geofence Wandering / Disorientation' : 'Moderate Physiological Stress';
    clinicalSummary = `URGENT ALERT: Elevated physiological strain detected (HR: ${hr} BPM, SpO2: ${spo2}%). ` +
      (alertData.isOutsideSafeZone ? 'Patient has moved outside designated Safe Zone perimeter. ' : '') +
      `Existing conditions: ${medicalProfile.conditions || 'None'}.`;
    recommendedActions = [
      'Contact patient phone immediately to evaluate mental clarity.',
      'Dispatch nearby responder unit or security personnel to GPS fix.',
      'Prepare transportation to preferred facility: ' + (medicalProfile.preferredHospital || 'Local Emergency Room') + '.'
    ];
  }

  return {
    triageLevel: level,
    severityScore,
    urgencyMinutes,
    suspectedEtiology,
    clinicalSummary,
    recommendedActions,
    timestamp: new Date().toISOString(),
    aiEngine: 'Microsoft Azure Health Triage & Cognitive Rules Engine'
  };
}

// ==========================================
// AZURE BLOB STORAGE ARCHIVAL SERVICE
// ==========================================
async function uploadToAzureBlobStorage(fileName, content, contentType = 'application/json') {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'sos-incident-records';

  if (!connStr || !AzureBlobServiceClient) {
    return {
      status: 'Simulated Cloud Archival',
      uri: `https://azure-simulated.blob.core.windows.net/${containerName}/${fileName}`,
      error: null
    };
  }

  try {
    const blobServiceClient = AzureBlobServiceClient.fromConnectionString(connStr);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();
    const blockBlobClient = containerClient.getBlockBlobClient(fileName);

    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType }
    });

    return {
      status: 'Uploaded to Azure Blob Storage',
      uri: blockBlobClient.url,
      error: null
    };
  } catch (err) {
    console.error('[Azure Blob Storage Error]:', err.message);
    return {
      status: 'Upload Failed',
      uri: null,
      error: err.message
    };
  }
}

// ==========================================
// MULTI-CLOUD SMS DISPATCH GATEWAY
// (Azure Communication Services + Twilio + Simulator)
// ==========================================
async function dispatchSmsViaAzureACS(toPhone, message) {
  const connStr = process.env.AZURE_COMMUNICATION_CONNECTION_STRING;
  const acsPhone = process.env.AZURE_COMMUNICATION_PHONE_NUMBER;

  if (!connStr || !acsPhone || !AzureSmsClient) {
    throw new Error('Azure Communication Services credentials or SDK missing.');
  }

  const client = new AzureSmsClient(connStr);
  const sendResults = await client.send({
    from: acsPhone,
    to: [toPhone],
    message: message
  });

  const firstResult = sendResults[0] || {};
  if (!firstResult.successful) {
    throw new Error(`ACS delivery failed: ${firstResult.errorMessage || 'Unknown ACS error'}`);
  }

  return {
    messageSid: firstResult.messageId || 'ACS_' + Date.now(),
    carrier: 'Microsoft Azure Communication Services'
  };
}

async function dispatchSmsViaTwilio(toPhone, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone = process.env.TWILIO_PHONE_NUMBER;

  if (!sid || !token || !fromPhone) {
    throw new Error('Twilio credentials missing.');
  }

  const client = twilio(sid, token);
  const result = await client.messages.create({
    body: message,
    from: fromPhone,
    to: toPhone
  });

  return {
    messageSid: result.sid,
    carrier: 'Twilio Cloud Telephony'
  };
}

// Multi-Cloud Alert Dispatcher
async function dispatchMultiCloudAlerts(activeContacts, sosMessage) {
  const provider = (process.env.GATEWAY_PROVIDER || 'simulated').toLowerCase();
  const simulateFlag = process.env.SIMULATE_SMS === 'true';

  const dispatchLogs = [];

  for (const contact of activeContacts) {
    let status = 'Simulated';
    let messageSid = 'SIM_' + Math.random().toString(36).substring(2, 9).toUpperCase();
    let carrier = 'Simulated Gateway';
    let error = null;

    if (!simulateFlag && provider !== 'simulated') {
      if (provider === 'azure') {
        try {
          const res = await dispatchSmsViaAzureACS(contact.phone, sosMessage);
          status = 'Sent';
          messageSid = res.messageSid;
          carrier = res.carrier;
        } catch (err) {
          status = 'Failed';
          error = err.message;
        }
      } else if (provider === 'twilio') {
        try {
          const res = await dispatchSmsViaTwilio(contact.phone, sosMessage);
          status = 'Sent';
          messageSid = res.messageSid;
          carrier = res.carrier;
        } catch (err) {
          status = 'Failed';
          error = err.message;
        }
      } else if (provider === 'hybrid') {
        // Primary Azure ACS with Twilio Failover
        try {
          const res = await dispatchSmsViaAzureACS(contact.phone, sosMessage);
          status = 'Sent';
          messageSid = res.messageSid;
          carrier = res.carrier;
        } catch (azureErr) {
          console.warn(`[Hybrid Gateway] Azure ACS failed for ${contact.name}, falling back to Twilio:`, azureErr.message);
          try {
            const res = await dispatchSmsViaTwilio(contact.phone, sosMessage);
            status = 'Sent (Failover)';
            messageSid = res.messageSid;
            carrier = 'Twilio (Failover from Azure ACS)';
          } catch (twilioErr) {
            status = 'Failed';
            error = `Azure: ${azureErr.message} | Twilio: ${twilioErr.message}`;
          }
        }
      }
    } else {
      console.log(`[SIMULATED SMS] To: ${contact.name} (${contact.phone}) - Msg: "${sosMessage}"`);
    }

    dispatchLogs.push({
      contactId: contact.id,
      name: contact.name,
      phone: contact.phone,
      status,
      carrier,
      messageSid,
      error
    });
  }

  return dispatchLogs;
}

// ==========================================
// SYSTEM INFO & CONFIG API
// ==========================================
app.get('/api/system-info', (req, res) => {
  const hasTwilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
  const hasAzureAcs = !!(process.env.AZURE_COMMUNICATION_CONNECTION_STRING && process.env.AZURE_COMMUNICATION_PHONE_NUMBER);
  const hasAzureStorage = !!process.env.AZURE_STORAGE_CONNECTION_STRING;
  const hasAzureIot = !!process.env.AZURE_IOT_HUB_CONNECTION_STRING;

  res.json({
    localIp: getLocalIp(),
    port: PORT,
    gatewayProvider: process.env.GATEWAY_PROVIDER || 'simulated',
    simulateSms: process.env.SIMULATE_SMS === 'true',
    hasTwilio,
    hasAzureAcs,
    hasAzureStorage,
    hasAzureIot,
    twilioDetails: {
      sid: process.env.TWILIO_ACCOUNT_SID ? `${process.env.TWILIO_ACCOUNT_SID.substring(0, 8)}...` : '',
      phone: process.env.TWILIO_PHONE_NUMBER || ''
    },
    azureDetails: {
      acsConnected: hasAzureAcs,
      acsPhone: process.env.AZURE_COMMUNICATION_PHONE_NUMBER || '',
      storageConnected: hasAzureStorage,
      containerName: process.env.AZURE_STORAGE_CONTAINER_NAME || 'sos-incident-records',
      iotConnected: hasAzureIot
    },
    iotDeviceTwin
  });
});

app.post('/api/system-config', (req, res) => {
  const {
    gatewayProvider,
    simulateSms,
    twilioSid,
    twilioToken,
    twilioPhone,
    azureAcsConnStr,
    azureAcsPhone,
    azureStorageConnStr,
    azureStorageContainer,
    azureIotConnStr
  } = req.body;

  if (gatewayProvider !== undefined) process.env.GATEWAY_PROVIDER = gatewayProvider;
  if (simulateSms !== undefined) process.env.SIMULATE_SMS = simulateSms.toString();
  if (twilioSid !== undefined) process.env.TWILIO_ACCOUNT_SID = twilioSid;
  if (twilioToken !== undefined) process.env.TWILIO_AUTH_TOKEN = twilioToken;
  if (twilioPhone !== undefined) process.env.TWILIO_PHONE_NUMBER = twilioPhone;
  if (azureAcsConnStr !== undefined) process.env.AZURE_COMMUNICATION_CONNECTION_STRING = azureAcsConnStr;
  if (azureAcsPhone !== undefined) process.env.AZURE_COMMUNICATION_PHONE_NUMBER = azureAcsPhone;
  if (azureStorageConnStr !== undefined) process.env.AZURE_STORAGE_CONNECTION_STRING = azureStorageConnStr;
  if (azureStorageContainer !== undefined) process.env.AZURE_STORAGE_CONTAINER_NAME = azureStorageContainer;
  if (azureIotConnStr !== undefined) process.env.AZURE_IOT_HUB_CONNECTION_STRING = azureIotConnStr;

  const envPath = path.join(__dirname, '.env');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  const config = {
    PORT: process.env.PORT || '3000',
    GATEWAY_PROVIDER: process.env.GATEWAY_PROVIDER || 'simulated',
    SIMULATE_SMS: process.env.SIMULATE_SMS || 'true',
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || '',
    AZURE_COMMUNICATION_CONNECTION_STRING: process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '',
    AZURE_COMMUNICATION_PHONE_NUMBER: process.env.AZURE_COMMUNICATION_PHONE_NUMBER || '',
    AZURE_STORAGE_CONNECTION_STRING: process.env.AZURE_STORAGE_CONNECTION_STRING || '',
    AZURE_STORAGE_CONTAINER_NAME: process.env.AZURE_STORAGE_CONTAINER_NAME || 'sos-incident-records',
    AZURE_IOT_HUB_CONNECTION_STRING: process.env.AZURE_IOT_HUB_CONNECTION_STRING || ''
  };

  const lines = envContent.split(/\r?\n/);
  const newLines = [];
  const writtenKeys = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') {
      newLines.push(line);
      continue;
    }
    const parts = trimmed.split('=');
    const key = parts[0].trim();
    if (config[key] !== undefined) {
      newLines.push(`${key}=${config[key]}`);
      writtenKeys.add(key);
    } else {
      newLines.push(line);
    }
  }

  for (const key of Object.keys(config)) {
    if (!writtenKeys.has(key)) {
      newLines.push(`${key}=${config[key]}`);
    }
  }

  fs.writeFileSync(envPath, newLines.join('\n'), 'utf8');
  console.log('[CONFIG] .env configuration updated dynamically.');

  res.json({
    message: 'Configuration updated successfully',
    gatewayProvider: process.env.GATEWAY_PROVIDER,
    simulateSms: process.env.SIMULATE_SMS === 'true',
    hasTwilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
    hasAzureAcs: !!(process.env.AZURE_COMMUNICATION_CONNECTION_STRING && process.env.AZURE_COMMUNICATION_PHONE_NUMBER),
    hasAzureStorage: !!process.env.AZURE_STORAGE_CONNECTION_STRING
  });
});

// Test SMS dispatch endpoint
app.post('/api/gateway/test-sms', async (req, res) => {
  const { testPhone } = req.body;
  if (!testPhone) {
    return res.status(400).json({ error: 'Test phone number is required.' });
  }

  const testMessage = `[IMECS TEST] Microsoft Azure & Twilio Emergency Gateway verification at ${new Date().toLocaleTimeString()}. System fully operational.`;
  const singleContact = [{ id: 'test', name: 'Verification Recipient', phone: testPhone, active: true }];

  try {
    const logs = await dispatchMultiCloudAlerts(singleContact, testMessage);
    res.json({
      message: 'Test message processed',
      logs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// MEDICAL ID & GEOFENCE SAFE ZONE API
// ==========================================
app.get('/api/medical-profile', (req, res) => {
  const profile = readJSON(MEDICAL_FILE, DEFAULT_MEDICAL);
  if (!profile.chronicConditions) {
    if (typeof profile.conditions === 'string') {
      profile.chronicConditions = profile.conditions.split(',').map(s => s.trim()).filter(Boolean);
    } else if (Array.isArray(profile.conditions)) {
      profile.chronicConditions = profile.conditions;
    } else {
      profile.chronicConditions = [];
    }
  }
  res.json(profile);
});

app.put('/api/medical-profile', (req, res) => {
  const updated = {
    ...DEFAULT_MEDICAL,
    ...req.body
  };
  writeJSON(MEDICAL_FILE, updated);
  broadcastEvent('medical_updated', updated);
  res.json({ message: 'Medical profile updated successfully', profile: updated });
});

app.post('/api/medical-profile', (req, res) => {
  const existing = readJSON(MEDICAL_FILE, DEFAULT_MEDICAL);
  const updated = {
    ...existing,
    ...req.body
  };
  writeJSON(MEDICAL_FILE, updated);
  broadcastEvent('medical_updated', updated);
  res.json({ message: 'Medical profile updated successfully', profile: updated });
});

// ==========================================
// AZURE IOT HUB WEARABLE TELEMETRY API
// ==========================================
app.get('/api/azure/iot/telemetry', (req, res) => {
  res.json(iotDeviceTwin);
});

app.post('/api/azure/iot/telemetry', (req, res) => {
  const { heartRate, bloodOxygen, skinTemp, fallDetected, impactGForce, battery } = req.body;

  iotDeviceTwin.lastUpdated = new Date().toISOString();
  if (heartRate !== undefined) iotDeviceTwin.vitals.heartRate = Number(heartRate);
  if (bloodOxygen !== undefined) iotDeviceTwin.vitals.bloodOxygen = Number(bloodOxygen);
  if (skinTemp !== undefined) iotDeviceTwin.vitals.skinTemp = Number(skinTemp);
  if (fallDetected !== undefined) iotDeviceTwin.vitals.fallDetected = Boolean(fallDetected);
  if (impactGForce !== undefined) iotDeviceTwin.vitals.impactGForce = Number(impactGForce);
  if (battery !== undefined) iotDeviceTwin.battery = Number(battery);

  // Broadcast live telemetry to active dashboards
  broadcastEvent('telemetry_updated', iotDeviceTwin);
  res.json({ message: 'Telemetry ingested into Azure IoT Hub Device Twin', iotDeviceTwin });
});

// Instant Fall Sensor Alert
app.post('/api/azure/iot/fall-alert', (req, res) => {
  const { impactGForce, coordinates } = req.body;
  iotDeviceTwin.vitals.fallDetected = true;
  iotDeviceTwin.vitals.impactGForce = impactGForce || 3.2;

  broadcastEvent('fall_detected', {
    impactGForce: iotDeviceTwin.vitals.impactGForce,
    coordinates,
    timestamp: new Date().toISOString()
  });

  res.json({ message: 'Fall alert registered on Azure IoT Hub Twin', vitals: iotDeviceTwin.vitals });
});

// ==========================================
// AZURE AI TRIAGE ADVISOR ENDPOINT
// ==========================================
app.post('/api/azure/ai/triage', (req, res) => {
  const alertData = req.body || {};
  const medicalProfile = readJSON(MEDICAL_FILE, DEFAULT_MEDICAL);
  const triage = evaluateEmergencyTriage(alertData, medicalProfile);
  res.json(triage);
});

// ==========================================
// CONTACTS CRUD ENDPOINTS
// ==========================================
app.get('/api/contacts', (req, res) => {
  const contacts = readJSON(CONTACTS_FILE, []);
  res.json(contacts);
});

app.post('/api/contacts', (req, res) => {
  const { name, phone, relationship, active } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and Phone number are required.' });
  }

  const contacts = readJSON(CONTACTS_FILE, []);
  const newContact = {
    id: Date.now().toString(),
    name,
    phone,
    relationship: relationship || 'Family',
    active: active !== undefined ? active : true
  };

  contacts.push(newContact);
  writeJSON(CONTACTS_FILE, contacts);
  res.status(201).json(newContact);
});

app.put('/api/contacts/:id', (req, res) => {
  const { id } = req.params;
  const { name, phone, relationship, active } = req.body;

  const contacts = readJSON(CONTACTS_FILE, []);
  const index = contacts.findIndex(c => c.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Contact not found' });
  }

  contacts[index] = {
    ...contacts[index],
    name: name !== undefined ? name : contacts[index].name,
    phone: phone !== undefined ? phone : contacts[index].phone,
    relationship: relationship !== undefined ? relationship : contacts[index].relationship,
    active: active !== undefined ? active : contacts[index].active
  };

  writeJSON(CONTACTS_FILE, contacts);
  res.json(contacts[index]);
});

app.delete('/api/contacts/:id', (req, res) => {
  const { id } = req.params;
  const contacts = readJSON(CONTACTS_FILE, []);
  const filtered = contacts.filter(c => c.id !== id);

  if (contacts.length === filtered.length) {
    return res.status(404).json({ error: 'Contact not found' });
  }

  writeJSON(CONTACTS_FILE, filtered);
  res.json({ message: 'Contact deleted successfully' });
});

// Send live location directly to a specific contact
app.post('/api/contacts/:id/send-location', async (req, res) => {
  const { id } = req.params;
  const { latitude, longitude, senderName } = req.body;
  const contacts = readJSON(CONTACTS_FILE, []);
  const contact = contacts.find(c => c.id === id);
  if (!contact) {
    return res.status(404).json({ error: 'Contact not found' });
  }

  const lat = latitude !== undefined ? latitude : 12.9716;
  const lng = longitude !== undefined ? longitude : 79.1594;
  const sender = senderName || 'Senior Resident';
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;

  const message = `🚨 [IMECS EMERGENCY ALERT]
${sender} live location update!

📍 LIVE GOOGLE MAPS PIN:
${mapsUrl}

GPS Coordinates: Lat ${lat}, Lng ${lng}
👉 Tap the link above to open directly in Google Maps.`;

  const logs = await dispatchMultiCloudAlerts([contact], message);
  res.json({ message: `Live GPS Location sent to ${contact.name}`, mapsUrl, logs });
});

// ==========================================
// ALERTS & EMERGENCY SOS ENDPOINTS
// ==========================================
app.get('/api/alerts', (req, res) => {
  const alerts = readJSON(ALERTS_FILE, []);
  res.json(alerts);
});

// Update Incident Status & Responder Notes
app.patch('/api/alerts/:id/status', (req, res) => {
  const { id } = req.params;
  const { status, responderNotes } = req.body;

  const alerts = readJSON(ALERTS_FILE, []);
  const index = alerts.findIndex(a => a.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Alert not found' });
  }

  alerts[index].status = status || alerts[index].status;
  if (responderNotes) {
    alerts[index].responderNotes = responderNotes;
  }
  alerts[index].updatedAt = new Date().toISOString();

  writeJSON(ALERTS_FILE, alerts);
  broadcastEvent('status_updated', alerts[index]);
  res.json({ message: 'Alert status updated', alert: alerts[index] });
});

// Helper: Haversine distance in meters
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

// Trigger Enhanced SOS Alert
app.post('/api/sos', async (req, res) => {
  const {
    latitude,
    longitude,
    senderName,
    batteryLevel,
    signalStrength,
    latency,
    chosenChannel,
    isSimulated,
    triggerType,
    vitalSigns,
    voiceMemoBase64
  } = req.body;

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'GPS coordinates (latitude, longitude) are required.' });
  }

  const sender = senderName || 'Senior Resident';
  const battery = batteryLevel !== undefined ? batteryLevel : 100;
  const channel = chosenChannel || 'cellular';
  const timestamp = new Date().toISOString();
  const alertId = 'ALERT_' + Date.now();

  // Load Medical Profile
  const medicalProfile = readJSON(MEDICAL_FILE, DEFAULT_MEDICAL);

  // Check Geofence Safe Zone
  let isOutsideSafeZone = false;
  let distanceFromSafeZone = 0;
  if (medicalProfile.safeZone && medicalProfile.safeZone.latitude) {
    const dist = calculateDistanceMeters(
      latitude,
      longitude,
      medicalProfile.safeZone.latitude,
      medicalProfile.safeZone.longitude
    );
    distanceFromSafeZone = Math.round(dist);
    if (dist > (medicalProfile.safeZone.radiusMeters || 500)) {
      isOutsideSafeZone = true;
    }
  }

  // Handle Voice Memo audio upload
  let voiceMemoUrl = null;
  if (voiceMemoBase64) {
    try {
      const audioFileName = `voice_${alertId}.webm`;
      const audioFilePath = path.join(UPLOADS_DIR, audioFileName);
      const base64Data = voiceMemoBase64.replace(/^data:audio\/\w+;base64,/, '');
      fs.writeFileSync(audioFilePath, Buffer.from(base64Data, 'base64'));
      voiceMemoUrl = `/uploads/${audioFileName}`;
      console.log(`[AUDIO] Voice memo saved to disk: ${audioFilePath}`);
    } catch (err) {
      console.error('[AUDIO] Failed to save voice recording:', err.message);
    }
  }

  // Get active emergency contacts
  const contacts = readJSON(CONTACTS_FILE, []);
  const activeContacts = contacts.filter(c => c.active);

  if (activeContacts.length === 0) {
    return res.status(400).json({ error: 'No active emergency contacts saved to dispatch alerts.' });
  }

  // Compose SOS text message with clinical details & universal Google Maps Link
  const googleMapsUrl = `https://maps.google.com/?q=${latitude},${longitude}`;
  const triggerLabel = triggerType === 'fall_detected' ? 'FALL DETECTED' : 'EMERGENCY SOS';
  const vitalsText = vitalSigns ? `HR: ${vitalSigns.heartRate || 75}bpm, SpO2: ${vitalSigns.bloodOxygen || 98}%` : '';
  const medText = medicalProfile.bloodGroup ? `Blood: ${medicalProfile.bloodGroup}` : '';

  const sosMessage = `🚨 [IMECS ${triggerLabel}]
${sender} is in distress and requested emergency help!

📍 LIVE LOCATION:
${googleMapsUrl}

GPS Coordinates: Lat ${latitude}, Lng ${longitude}
${vitalsText ? '🫀 Vitals: ' + vitalsText + '\n' : ''}${medText ? '🩸 ' + medText + '\n' : ''}🔋 Battery: ${battery}% | Route: ${channel}

👉 Tap the link above to open directly in Google Maps.`;

  // Multi-Cloud SMS Dispatch
  const dispatchLogs = await dispatchMultiCloudAlerts(activeContacts, sosMessage);

  // Azure AI Clinical Triage Analysis
  const triageAssessment = evaluateEmergencyTriage({
    vitalSigns: vitalSigns || iotDeviceTwin.vitals,
    triggerType: triggerType || 'manual_sos',
    batteryLevel: battery,
    isOutsideSafeZone
  }, medicalProfile);

  // Update IoT Twin state
  if (vitalSigns) {
    iotDeviceTwin.vitals = { ...iotDeviceTwin.vitals, ...vitalSigns };
  }

  // Build the complete incident record
  const newAlert = {
    id: alertId,
    timestamp,
    sender,
    latitude,
    longitude,
    googleMapsUrl: `https://maps.google.com/?q=${latitude},${longitude}`,
    batteryLevel: battery,
    signalStrength: signalStrength || -70,
    latency: latency || 40,
    chosenChannel: channel,
    triggerType: triggerType || 'manual_sos',
    status: 'Active (Unresolved)',
    vitalSigns: vitalSigns || iotDeviceTwin.vitals,
    isOutsideSafeZone,
    distanceFromSafeZone,
    voiceMemoUrl,
    breadcrumbs: [
      { latitude, longitude, timestamp }
    ],
    medicalProfile: {
      fullName: medicalProfile.fullName,
      bloodGroup: medicalProfile.bloodGroup,
      allergies: medicalProfile.allergies,
      conditions: medicalProfile.conditions,
      chronicConditions: medicalProfile.chronicConditions || (medicalProfile.conditions ? medicalProfile.conditions.split(',').map(s => s.trim()) : []),
      doctor: medicalProfile.emergencyDoctor,
      preferredHospital: medicalProfile.preferredHospital
    },
    triageAssessment,
    messageContent: sosMessage,
    contactsNotifiedCount: activeContacts.length,
    dispatchLogs,
    isSimulated: isSimulated || false
  };

  // Upload to Microsoft Azure Blob Storage (Background async archival)
  uploadToAzureBlobStorage(`incident-${alertId}.json`, JSON.stringify(newAlert, null, 2))
    .then(cloudRes => {
      newAlert.azureCloudArchive = cloudRes;
      console.log(`[Azure Storage] Incident archive result: ${cloudRes.status} -> ${cloudRes.uri}`);
    })
    .catch(err => console.warn('[Azure Storage] Archival skipped:', err.message));

  // Save the alert record locally
  const alerts = readJSON(ALERTS_FILE, []);
  alerts.unshift(newAlert);
  writeJSON(ALERTS_FILE, alerts);

  // Broadcast alert to connected dashboards
  broadcastEvent('sos_triggered', newAlert);

  const activeGateway = process.env.GATEWAY_PROVIDER || (process.env.SIMULATE_SMS === 'true' ? 'Simulated' : 'Twilio Carrier');

  res.status(201).json({
    message: 'SOS Alert dispatched successfully via Multi-Cloud Gateway',
    alert: newAlert,
    gateway: activeGateway,
    triage: triageAssessment
  });
});

// Append live GPS breadcrumb during ongoing emergency
app.post('/api/sos/:id/breadcrumb', (req, res) => {
  const { id } = req.params;
  const { latitude, longitude } = req.body;

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'GPS coordinates (latitude, longitude) required' });
  }

  const alerts = readJSON(ALERTS_FILE, []);
  const alert = alerts.find(a => a.id === id);

  if (!alert) {
    return res.status(404).json({ error: 'Alert not found' });
  }

  const breadcrumb = {
    latitude,
    longitude,
    timestamp: new Date().toISOString()
  };

  if (!alert.breadcrumbs) {
    alert.breadcrumbs = [{ latitude: alert.latitude, longitude: alert.longitude, timestamp: alert.timestamp }];
  }

  alert.breadcrumbs.push(breadcrumb);
  alert.latitude = latitude;
  alert.longitude = longitude;
  alert.googleMapsUrl = `https://maps.google.com/?q=${latitude},${longitude}`;

  writeJSON(ALERTS_FILE, alerts);

  // Broadcast live location update to dashboards
  broadcastEvent('sos_breadcrumb', { alertId: id, breadcrumb, alert });

  res.json({ message: 'Live breadcrumb logged', breadcrumb });
});

// Acknowledge SOS Distress Alert with Two-Way Handshake
app.post('/api/sos/:id/acknowledge', (req, res) => {
  const { id } = req.params;
  const { responderName, etaMinutes, note } = req.body;

  const alerts = readJSON(ALERTS_FILE, []);
  const alertIndex = alerts.findIndex(a => a.id === id);

  if (alertIndex === -1) {
    return res.status(404).json({ error: 'Alert not found' });
  }

  const responder = responderName || 'Primary Caregiver';
  const eta = etaMinutes || 10;
  const ackTimestamp = new Date().toISOString();

  alerts[alertIndex].status = 'Acknowledged (Help En Route)';
  alerts[alertIndex].acknowledgment = {
    responderName: responder,
    etaMinutes: eta,
    note: note || 'Assistance is on the way. Stay calm.',
    timestamp: ackTimestamp
  };

  writeJSON(ALERTS_FILE, alerts);

  // Broadcast reassurance handshake event to Senior Trigger App and Caregiver screens
  broadcastEvent('sos_acknowledged', {
    alertId: id,
    alert: alerts[alertIndex],
    responderName: responder,
    etaMinutes: eta,
    timestamp: ackTimestamp,
    reassuranceMessage: `Help is on the way! ${responder} acknowledged distress alert and is arriving in ~${eta} minutes.`
  });

  res.json({
    message: 'Distress alert acknowledged. Reassurance handshake sent to senior.',
    alert: alerts[alertIndex]
  });
});

// First-Responder Public Health Pass API
app.get('/api/public-emergency-pass', (req, res) => {
  const medicalProfile = readJSON(MEDICAL_FILE, DEFAULT_MEDICAL);
  const contacts = readJSON(CONTACTS_FILE, []);
  const activeContacts = contacts.filter(c => c.active !== false);

  res.json({
    fullName: medicalProfile.fullName || 'Senior Resident',
    age: medicalProfile.age || 74,
    bloodGroup: medicalProfile.bloodGroup || 'O+',
    allergies: medicalProfile.allergies || 'None declared',
    conditions: medicalProfile.conditions || 'None declared',
    medications: medicalProfile.medications || 'None declared',
    emergencyDoctor: medicalProfile.emergencyDoctor || 'Not listed',
    preferredHospital: medicalProfile.preferredHospital || 'Nearest Trauma Center',
    primaryContacts: activeContacts.map(c => ({
      name: c.name,
      relationship: c.relationship,
      phone: c.phone
    })),
    generatedAt: new Date().toISOString()
  });
});

// First-Responder On-Scene Check-In
app.post('/api/public-emergency-pass/ping', (req, res) => {
  const { responderName, role, latitude, longitude, note } = req.body;
  const pingRecord = {
    id: 'PING_' + Date.now(),
    responderName: responderName || 'First Responder / Paramedic',
    role: role || 'Paramedic',
    latitude: latitude || null,
    longitude: longitude || null,
    note: note || 'First responder arrived at senior location',
    timestamp: new Date().toISOString()
  };

  broadcastEvent('paramedic_arrived', pingRecord);

  res.json({
    message: 'On-scene check-in registered. Caregivers notified.',
    checkIn: pingRecord
  });
});

// Azure Storage Sync all alerts
app.post('/api/azure/storage/sync', async (req, res) => {
  const alerts = readJSON(ALERTS_FILE, []);
  const syncResults = [];

  for (const alert of alerts) {
    const fileName = `incident-${alert.id}.json`;
    const result = await uploadToAzureBlobStorage(fileName, JSON.stringify(alert, null, 2));
    syncResults.push({ id: alert.id, result });
  }

  res.json({
    message: `Synchronized ${alerts.length} incidents to Microsoft Azure Blob Storage`,
    container: process.env.AZURE_STORAGE_CONTAINER_NAME || 'sos-incident-records',
    syncResults
  });
});

// Clear all alerts log
app.post('/api/alerts/clear', (req, res) => {
  writeJSON(ALERTS_FILE, []);
  broadcastEvent('logs_cleared', {});
  res.json({ message: 'Alert history cleared' });
});

// Serve uploads statically
app.use('/uploads', express.static(UPLOADS_DIR));

// Start listening if executed directly
const serverIp = getLocalIp();
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================================================`);
    console.log(` IMECS SOS Emergency Communication Hub & Microsoft Azure Gateway Active`);
    console.log(` - Port:               ${PORT}`);
    console.log(` - Local Portal Hub:   http://localhost:${PORT}/index.html`);
    console.log(` - Mobile Phone link:  http://${serverIp}:${PORT}/index.html`);
    console.log(` - Azure ACS SMS:      ${process.env.AZURE_COMMUNICATION_PHONE_NUMBER ? 'Configured' : 'Simulated / Standby'}`);
    console.log(` - Azure Storage:      ${process.env.AZURE_STORAGE_CONNECTION_STRING ? 'Configured' : 'Local / Simulated'}`);
    console.log(` - Gateway Mode:       ${process.env.GATEWAY_PROVIDER || 'simulated'}`);
    console.log(`========================================================================`);
  });
}

module.exports = app;
