# Azure DevOps CI/CD & Project Management Guide for IMECS

This document outlines the complete setup procedure for hosting, managing, testing, and deploying the **IMECS (Intelligent Multi-Layer Emergency Communication System)** using **Azure DevOps Services**.

---

## 1. Project Management in Azure Boards (SPM Alignment)

For Software Project Management (SPM ISWE306L), the project structure is broken down into an Agile Scrum backlog:

### Hierarchy
- **Epics**: High-level strategic modules of the IMECS architecture (e.g., Emergency Detection, Adaptive Decision Engine, Caregiver Monitoring, Delivery Assurance).
- **Features**: Functional units (e.g., Accelerometer Shake Detection, Twilio SMS Dispatch, Medical Emergency ID).
- **User Stories & Tasks**: Developer-level units with estimation (Story Points / Hours) and Acceptance Criteria.

### Importing the Backlog
Use the provided `azure-devops/work-items-backlog.json` to view or import the work items directly into your Azure DevOps Boards.

---

## 2. Setting Up Azure Repos

1. Log in to [Azure DevOps](https://dev.azure.com/).
2. Create a new Organization / Project: `IMECS-Emergency-System`.
3. Go to **Repos** > **Files**.
4. Push your existing local git repository to Azure Repos:
   ```bash
   git remote add azure https://your-org@dev.azure.com/your-org/IMECS-Emergency-System/_git/IMECS-Emergency-System
   git push -u azure --all
   ```

---

## 3. Configuring Azure Pipelines (CI/CD)

The repository includes a ready-to-use multi-stage pipeline definition in [`azure-pipelines.yml`](../azure-pipelines.yml).

### Pipeline Stages
1. **Stage 1: Build & Automated Tests (`BuildAndTest`)**
   - Provisions an Ubuntu build agent.
   - Sets up Node.js 20.x runtime.
   - Executes clean dependency installation via `npm ci`.
   - Executes the automated test suite via `npm test`.
   - Packages the tested build into a drop artifact.
2. **Stage 2: Continuous Deployment (`DeployToAzure`)**
   - Triggers automatically upon successful merge to `main`.
   - Deploys the package to Azure App Service for Linux.

### Creating the Pipeline in Azure DevOps
1. Go to **Pipelines** > **Pipelines** > Click **New Pipeline**.
2. Select **Azure Repos Git** > Choose `IMECS-Emergency-System`.
3. Select **Existing Azure Pipelines YAML file**.
4. Path: Select `/azure-pipelines.yml`.
5. Click **Run** to execute the pipeline.

---

## 4. Setting Up Service Connection to Azure Subscription

To enable Stage 2 deployment:
1. In Azure DevOps, go to **Project Settings** (bottom left).
2. Select **Service connections** > Click **New service connection**.
3. Select **Azure Resource Manager** > **Service principal (automatic)**.
4. Name the connection: `Azure-DevOps-Service-Connection` (matches `azure-pipelines.yml`).
5. Authorize and Save.

---

## 5. Pipeline Environment Variables

In Azure Pipelines > **Library** > **Variable Groups**, you can configure production secrets:
- `TWILIO_ACCOUNT_SID`: (Your Twilio account SID)
- `TWILIO_AUTH_TOKEN`: (Your Twilio Auth Token)
- `TWILIO_PHONE_NUMBER`: (Your Twilio virtual phone number)
- `SIMULATE_SMS`: `false` (in live production) or `true` (in demo staging)
