const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.PORT = '3099';
process.env.SIMULATE_SMS = 'true';

const app = require('../server');

let server;
const BASE_URL = 'http://127.0.0.1:3099';

// Helper to make HTTP requests in tests
function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, data: json });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

test.before(async () => {
  await new Promise(resolve => {
    server = app.listen(3099, '127.0.0.1', resolve);
  });
});

test.after(async () => {
  await new Promise(resolve => {
    server.close(resolve);
  });
});

test('GET /api/system-info returns local network and simulation status', async () => {
  const res = await request('GET', '/api/system-info');
  assert.strictEqual(res.status, 200);
  assert.ok(res.data.localIp);
  assert.strictEqual(res.data.simulateSms, true);
});

test('GET /api/medical-profile returns vital health ID', async () => {
  const res = await request('GET', '/api/medical-profile');
  assert.strictEqual(res.status, 200);
  assert.ok(res.data.bloodGroup, 'Should contain bloodGroup');
  assert.ok(Array.isArray(res.data.chronicConditions), 'Should contain chronicConditions array');
});

test('POST /api/medical-profile updates emergency profile', async () => {
  const update = {
    fullName: 'Test Patient',
    age: 75,
    bloodGroup: 'B+',
    chronicConditions: ['Hypertension'],
    allergies: ['None'],
    medications: ['Aspirin'],
    emergencyNotes: 'Test notes'
  };

  const res = await request('POST', '/api/medical-profile', update);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.profile.bloodGroup, 'B+');

  const check = await request('GET', '/api/medical-profile');
  assert.strictEqual(check.data.bloodGroup, 'B+');
});

test('Contacts API CRUD operations', async () => {
  // 1. GET contacts
  const initial = await request('GET', '/api/contacts');
  assert.strictEqual(initial.status, 200);
  assert.ok(Array.isArray(initial.data));

  // 2. CREATE contact
  const newContact = {
    name: 'CI/CD Automated Contact',
    phone: '+919999000011',
    relationship: 'Caregiver',
    active: true
  };
  const created = await request('POST', '/api/contacts', newContact);
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.data.name, newContact.name);
  const contactId = created.data.id;

  // 3. UPDATE contact
  const updated = await request('PUT', `/api/contacts/${contactId}`, {
    name: 'CI/CD Updated Contact',
    active: true
  });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.data.name, 'CI/CD Updated Contact');

  // 4. DELETE contact
  const deleted = await request('DELETE', `/api/contacts/${contactId}`);
  assert.strictEqual(deleted.status, 200);
});

test('POST /api/sos triggers distress alert with medical ID & breadcrumbs', async () => {
  const payload = {
    latitude: 12.9716,
    longitude: 79.1594,
    senderName: 'Test Elderly User',
    batteryLevel: 65,
    signalStrength: -80,
    latency: 50,
    chosenChannel: 'Cellular Data',
    triggerType: 'shake',
    isSimulated: true
  };

  const res = await request('POST', '/api/sos', payload);
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.data.alert.sender, 'Test Elderly User');
  assert.strictEqual(res.data.alert.triggerType, 'shake');
  assert.ok(res.data.alert.medicalProfile, 'Should attach medical profile');
  assert.strictEqual(res.data.alert.breadcrumbs.length, 1);
  assert.strictEqual(res.data.alert.breadcrumbs[0].latitude, 12.9716);

  const alertId = res.data.alert.id;

  // Test Breadcrumb live motion update
  const breadcrumbRes = await request('POST', `/api/sos/${alertId}/breadcrumb`, {
    latitude: 12.9720,
    longitude: 79.1600
  });
  assert.strictEqual(breadcrumbRes.status, 200);
  assert.strictEqual(breadcrumbRes.data.breadcrumb.latitude, 12.9720);

  // Test Two-Way Handshake Acknowledgment
  const ackRes = await request('POST', `/api/sos/${alertId}/acknowledge`, {
    responderName: 'Harsh Jain',
    etaMinutes: 8,
    note: 'Ambulance & family dispatched'
  });
  assert.strictEqual(ackRes.status, 200);
  assert.strictEqual(ackRes.data.alert.acknowledgment.responderName, 'Harsh Jain');
  assert.strictEqual(ackRes.data.alert.acknowledgment.etaMinutes, 8);
});

test('GET /api/public-emergency-pass returns first-responder medical data', async () => {
  const res = await request('GET', '/api/public-emergency-pass');
  assert.strictEqual(res.status, 200);
  assert.ok(res.data.fullName);
  assert.ok(res.data.bloodGroup);
  assert.ok(Array.isArray(res.data.primaryContacts));
});
