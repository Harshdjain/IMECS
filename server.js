const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const twilio = require('twilio');
const os = require('os');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// File paths
const CONTACTS_FILE = path.join(__dirname, 'data', 'contacts.json');
const ALERTS_FILE = path.join(__dirname, 'data', 'alerts.json');
const MEDICAL_PROFILE_FILE = path.join(__dirname, 'data', 'medical-profile.json');

// Ensure data folder exists
const dataDir = path.dirname(CONTACTS_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// In-Memory SSE Client Connections
let sseClients = [];

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
      // family can be 'IPv4' or 4 depending on Node version
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
    client.res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
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

  // Send a heartbeat every 15 seconds to keep connection alive
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
// SYSTEM INFO & CONFIG API
// ==========================================

// Get system configuration info
app.get('/api/system-info', (req, res) => {
  res.json({
    localIp: getLocalIp(),
    port: PORT,
    hasTwilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
    simulateSms: process.env.SIMULATE_SMS === 'true',
    twilioDetails: {
      sid: process.env.TWILIO_ACCOUNT_SID ? `${process.env.TWILIO_ACCOUNT_SID.substring(0, 8)}...` : '',
      phone: process.env.TWILIO_PHONE_NUMBER || ''
    }
  });
});

// Update Twilio SMS credentials in env dynamically
app.post('/api/system-config', (req, res) => {
  const { twilioSid, twilioToken, twilioPhone, simulateSms } = req.body;

  if (twilioSid !== undefined) process.env.TWILIO_ACCOUNT_SID = twilioSid;
  if (twilioToken !== undefined) process.env.TWILIO_AUTH_TOKEN = twilioToken;
  if (twilioPhone !== undefined) process.env.TWILIO_PHONE_NUMBER = twilioPhone;
  if (simulateSms !== undefined) process.env.SIMULATE_SMS = simulateSms.toString();

  const envPath = path.join(__dirname, '.env');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  const config = {
    PORT: process.env.PORT || '3000',
    SIMULATE_SMS: process.env.SIMULATE_SMS || 'true',
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || ''
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
    hasTwilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
    simulateSms: process.env.SIMULATE_SMS === 'true'
  });
});

// ==========================================
// CONTACTS CRUD ENDPOINTS
// ==========================================

// Get all contacts
app.get('/api/contacts', (req, res) => {
  const contacts = readJSON(CONTACTS_FILE, []);
  res.json(contacts);
});

// Create new contact
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

// Update contact
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

// Delete contact
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

// ==========================================
// MEDICAL PROFILE API
// ==========================================
app.get('/api/medical-profile', (req, res) => {
  const profile = readJSON(MEDICAL_PROFILE_FILE, {});
  res.json(profile);
});

app.post('/api/medical-profile', (req, res) => {
  const profile = req.body || {};
  writeJSON(MEDICAL_PROFILE_FILE, profile);
  broadcastEvent('medical_profile_updated', profile);
  res.json({ message: 'Medical profile updated successfully', profile });
});

// ==========================================
// ALERTS & SOS ENDPOINTS
// ==========================================

// Get alert logs
app.get('/api/alerts', (req, res) => {
  const alerts = readJSON(ALERTS_FILE, []);
  res.json(alerts);
});

// Trigger SOS Alert
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
    triggerType
  } = req.body;

  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'GPS coordinates (latitude, longitude) are required.' });
  }

  const sender = senderName || 'Elderly User';
  const battery = batteryLevel !== undefined ? batteryLevel : 100;
  const channel = chosenChannel || 'cellular';
  const mode = triggerType || 'manual'; // manual, shake, fall, speed_dial
  const timestamp = new Date().toISOString();

  // Load latest medical emergency profile
  const medicalProfile = readJSON(MEDICAL_PROFILE_FILE, null);

  // Get active contacts to notify
  const contacts = readJSON(CONTACTS_FILE, []);
  const activeContacts = contacts.filter(c => c.active);

  if (activeContacts.length === 0) {
    return res.status(400).json({ error: 'No active emergency contacts saved to send alerts.' });
  }

  // Compose Google Maps Link and SOS messages with trigger type
  const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
  const triggerLabel = mode === 'fall' ? 'FALL DETECTED' : (mode === 'shake' ? 'SHAKE GESTURE' : 'SOS BUTTON');
  const medicalBrief = medicalProfile && medicalProfile.bloodGroup ? ` [Blood: ${medicalProfile.bloodGroup}]` : '';
  const sosMessage = `[IMECS ${triggerLabel}] ${sender}${medicalBrief} is in distress! Location: Lat ${latitude}, Lng ${longitude}. Maps: ${mapsLink} (Battery: ${battery}%, Route: ${channel})`;

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
  const simulateFlag = process.env.SIMULATE_SMS === 'true';

  const useTwilio = twilioSid && twilioAuthToken && twilioPhone && !simulateFlag;
  let dispatchLogs = [];

  // Initialize Twilio client if configured
  let client;
  if (useTwilio) {
    client = twilio(twilioSid, twilioAuthToken);
  }

  // Loop through and notify contacts
  for (const contact of activeContacts) {
    let status = 'Simulated';
    let messageSid = 'MOCK_SID_' + Math.random().toString(36).substring(2, 9).toUpperCase();
    let error = null;

    if (useTwilio) {
      try {
        const message = await client.messages.create({
          body: sosMessage,
          from: twilioPhone,
          to: contact.phone
        });
        status = 'Sent';
        messageSid = message.sid;
      } catch (err) {
        status = 'Failed';
        error = err.message || err;
        console.error(`[Twilio Error] Failed to send SMS to ${contact.name} (${contact.phone}):`, err);
      }
    } else {
      console.log(`[SIMULATED SMS] To: ${contact.name} (${contact.phone}) - Msg: "${sosMessage}"`);
    }

    dispatchLogs.push({
      contactId: contact.id,
      name: contact.name,
      phone: contact.phone,
      status,
      messageSid,
      error
    });
  }

  // Build the alert database record with breadcrumb history & medical profile
  const newAlert = {
    id: 'ALERT_' + Date.now(),
    timestamp,
    sender,
    triggerType: mode,
    latitude,
    longitude,
    batteryLevel: battery,
    signalStrength: signalStrength || -70,
    latency: latency || 40,
    chosenChannel: channel,
    messageContent: sosMessage,
    medicalProfile: medicalProfile,
    breadcrumbs: [
      { latitude, longitude, timestamp }
    ],
    contactsNotifiedCount: activeContacts.length,
    dispatchLogs,
    isSimulated: isSimulated || false
  };

  // Save the alert record
  const alerts = readJSON(ALERTS_FILE, []);
  alerts.unshift(newAlert); // Newest first
  writeJSON(ALERTS_FILE, alerts);

  // Broadcast alert to connected dashboards
  broadcastEvent('sos_triggered', newAlert);

  res.status(201).json({
    message: 'SOS Alert triggered successfully',
    alert: newAlert,
    gateway: useTwilio ? 'Twilio Carrier' : 'Mock SMS Gateway (Simulated)'
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

  writeJSON(ALERTS_FILE, alerts);

  // Broadcast live location update to dashboards
  broadcastEvent('sos_breadcrumb', { alertId: id, breadcrumb, alert });

  res.json({ message: 'Live breadcrumb logged', breadcrumb });
});

// Clear all alerts log
app.post('/api/alerts/clear', (req, res) => {
  writeJSON(ALERTS_FILE, []);
  broadcastEvent('logs_cleared', {});
  res.json({ message: 'Alert history cleared' });
});

// Start listening if executed directly
const serverIp = getLocalIp();
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=============================================================`);
    console.log(` IMECS SOS Emergency Communication Backend Active on Port ${PORT}`);
    console.log(` - Local Portal Hub:   http://localhost:${PORT}/index.html`);
    console.log(` - Mobile Phone link:  http://${serverIp}:${PORT}/index.html`);
    console.log(`=============================================================`);
  });
}

module.exports = app;
