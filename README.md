# IMECS — Intelligent Multi-Layer Emergency Communication System
### Powered by Microsoft Azure Cloud Suite & Multi-Channel Adaptive Fallover

IMECS is an advanced hybrid emergency communication system designed for elderly care and high-risk environments. It combines **Microsoft Azure Communication Services (ACS)**, **Azure IoT Hub Telemetry**, **Azure AI Clinical Triage**, **Azure Blob Storage**, real-time GPS tracking, automatic fall detection, and multiple message-transmission failovers (Azure ACS -> Twilio -> LoRa Mesh -> Local Simulation).

---

## 🌟 Key New Features & Microsoft Azure Cloud Integrations

### 1. ☁️ Microsoft Azure Cloud Suite
- **Azure Communication Services (ACS) SMS & Voice Gateway**:
  - Direct enterprise SMS dispatch to emergency contacts.
  - Multi-Cloud Hybrid failover: dispatches via Azure ACS first; automatically falls back to Twilio if ACS fails, and to local visual simulation if no cloud keys are provided.
  - Test SMS dispatch tool built directly into the Caregiver Command Dashboard.
- **Azure IoT Hub Wearable Device Twin & Telemetry Stream**:
  - Live vital signs monitoring: **Heart Rate (BPM)** with pulsing animation, **Blood Oxygen (SpO2 %)**, **Skin Temperature (°C)**, and **Impact G-Force**.
  - Server-Sent Events (SSE) push live vitals directly to caregiver screens in real time.
- **Azure AI Emergency Clinical Triage Advisor**:
  - Instant automated clinical triage analysis for every incoming SOS distress event.
  - Generates triage priority levels:
    - 🔴 **RED (Critical)**: Fall detected, cardiac strain (HR > 125 or < 45 BPM), or low SpO2 (< 90%). 5-minute response urgency.
    - 🟠 **ORANGE (Urgent)**: Geofence perimeter breach, moderate physiological strain, low battery. 15-minute response urgency.
    - 🟡 **YELLOW (Standard Assistance)**: Normal vitals, manual button press.
  - Recommends actionable first-responder instructions (e.g. cervical collar, portable AED, IV fluids).
- **Azure Blob Storage Cloud Incident Archival**:
  - Automatically archives distress incident JSON records, patient vitals, GPS fixes, and audio memos to Azure Blob Storage container `sos-incident-records`.
  - One-click "Sync Incidents to Azure" button on the dashboard.

### 2. ⚠️ Automatic Fall Detection Sensor
- Uses the device's hardware **3D Accelerometer** via the HTML5 `DeviceMotionEvent` API ($a = \sqrt{x^2+y^2+z^2}$).
- Detects sudden high-G impacts (> 2.6G / 26 m/s²) followed by stillness.
- Automatically triggers a loud 10-second emergency siren with an on-screen cancel button ("Cancel Alert") to prevent false alarms.
- Dedicated **"Test Fall"** button on the UI for quick demonstration on any device.

### 3. 🎙️ Emergency Voice Memo Recorder
- Tap **"Record Voice"** in the SOS Trigger app to capture a 5-second voice message ("I fell down in the living room, need help!").
- Audio is encoded and transmitted alongside the SOS distress packet.
- Caregivers and first responders can listen to the audio recording directly in the dashboard incident feed!

### 4. 📋 Emergency Medical ID Profile
- Comprehensive patient medical profile: Full Name, Age, **Blood Group** (e.g. O+, A-), **Known Allergies** (e.g. Penicillin), **Pre-existing Conditions** (e.g. Hypertension, Cardiac Risk), **Daily Medications**, **Primary Doctor**, and **Preferred Emergency Hospital**.
- Transmitted in the SOS alert payload and SMS notification so first responders know critical medical precautions immediately.
- Fully editable in the Caregiver Command Dashboard under the **"Medical ID"** tab.

### 5. 🛡️ Interactive Safe Zone Geofencing
- Customizable residential perimeter circle drawn on the interactive Leaflet map.
- Configure latitude, longitude, and safe radius (100m to 3,000m) with an interactive slider.
- Triggers a real-time perimeter breach alert if the senior citizen wanders outside the safe zone.

### 6. 🏥 Nearest Emergency Hospitals & Navigation
- Pre-plotted trauma centers on the Leaflet map (e.g. Apollo Specialty Emergency Care, CMC Trauma Center).
- Direct **"Navigate to Patient"** and **"Directions to Hospital"** one-click buttons linking into Google Maps and Apple Maps.

### 7. 🚑 Two-Way Emergency Reassurance Handshake & ETA Dispatch
- Caregivers can click **"Acknowledge & Send ETA"** directly on any incoming distress incident.
- Instantly notifies the senior citizen on their screen: *"HELP IS ON THE WAY! Harsh Jain acknowledged distress alert and is arriving in ~10 mins."*
- Eliminates senior panic during critical minutes before physical arrival.

### 8. 🚨 IMECS VitalPass™ (Paramedic & First-Responder Pass)
- Open `/pass.html` or scan the emergency QR code from any smartphone.
- Displays vital medical ID (Blood group, allergies, conditions, doctor, medications) without requiring account credentials.
- Features 1-tap phone call buttons for emergency contacts and an on-scene **"Report Arrived at Scene"** check-in button that pings caregivers with paramedic GPS coordinates.

### 9. 📱 Offline Native SMS Fallback Protocol
- One-click emergency fallback button (`sms:`) that opens the device's native messaging application pre-filled with real-time GPS coordinates and Google Maps navigation link when cellular data or Wi-Fi is down.

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** (v18 or higher installed).
- A modern web browser (Google Chrome, Microsoft Edge, or Apple Safari).

### 2. Installation
Open PowerShell or Command Prompt in the project directory:
```bash
npm install
```

### 3. Configuration (`.env`)
The system works out-of-the-box in **Simulated Mode** without needing any paid accounts or API keys. To connect real Microsoft Azure or Twilio services, configure `.env`:

```env
PORT=3000

# Gateway Provider Selection: 'simulated' | 'azure' | 'twilio' | 'hybrid'
GATEWAY_PROVIDER=simulated
SIMULATE_SMS=true

# Microsoft Azure Communication Services (ACS) Credentials (Optional)
# Connection string: endpoint=https://<resource>.communication.azure.com/;accesskey=<key>
AZURE_COMMUNICATION_CONNECTION_STRING=
AZURE_COMMUNICATION_PHONE_NUMBER=

# Microsoft Azure Storage (Blob Storage for incident & audio archives) (Optional)
AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_CONTAINER_NAME=sos-incident-records

# Microsoft Azure IoT Hub Connection (Optional)
AZURE_IOT_HUB_CONNECTION_STRING=

# Twilio SMS Credentials (Optional)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

### 4. Running the Application
Start the server:
```bash
npm start
```
Or with auto-reload:
```bash
npm run dev
```

### 5. Accessing the Portals
- **System Portal Hub**: [http://localhost:3000](http://localhost:3000)
- **Elderly SOS Trigger App**: [http://localhost:3000/trigger.html](http://localhost:3000/trigger.html)
- **Caregiver Command Dashboard**: [http://localhost:3000/dashboard.html](http://localhost:3000/dashboard.html)

---

## 📱 Mobile Device Connection (iPhone & Android)
1. Ensure your PC and smartphone are connected to the **same Wi-Fi network**.
2. Open the Portal Hub on your PC ([http://localhost:3000](http://localhost:3000)) and scan the QR code using your phone's camera.
3. **iPhone (Safari)**: Tap the Share button &rarr; select **"Add to Home Screen"** to run as a full-screen native SOS app.
4. **Android (Chrome)**: Tap the Chrome Menu &rarr; select **"Install App"** to install as a PWA.

---

## 📁 Database Architecture
- `data/contacts.json`: Emergency contact numbers, names, and active alerts state.
- `data/alerts.json`: Complete history of triggered SOS incidents, coordinates, triage ratings, and audio URLs.
- `data/medical_profile.json`: Patient health records, blood group, allergies, medications, and geofence parameters.
- `data/uploads/`: Recorded emergency voice memos (`.webm`).
