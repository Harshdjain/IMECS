# Changelog

All notable changes to the **IMECS (Intelligent Multi-Layer Emergency Communication System)** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-10-21

### 🚀 Major Additions & Cloud Integration
- **Microsoft Azure Cloud Suite**:
  - Integrated **Azure Communication Services (ACS)** for enterprise SMS and voice alert dispatch.
  - Implemented multi-cloud hybrid failover: Azure ACS &rarr; Twilio Cloud Carrier &rarr; Local Simulation.
  - Connected **Azure IoT Hub Device Twin** streaming real-time vitals telemetry: Heart Rate (BPM), Blood Oxygen ($\text{SpO}_2\%$), Skin Temperature, and impact G-force.
  - Built **Azure AI Clinical Emergency Triage Advisor** classifying distress events into RED (Critical), ORANGE (Urgent), and YELLOW (Standard) with automated first-responder guidance.
  - Integrated **Azure Blob Storage** for asynchronous cloud archival of incident records and emergency voice memos.
- **Paramedic & First-Responder VitalPass™ (`pass.html`)**:
  - Public-facing emergency medical card accessible without login via QR code or direct link.
  - Displays blood group, critical drug allergies, chronic conditions, daily medications, primary doctor, and hospital.
  - Integrated 1-tap phone dialer for caregivers and an on-scene check-in button alerting family that emergency responders have arrived.
- **Two-Way Emergency Reassurance Handshake & ETA Dispatch**:
  - Caregivers can click "Acknowledge & Send ETA" on incoming alerts (`POST /api/sos/:id/acknowledge`).
  - Automatically updates the senior's screen via SSE with live reassuring notice: *"Help is on the way! Caregiver acknowledged and is arriving in ~X mins."*
- **Offline Native SMS Fallback Protocol**:
  - 1-tap fallback button (`sms:?body=...`) pre-populating native messaging with live GPS coordinates and an isolated Google Maps link when data/Wi-Fi is down.
- **Hardware Fall Detection & Voice Memos**:
  - 3D Accelerometer impact detection via HTML5 `DeviceMotionEvent` with 10-second cancel siren.
  - 6-second Web Audio voice memo recorder with instant cloud upload.
- **Theme & Accessibility**:
  - Full Light Mode UI system design.
  - High-visibility yellow emergency trigger accents (`#ffd000` / `#eab308`).

### 🧪 Testing & CI/CD
- 6 automated unit tests using Node.js native test runner (`node --test`).
- Compatible with Azure DevOps Pipelines (`azure-pipelines.yml`) and GitHub Actions.

---

## [1.0.0] - 2026-10-06

### ✨ Initial Release
- Multi-layer emergency routing (Cellular Data, Twilio SMS, LoRa Mesh).
- Single-touch SOS trigger app.
- Real-time caregiver command dashboard with Leaflet interactive map.
- Safe zone circular geofencing.
- Emergency contacts CRUD management.
- Initial Docker container configuration.
