# OpenRx i18n Translation Migration Plan

## Overview

The i18n infrastructure is deployed: `react-i18next` + server-configured `LANGUAGE` env var.
61 components need hardcoded English strings replaced with `t('key')` calls.

## Approach

Each phase adds translation keys to the JSON files and migrates components using `useTranslation()`.
After each phase, build and deploy to verify.

---

## Phase 1: Layout & Navigation (Critical — visible on every page)

**Components:** TopBar, AppLayout, ProtectedRoute, VoiceInput, ImagingUpload, AvatarUpload

**New JSON keys needed (`common.json`):**

```json
{
  "topbar": {
    "search": "Search patients...",
    "notifications": "Notifications",
    "profile": "Profile",
    "settings": "Settings"
  },
  "layout": {
    "licenseExpiring": "Your free trial period will be expiring in {days} day(s). Please activate a license to continue using OpenRx without interruption.",
    "licenseExpired": "Your license has expired. Please renew to restore full access.",
    "activateLicense": "Activate License",
    "renewLicense": "Renew License",
    "uploadDocument": "Upload Document",
    "uploadXray": "Upload X-Ray / DICOM",
    "uploadLab": "Upload Lab Document",
    "clickToDictate": "Click mic to dictate...",
    "authenticationRequired": "Authentication required. Please log in first.",
    "uploadFailed": "Upload failed. Please try again."
  },
  "sidebar": {
    "expand": "Expand",
    "collapse": "Collapse"
  }
}
```

---

## Phase 2: Auth Pages (Public-facing)

**Components:** LoginPage, RegisterPage, CallbackPage

**Already have translation keys** — just replace hardcoded strings with `t()` calls.
RegisterPage is already English-only; needs `useTranslation()` hook.

---

## Phase 3: Core Clinical (Most-used features)

**Components:** DashboardPage, ProviderDashboardPage, PatientSearchPage, PatientDetailPage, EncounterListPage, EncounterDetailPage, VitalSignsForm

**New JSON keys needed:**

```json
{
  "dashboard": {
    "clinicOverview": "Clinic Overview",
    "totalPatients": "Total Patients",
    "todayAppointments": "Today's Appointments",
    "pendingClaims": "Pending Claims",
    "recentMessages": "Recent Messages",
    "quickActions": "Quick Actions",
    "newPatient": "New Patient",
    "scheduleAppt": "Schedule Appointment",
    "todaysPatients": "Today's Patients",
    "waitingInProgress": "Waiting / In Progress",
    "completed": "Completed",
    "assignedPatients": "Assigned Patients",
    "recentEncounters": "Recent Encounters",
    "noAppointments": "No appointments today",
    "allProviders": "All Providers",
    "schedule": "Schedule"
  },
  "patients": {
    "searchRegister": "Search & Register",
    "searchPlaceholder": "Search by name, phone, email, or ID...",
    "addPatient": "Add Patient",
    "patientDetails": "Patient Details",
    "demographics": "Demographics",
    "contactInfo": "Contact Information",
    "primaryProvider": "Primary Care Provider",
    "selectProvider": "Select Provider",
    "noPatients": "No patients found",
    "registrationForm": "Patient Registration",
    "country": "Country",
    "firstName": "First Name",
    "lastName": "Last Name",
    "dateOfBirth": "Date of Birth",
    "sex": "Sex",
    "email": "Email",
    "phone": "Phone",
    "street": "Street",
    "city": "City",
    "register": "Register Patient"
  },
  "encounters": {
    "encounters": "Encounters",
    "newEncounter": "New Encounter",
    "encounterDetails": "Encounter Details",
    "visitDetails": "Visit Details",
    "soapNotes": "SOAP Notes",
    "vitalSigns": "Vital Signs",
    "billing": "Billing",
    "date": "Date",
    "reason": "Reason",
    "facility": "Facility",
    "provider": "Provider",
    "noEncounters": "No encounters recorded",
    "noVitals": "No vital signs recorded for this encounter"
  },
  "vitals": {
    "bloodPressure": "Blood Pressure",
    "pulse": "Pulse",
    "temperature": "Temperature",
    "respiration": "Respiration",
    "weight": "Weight",
    "height": "Height",
    "bmi": "BMI",
    "oxygenSaturation": "Oxygen Saturation",
    "notes": "Notes",
    "mmHg": "mmHg",
    "bpm": "bpm",
    "breathsPerMin": "breaths/min",
    "kg": "kg",
    "cm": "cm",
    "percent": "%"
  }
}
```

---

## Phase 4: Scheduling & Appointments

**Components:** AppointmentCalendarPage, PatientFlowBoard, RecallBoard, DrugScreeningPage, AppointmentCreateModal

**New JSON keys needed:**

```json
{
  "appointments": {
    "calendar": "Appointment Calendar",
    "newAppointment": "New Appointment",
    "patientFlow": "Patient Flow Board",
    "recall": "Recall Board",
    "drugScreening": "Drug Screening",
    "provider": "Provider",
    "patient": "Patient",
    "date": "Date",
    "time": "Time",
    "type": "Visit Type",
    "status": "Status",
    "waiting": "Waiting",
    "inExam": "In Exam",
    "checkedOut": "Checked Out",
    "noShows": "No Shows",
    "day": "Day",
    "week": "Week",
    "month": "Month",
    "today": "Today",
    "previous": "Previous",
    "next": "Next",
    "noAppointments": "No appointments scheduled"
  }
}
```

---

## Phase 5: Clinical Features

**Components:** LabsPage, ReferralsPage, ClinicalDecisionSupport, EyeExamPage, CamosPage, GroupTherapyPage, TemplatesPage, FdaLookupPage

**New JSON keys needed:**

```json
{
  "labs": {
    "title": "Lab Orders & Results",
    "patientId": "Patient ID",
    "instructions": "Instructions",
    "clinicalHistory": "Clinical History",
    "orderLab": "Order Lab",
    "orders": "Orders for Patient",
    "noOrders": "No orders",
    "results": "Results for Order",
    "addResult": "Add Result",
    "report": "Report",
    "collected": "Collected",
    "code": "Code",
    "name": "Name",
    "value": "Value",
    "units": "Units",
    "range": "Range",
    "uploadLabDoc": "Upload Lab Documents to Backblaze B2"
  },
  "referrals": {
    "title": "Referrals",
    "patientId": "Patient ID",
    "referTo": "Refer to Provider",
    "title_": "Referral Title",
    "body": "Referral Notes",
    "urgency": "Urgency",
    "routine": "Routine",
    "urgent": "Urgent",
    "stat": "STAT",
    "submit": "Submit Referral"
  },
  "fda": {
    "title": "FDA Drug Lookup",
    "searchPlaceholder": "Search drug name...",
    "category": "Category",
    "drugs": "Drugs",
    "devices": "Devices",
    "food": "Food",
    "indications": "Indications",
    "warnings": "Warnings",
    "dosage": "Dosage",
    "noResults": "No results found"
  },
  "cds": {
    "title": "Clinical Decision Support",
    "rules": "Rules",
    "alerts": "Alerts",
    "history": "History",
    "noAlerts": "No active alerts"
  }
}
```

---

## Phase 6: Documents & Imaging

**Components:** DocumentsPage, DicomViewerPage

**New JSON keys needed:**

```json
{
  "documents": {
    "title": "Secure Documents",
    "upload": "Upload",
    "myDocuments": "My Documents",
    "verifyCode": "Verify Code",
    "selectFile": "Select a file to upload",
    "category": "Category",
    "pid": "Patient ID (optional)",
    "notes": "Notes",
    "uploadBtn": "Upload to B2",
    "accessCode": "Access Code",
    "shareCode": "Share this 4-digit code with the recipient",
    "enterCode": "Enter 4-digit code",
    "verifyBtn": "Verify & Download",
    "noDocs": "No documents uploaded yet",
    "pending": "Pending",
    "accepted": "Accepted",
    "rejected": "Rejected",
    "expired": "Expired"
  },
  "dicom": {
    "title": "DICOM / X-Ray Viewer",
    "dropFiles": "Drop DICOM file here or click to select",
    "uploadXray": "Upload X-Ray",
    "windowLevel": "Window/Level",
    "zoom": "Zoom",
    "presetLung": "Lung",
    "presetBone": "Bone",
    "presetAbdomen": "Abdomen",
    "metadata": "Metadata",
    "noImage": "No image loaded"
  }
}
```

---

## Phase 7: Billing & Reports

**Components:** BillingDashboardPage, MedicalBillingPage, ReportsPage, SurveillancePage

**New JSON keys needed:**

```json
{
  "billing": {
    "dashboard": "Billing Dashboard",
    "medicalBilling": "Medical Billing",
    "outstandingBalance": "Outstanding Balance",
    "recentTransactions": "Recent Transactions",
    "claims": "Claims",
    "submitClaim": "Submit Claim",
    "postPayment": "Post Payment",
    "cptCodes": "CPT Codes",
    "icdCodes": "ICD-10 Codes"
  },
  "reports": {
    "title": "Reports & Analytics",
    "export": "Export",
    "dateRange": "Date Range",
    "appointments": "Appointments",
    "clinical": "Clinical",
    "financial": "Financial",
    "surveillance": "Surveillance",
    "noData": "No report data available"
  }
}
```

---

## Phase 8: Admin & Management

**Components:** AdminPage, DbAdminPage, ProvidersPage, ProviderProfilePage, DisclosuresPage, LicensePage

**LicensePage is already done.** AdminPage and DbAdminPage need translation.

```json
{
  "admin": {
    "title": "Administration",
    "users": "Users",
    "facilities": "Facilities",
    "lookupLists": "Lookup Lists",
    "notifications": "Notifications",
    "chartTracking": "Chart Tracking",
    "settings": "Settings",
    "pendingRegistrations": "Pending Registrations",
    "reviewWindow": "30-Day Review Window",
    "reviewMessage": "Pending registrations must be approved or rejected within 30 days.",
    "approve": "Approve",
    "reject": "Reject",
    "daysLeft": "day(s) left",
    "noPending": "No pending registrations",
    "allReviewed": "All staff applications have been reviewed."
  },
  "dbAdmin": {
    "title": "Database Administration",
    "tables": "Tables",
    "schema": "Schema",
    "sqlQuery": "SQL Query",
    "runQuery": "Run Query",
    "results": "Results",
    "noTableSelected": "Select a table to view schema"
  }
}
```

---

## Phase 9: Help & Messaging

**Components:** HelpFaqPage, WikiPage, HowToPage, MessagesPage, DirectMessagingPage

**New JSON keys needed:**

```json
{
  "help": {
    "faq": "Help & FAQ",
    "wiki": "OpenRx Wiki",
    "howTo": "How-To Guide",
    "searchHelp": "Search help articles...",
    "categories": "Categories",
    "noResults": "No results found",
    "expandAll": "Expand All",
    "collapseAll": "Collapse All",
    "stillNeedHelp": "Still need help?",
    "emailSupport": "Email Support",
    "quickLinks": "Quick Links"
  },
  "messages": {
    "inbox": "Inbox",
    "compose": "Compose",
    "directMsg": "Direct Messaging",
    "to": "To",
    "subject": "Subject",
    "body": "Message",
    "send": "Send",
    "noMessages": "No messages"
  }
}
```

---

## Phase 10: Patient Portal

**Components:** PatientLoginPage, PatientPortalDashboard, PatientMessagePage, PatientPaymentPage, PatientRecordsPage, PatientRegistrationPage

```json
{
  "portal": {
    "login": "Patient Portal Login",
    "dashboard": "Patient Dashboard",
    "messageProvider": "Message Your Provider",
    "makePayment": "Make a Payment",
    "records": "Medical Records",
    "register": "Register",
    "recentVitals": "Recent Vitals",
    "medications": "Medications",
    "allergies": "Allergies",
    "conditions": "Conditions",
    "noVitals": "No vitals recorded",
    "amount": "Amount",
    "cardNumber": "Card Number",
    "payNow": "Pay Now",
    "back": "Back",
    "sent": "Message sent! Your provider will respond shortly."
  }
}
```

---

## Migration Order Summary

| Phase | Pages | Est. Keys | Priority |
|-------|-------|-----------|----------|
| 1 | Layout (6 components) | ~20 keys | 🔴 Critical |
| 2 | Auth (3 pages) | ~15 keys (already have) | 🔴 Critical |
| 3 | Core Clinical (7 pages) | ~60 keys | 🟠 High |
| 4 | Scheduling (5 pages) | ~25 keys | 🟠 High |
| 5 | Clinical Features (8 pages) | ~50 keys | 🟡 Medium |
| 6 | Documents & Imaging (2 pages) | ~30 keys | 🟡 Medium |
| 7 | Billing & Reports (4 pages) | ~25 keys | 🟡 Medium |
| 8 | Admin (5 pages) | ~30 keys | 🟢 Lower |
| 9 | Help & Messaging (5 pages) | ~25 keys | 🟢 Lower |
| 10 | Patient Portal (6 pages) | ~25 keys | 🟢 Lower |

## For Each Phase

1. Add new keys to `i18n/en/common.json` and `i18n/es/common.json`
2. In each component: `import { useTranslation } from 'react-i18next'` + `const { t } = useTranslation()`
3. Replace strings: `"Patients"` → `{t('patients.searchRegister')}`
4. Build: `cd interface/new && npm run build`
5. Deploy: `rsync` to server

## Testing Spanish

```bash
# On server:
sed -i "s/LANGUAGE=en/LANGUAGE=es/" /home/dev/openrx/backend/.env
pm2 restart openrx-backend
# Hard refresh browser
```
