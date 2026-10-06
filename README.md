# IMECS — Intelligent Multi-Layer Emergency Communication System

IMECS is a hybrid emergency communication system designed for elderly care, providing robust SOS alerts, manual caregiver contact management, GPS-based tracking, and multiple message-transmission failovers. It evaluates connection parameters (Signal, Latency, Battery, Success rate) to adaptively choose the best channel.

## System Features
1. **Elderly Trigger App**: A distraction-free UI featuring a massive red SOS button, an automatic 5-second countdown to prevent accidental triggers, device status checks, and a live scoring engine simulating the IMECS adaptive decision model.
2. **Caregiver Command Dashboard**: An interactive central monitoring map using Leaflet.js and OpenStreetMap to display exact GPS coordinates, detailed event lists, and simulated metrics (hops, latency, active nodes).
3. **Manual Contact Management**: Add, update, delete, or deactivate caregiver phone numbers stored locally in a lightweight JSON database.
4. **Twilio SMS Gateway Integration**: Supports real-time text message alerts containing direct Google Maps links. Defaults to a visual logging simulator if no API keys are provided, allowing full local operation.
5. **SSE Real-time Stream**: Live notification updates pushed from the backend to active dashboards immediately on distress trigger.

---

## Getting Started

### 1. Prerequisites
Ensure you have **Node.js** (v18 or higher) installed on your system.

### 2. Installation
1. Open a terminal/command prompt in the `sos-emergency-system` directory.
2. Install the necessary dependencies:
   ```bash
   npm install
   ```

### 3. Configuration
Copy or edit the `.env` file in the root folder:
```env
PORT=3000
SIMULATE_SMS=true

# Twilio SMS Configuration (Optional)
# Fill these in and set SIMULATE_SMS=false to enable real SMS messages
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=your_twilio_purchased_phone_number
```

### 4. Running the Application
Start the server in development mode:
```bash
npm run dev
```

Alternatively, run in production mode:
```bash
npm start
```

Once started, access the portals using the URLs below:
- **System Portal Hub**: [http://localhost:3000](http://localhost:3000)
- **Elderly SOS Trigger App**: [http://localhost:3000/trigger.html](http://localhost:3000/trigger.html)
- **Caregiver Control Dashboard**: [http://localhost:3000/dashboard.html](http://localhost:3000/dashboard.html)

---

## Database Architecture
- **Contacts**: Stored in `data/contacts.json` containing contact mappings (`id`, `name`, `phone`, `relationship`, `active`).
- **Incidents Log**: Stored in `data/alerts.json` containing all triggered SOS events, coordinates, battery statuses, and SMS transmission logs.
