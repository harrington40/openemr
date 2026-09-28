import { useState, useRef, useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import nestClient from '../../api/nest-client';

interface VideoItem {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: string;
  streamUrl?: string;
  createdAt: string;
  uploaderUserId: number;
}

interface HowToStep {
  step: number;
  instruction: string;
  detail?: string;
}

interface HowToSection {
  id: string;
  title: string;
  icon: string;
  description: string;
  steps: HowToStep[];
  quickLink?: { to: string; label: string };
}

const HOW_TO_DATA: HowToSection[] = [
  // ── Dashboard ────────────────────────────────────────────────
  {
    id: 'dashboard',
    title: 'Dashboard & Navigation',
    icon: 'bi-speedometer2',
    description: 'Your central hub for clinic overview and quick access to all features.',
    steps: [
      { step: 1, instruction: 'Log in with your username and password at the login screen.', detail: 'Default admin credentials: admin / Cosinesine900**. Change your password after first login.' },
      { step: 2, instruction: 'View your Provider Dashboard at /provider-dashboard for your personal stats.', detail: 'Shows today\'s appointments, assigned patients, and quick actions.' },
      { step: 3, instruction: 'Use the Clinic Overview dashboard at /dashboard for practice-wide metrics.', detail: 'Total patients, daily appointments, pending claims, and recent messages.' },
      { step: 4, instruction: 'Navigate using the sidebar menu on the left.', detail: 'Sections expand to reveal sub-pages. Your role determines which sections are visible.' },
    ],
    quickLink: { to: '/dashboard', label: 'Go to Dashboard' },
  },

  // ── Provider Dashboard ──────────────────────────────────────
  {
    id: 'provider-dashboard',
    title: 'Provider Dashboard',
    icon: 'bi-person-badge',
    description: 'Your personal command center showing today\'s appointments, assigned patients, stats, and recent encounters.',
    steps: [
      { step: 1, instruction: 'Click Dashboard → My Dashboard in the sidebar (or go to /provider-dashboard).', detail: 'Available for admin and physician roles. Shows your personal practice overview.' },
      { step: 2, instruction: 'The header displays your name, title, specialty, and NPI number.', detail: 'Shows the current date for context on appointments and stats.' },
      { step: 3, instruction: 'Stats cards show four key metrics at a glance.', detail: 'Total Patients (all assigned), Today\'s Appointments, Waiting/In Progress count, and Completed visits.' },
      { step: 4, instruction: 'Today\'s Appointments table lists all scheduled visits for the current day.', detail: 'Shows time, patient name, appointment type, status (Check In, In Progress, Checkout), and notes. Color-coded by appointment category.' },
      { step: 5, instruction: 'Click on any appointment row to view details or update status.', detail: 'Track patient flow directly from the dashboard without navigating away.' },
      { step: 6, instruction: 'Assigned Patients section lists all patients under your care.', detail: 'Shows patient name, date of birth, sex, phone, and status. Sorted alphabetically.' },
      { step: 7, instruction: 'Recent Visits shows your last 5 documented visits.', detail: 'Quick access to recent encounter details — click to open the full encounter.' },
      { step: 8, instruction: 'Use the All Providers button to view the full provider directory.', detail: 'Navigate to /providers to manage provider profiles and credentials.' },
      { step: 9, instruction: 'Click Schedule to jump to the appointment calendar.', detail: 'Quick shortcut to book new appointments or manage the daily schedule.' },
    ],
    quickLink: { to: '/provider-dashboard', label: 'Go to My Dashboard' },
  },

  // ── Patients ─────────────────────────────────────────────────
  {
    id: 'patients',
    title: 'Patient Search & Registration',
    icon: 'bi-people',
    description: 'Find existing patients or register new ones.',
    steps: [
      { step: 1, instruction: 'Click Patients → Search & Register in the sidebar.', detail: 'This opens the patient search page.' },
      { step: 2, instruction: 'Search by name, phone, email, or patient ID in the search bar.', detail: 'Partial matching is supported — results appear as you type.' },
      { step: 3, instruction: 'Click on a patient row to open their full chart.', detail: 'The chart includes encounters, vitals, medications, allergies, labs, imaging, billing, and documents.' },
      { step: 4, instruction: 'To register a new patient, click the + Add Patient button.', detail: 'Fill in required fields: first name, last name, date of birth, and sex.' },
      { step: 5, instruction: 'Assign a primary care provider from the dropdown.', detail: 'This links the patient to their doctor for access control and scheduling.' },
      { step: 6, instruction: 'Click Save to create the record.', detail: 'The patient will appear in search results immediately.' },
    ],
    quickLink: { to: '/patients', label: 'Go to Patient Search' },
  },

  // ── Providers ────────────────────────────────────────────────
  {
    id: 'providers',
    title: 'Managing Providers',
    icon: 'bi-person-badge',
    description: 'Add, edit, and manage healthcare providers with credentials and calendar settings.',
    steps: [
      { step: 1, instruction: 'Click Patients → Providers in the sidebar.', detail: 'Shows a table of all registered providers.' },
      { step: 2, instruction: 'Click + Add Provider to open the registration form.', detail: 'Fill in username, first name, last name (all required).' },
      { step: 3, instruction: 'Select a Physician Type from the dropdown.', detail: '15 types available: Attending physician, General physician, Consultant, etc.' },
      { step: 4, instruction: 'Enter NPI number, specialty, and taxonomy code.', detail: 'Taxonomy defaults to 207Q00000X (Family Medicine).' },
      { step: 5, instruction: 'Fill in contact info: email, phone, cell.', detail: 'Optional but recommended for communication.' },
      { step: 6, instruction: 'Choose a calendar color for appointment display.', detail: 'Click a color circle or use the color picker.' },
      { step: 7, instruction: 'Click Add Provider to save.', detail: 'The new provider appears in the table. Use Edit to modify or Deactivate to disable.' },
    ],
    quickLink: { to: '/providers', label: 'Go to Providers' },
  },

  // ── Appointments ─────────────────────────────────────────────
  {
    id: 'appointments',
    title: 'Appointments & Scheduling',
    icon: 'bi-calendar-event',
    description: 'Schedule patient visits, manage the daily calendar, and track patient flow.',
    steps: [
      { step: 1, instruction: 'Go to Appointments → Calendar.', detail: 'Shows a day/week/month view color-coded by provider.' },
      { step: 2, instruction: 'Click any time slot or + New Appointment to create one.', detail: 'Select patient, provider, date/time, visit type, and status.' },
      { step: 3, instruction: 'Use the Patient Flow Board (Appointments → Patient Flow) for real-time tracking.', detail: 'Kanban view: drag patients between Waiting, In Exam, Checkout, etc.' },
      { step: 4, instruction: 'Use the Recall Board (Appointments → Recall) for follow-up reminders.', detail: 'Flag patients due for preventive care or chronic disease follow-ups.' },
      { step: 5, instruction: 'Use Drug Screening (Appointments → Drug Screening) to manage screening appointments.', detail: 'Track drug test scheduling and results.' },
    ],
    quickLink: { to: '/appointments', label: 'Go to Calendar' },
  },

  // ── Clinical ─────────────────────────────────────────────────
  {
    id: 'clinical',
    title: 'Clinical Workflows',
    icon: 'bi-heart-pulse',
    description: 'Document encounters, order labs, manage referrals, and use clinical decision support.',
    steps: [
      { step: 1, instruction: 'Open a patient chart, then click Visits to view or create visits.', detail: 'Each encounter captures SOAP notes, vitals, diagnoses, procedures, and prescriptions.' },
      { step: 2, instruction: 'Use Labs (Clinical → Labs) to order lab tests and review results.', detail: 'Enter patient ID, add instructions (e.g. "Fasting 12h"), and click Order Lab. Select an order to add/view results.' },
      { step: 3, instruction: 'Upload lab documents (PDFs, images) via the B2 upload section on the Labs page.', detail: 'Files go to Backblaze B2 secure storage, linked to the patient record.' },
      { step: 4, instruction: 'Create referrals via Clinical → Referrals.', detail: 'Enter patient ID, referral title, body, and referring provider.' },
      { step: 5, instruction: 'Use Clinical Decision Support (Clinical → Decision Support) for evidence-based alerts.', detail: 'Flags drug interactions, suggests screenings, and highlights care gaps.' },
      { step: 6, instruction: 'Use FDA Lookup (Clinical → FDA Lookup) to search drug information.', detail: 'Look up medications by name, check indications, warnings, and dosage.' },
      { step: 7, instruction: 'Use Eye Exam, CAMOS, Group Therapy, and Templates for specialized workflows.', detail: 'Available under the Clinical menu for relevant user roles.' },
    ],
    quickLink: { to: '/labs', label: 'Go to Labs' },
  },

  // ── Vital Signs ─────────────────────────────────────────────
  {
    id: 'vitals',
    title: 'Vital Signs Recording',
    icon: 'bi-heart-pulse',
    description: 'Capture and track patient vitals: blood pressure, pulse, temperature, respiration, weight, height, BMI, and oxygen saturation.',
    steps: [
      { step: 1, instruction: 'Open a patient chart and click the Vitals tab.', detail: 'This shows all previously recorded vital signs in reverse chronological order.' },
      { step: 2, instruction: 'Vitals can be recorded during an encounter.', detail: 'Open an encounter, then click the Vital Signs tab within the encounter detail page.' },
      { step: 3, instruction: 'Blood Pressure is captured as systolic/diastolic (e.g. 120/80 mmHg).', detail: 'The Vitals tab shows a visual BP chart with systolic (top) and diastolic (bottom) trends over time.' },
      { step: 4, instruction: 'Pulse (heart rate) is measured in beats per minute (bpm).', detail: 'Normal resting: 60 to 100 bpm for adults.' },
      { step: 5, instruction: 'Temperature is recorded in Celsius or Fahrenheit.', detail: 'Normal: 36.1 to 37.2 C (97 to 99 F). Fever threshold: above 38 C (100.4 F).' },
      { step: 6, instruction: 'Respiration rate is measured in breaths per minute.', detail: 'Normal: 12 to 20 breaths/min for adults at rest.' },
      { step: 7, instruction: 'Weight (kg/lbs) and Height (cm/in) are recorded to calculate BMI automatically.', detail: 'BMI equals weight(kg) divided by height(m) squared. BMI status (Underweight/Normal/Overweight/Obese) is shown.' },
      { step: 8, instruction: 'Oxygen Saturation (SpO2) is measured as a percentage.', detail: 'Normal: 95 to 100 percent. Below 90 percent may indicate hypoxemia.' },
      { step: 9, instruction: 'View trends over time in the patient chart Vitals tab.', detail: 'BP, weight, and BMI are plotted on charts for easy trend analysis.' },
    ],
    quickLink: { to: '/patients', label: 'Find a Patient' },
  },

  // ── Encounters ───────────────────────────────────────────────
  {
    id: 'encounters',
    title: 'Patient Visits',
    icon: 'bi-clipboard2-pulse',
    description: 'Document patient visits with SOAP notes, vitals, diagnoses, and procedures.',
    steps: [
      { step: 1, instruction: 'From a patient chart, click the Visits tab.', detail: 'Shows a list of all past encounters for this patient.' },
      { step: 2, instruction: 'Click + New Visit to create a visit record.', detail: 'Fill in date, reason, class code (AMB = ambulatory), and facility.' },
      { step: 3, instruction: 'Open an encounter to document clinical details.', detail: 'Record SOAP notes, vitals, diagnoses (ICD-10), procedures (CPT), and prescriptions.' },
      { step: 4, instruction: 'Use the Billing tab within the encounter to link CPT/ICD codes.', detail: 'This ensures the encounter is ready for claims submission.' },
    ],
    quickLink: { to: '/patients', label: 'Find a Patient' },
  },

  // ── Documents ────────────────────────────────────────────────
  {
    id: 'documents',
    title: 'Secure Document Management',
    icon: 'bi-shield-lock',
    description: 'Upload, share, and track documents with 4-digit access codes and Backblaze B2 cloud storage.',
    steps: [
      { step: 1, instruction: 'Go to Documents → Secure Documents.', detail: 'This page has three tabs: Upload, My Documents, and Verify Code.' },
      { step: 2, instruction: 'On the Upload tab, select a file (PDF, image, document, etc.).', detail: 'Optional: assign to a patient by entering their PID, add a category, and notes.' },
      { step: 3, instruction: 'Click Upload. A 4-digit access code is generated.', detail: 'Share this code with the intended recipient — they need it to view the document.' },
      { step: 4, instruction: 'Use the My Documents tab to see all files you\'ve uploaded.', detail: 'Shows access codes, status (pending/accepted/rejected), and access count.' },
      { step: 5, instruction: 'Recipients use the Verify Code tab to unlock documents.', detail: 'Enter the 4-digit code to get a download link. Each access is logged.' },
      { step: 6, instruction: 'Use DICOM / X-Ray (Documents → DICOM / X-Ray) for medical imaging.', detail: 'Upload DICOM files and view them with window/level, zoom, and pan controls.' },
    ],
    quickLink: { to: '/documents', label: 'Go to Documents' },
  },

  // ── Imaging & DICOM ──────────────────────────────────────────
  {
    id: 'imaging',
    title: 'Imaging & DICOM Viewer',
    icon: 'bi-image',
    description: 'Upload X-rays and lab images to Backblaze B2. View DICOM files with medical-grade controls.',
    steps: [
      { step: 1, instruction: 'Go to Documents → DICOM / X-Ray.', detail: 'Opens the DICOM viewer and imaging upload page.' },
      { step: 2, instruction: 'To upload an X-ray: select file, enter patient ID, and click Upload.', detail: 'Accepted formats: .dcm, .jpg, .jpeg, .png, .tiff, .bmp. Max 500 MB.' },
      { step: 3, instruction: 'To view a DICOM file: drag & drop or click to select a .dcm file.', detail: 'Use Window/Level presets (Lung, Bone, Abdomen) or adjust manually.' },
      { step: 4, instruction: 'Use zoom slider and mouse drag to navigate the image.', detail: 'Metadata panel shows patient info, modality, and acquisition parameters.' },
    ],
    quickLink: { to: '/dicom', label: 'Go to DICOM Viewer' },
  },

  // ── Messaging ────────────────────────────────────────────────
  {
    id: 'messaging',
    title: 'Messaging & Communication',
    icon: 'bi-chat-dots',
    description: 'Internal clinic messaging and Direct secure messaging for provider-to-provider communication.',
    steps: [
      { step: 1, instruction: 'Go to Messaging → Inbox for internal clinic messages.', detail: 'View, compose, and reply to messages. Messages can be linked to patients.' },
      { step: 2, instruction: 'Click Compose to send a new message.', detail: 'Select recipients, add a subject and body. Optionally link to a patient ID.' },
      { step: 3, instruction: 'Use Direct Msg (Messaging → Direct Msg) for secure provider-to-provider communication.', detail: 'Enter a Direct address (e.g. provider@direct.example.com), subject, and body.' },
      { step: 4, instruction: 'All messages are persisted and can be searched later.', detail: 'The WebSocket gateway provides real-time notifications for new messages.' },
    ],
    quickLink: { to: '/messages', label: 'Go to Messages' },
  },

  // ── Billing ──────────────────────────────────────────────────
  {
    id: 'billing',
    title: 'Billing & Claims',
    icon: 'bi-currency-dollar',
    description: 'Manage patient billing, insurance claims, and financial reporting.',
    steps: [
      { step: 1, instruction: 'Go to Billing → Billing Dashboard for an overview.', detail: 'Shows outstanding balances, recent transactions, and quick actions.' },
      { step: 2, instruction: 'Use Billing → Medical Billing for detailed claim management.', detail: 'Search for patients, create claims with CPT/HCPCS and ICD-10 codes.' },
      { step: 3, instruction: 'Submit claims electronically as ANSI X12 837 files.', detail: 'Batch-submit multiple claims and track their adjudication status.' },
      { step: 4, instruction: 'Post payments and adjustments against patient accounts.', detail: 'The patient balance updates automatically when payments are posted.' },
    ],
    quickLink: { to: '/billing', label: 'Go to Billing' },
  },

  // ── Reports ──────────────────────────────────────────────────
  {
    id: 'reports',
    title: 'Reports & Analytics',
    icon: 'bi-graph-up-arrow',
    description: 'Generate clinical, financial, and operational reports.',
    steps: [
      { step: 1, instruction: 'Go to Reports → Reports for the main reports dashboard.', detail: 'Filter by date range, provider, and report type.' },
      { step: 2, instruction: 'Clinical reports: patient volume, diagnoses, procedures, and quality measures.', detail: 'Useful for MIPS, UDS, and other regulatory reporting.' },
      { step: 3, instruction: 'Financial reports: revenue cycle, aging AR, payment reconciliation.', detail: 'Track practice financial health over time.' },
      { step: 4, instruction: 'Use Reports → Surveillance for public health monitoring.', detail: 'Track infectious diseases, immunizations, and reportable conditions.' },
      { step: 5, instruction: 'Export any report as CSV, Excel, or PDF using the Export button.', detail: 'Apply filters before exporting to get exactly the data you need.' },
    ],
    quickLink: { to: '/reports', label: 'Go to Reports' },
  },

  // ── Admin ────────────────────────────────────────────────────
  {
    id: 'admin',
    title: 'Administration & System Settings',
    icon: 'bi-gear-wide-connected',
    description: 'Manage users, facilities, database, disclosures, and licenses.',
    steps: [
      { step: 1, instruction: 'Go to Admin → System Admin for user and facility management.', detail: 'Add/edit users, manage facilities, and configure system settings.' },
      { step: 2, instruction: 'Use Admin → Database Admin for direct database access.', detail: 'Browse tables, run SQL queries, and view schema information. Admin only.' },
      { step: 3, instruction: 'Use Admin → Disclosures to manage patient data disclosures.', detail: 'Track who has accessed patient records and for what purpose.' },
      { step: 4, instruction: 'Use Admin → License to activate or check your subscription.', detail: 'Enter a license key, view status, and see expiration dates. Licenses work offline.' },
      { step: 5, instruction: 'Add new users from System Admin: fill in username and name, then assign a role.', detail: 'Roles: admin, physician, nurse, front_desk, billing, lab_tech, radiologist.' },
    ],
    quickLink: { to: '/admin', label: 'Go to Admin' },
  },

  // ── License ──────────────────────────────────────────────────
  {
    id: 'license',
    title: 'License Management',
    icon: 'bi-key',
    description: 'Activate and manage your OpenRx subscription license.',
    steps: [
      { step: 1, instruction: 'Go to Admin → License (or /license).', detail: 'Shows current license status: active, expired, or none.' },
      { step: 2, instruction: 'To activate, paste your license key and click Activate.', detail: 'Keys are generated for specific tiers: Basic (5 users), Professional (25 users), Enterprise (100 users).' },
      { step: 3, instruction: 'License validation works offline using HMAC-SHA256.', detail: 'No internet required — the key contains an expiration date and tier information.' },
      { step: 4, instruction: 'Check the Status tab to see tier, expiration date, and days remaining.', detail: 'Renew before expiration to maintain uninterrupted access.' },
    ],
    quickLink: { to: '/license', label: 'Go to License' },
  },

  // ── Patient Portal ───────────────────────────────────────────
  {
    id: 'portal',
    title: 'Patient Portal',
    icon: 'bi-person-heart',
    description: 'How patients access their records, message providers, and pay bills.',
    steps: [
      { step: 1, instruction: 'Patients access the portal at /portal/login.', detail: 'They need a portal username and password set up during registration.' },
      { step: 2, instruction: 'Patients can view medical records: labs, medications, immunizations, and visit history.', detail: 'All data is read-only — patients cannot modify clinical records.' },
      { step: 3, instruction: 'Patients can message their provider securely from the portal.', detail: 'Messages appear in the clinic\'s Messaging Inbox for staff to respond.' },
      { step: 4, instruction: 'Patients can make payments online via /portal/payment.', detail: 'Secure payment processing with transaction history.' },
      { step: 5, instruction: 'Patients can register themselves via /portal/register.', detail: 'Fill in demographics and contact information. An admin reviews and approves new registrations.' },
      { step: 6, instruction: 'Staff can access portal features from Patient Portal menu to assist patients.', detail: 'Use Portal Login to sign in as a patient, or Register Patient for new portal accounts.' },
    ],
    quickLink: { to: '/portal/login', label: 'Go to Patient Portal' },
  },

  // ── Database Admin ───────────────────────────────────────────
  {
    id: 'db-admin',
    title: 'Database Administration',
    icon: 'bi-database',
    description: 'Browse database tables, run queries, and manage data directly.',
    steps: [
      { step: 1, instruction: 'Go to Admin → Database Admin (admin only).', detail: 'Opens the built-in database management interface.' },
      { step: 2, instruction: 'Browse the table list on the left sidebar.', detail: 'Click any table to view its columns and sample data.' },
      { step: 3, instruction: 'Use the SQL Query tab to run custom queries.', detail: 'SELECT queries display results in a table. Write operations (INSERT, UPDATE, DELETE) are also supported.' },
      { step: 4, instruction: 'View table schema (columns, types, keys) from the Schema tab.', detail: 'Helpful for understanding the data model and writing queries.' },
    ],
    quickLink: { to: '/db-admin', label: 'Go to DB Admin' },
  },

  // ── Troubleshooting ──────────────────────────────────────────
  {
    id: 'troubleshooting',
    title: 'Troubleshooting & Tips',
    icon: 'bi-tools',
    description: 'Common issues and how to resolve them.',
    steps: [
      { step: 1, instruction: 'Page not loading or showing old data? Try a hard refresh (Ctrl+Shift+R).', detail: 'This clears the browser cache for the current page. Use incognito mode if issues persist.' },
      { step: 2, instruction: 'Forgot your password? Contact another admin to reset it from Admin → System Admin.', detail: 'If you\'re the only admin, contact support@transtechologies.com for assistance.' },
      { step: 3, instruction: 'Upload failing? Check file size limits.', detail: 'Documents: 50 MB max. Avatars: 5 MB. Imaging: 500 MB. Ensure you\'re logged in with the correct role.' },
      { step: 4, instruction: 'Dropdown or list appears empty? Try refreshing the page.', detail: 'The data may still be loading. If it persists, check the browser console (F12 → Console) for errors.' },
      { step: 5, instruction: 'Need help? Check the FAQ page (/help), Wiki (/wiki), or email support@transtechologies.com.', detail: 'For bug reports, use the Discussions page or contact support directly.' },
    ],
    quickLink: { to: '/help', label: 'Go to FAQ & Help' },
  },
];

export default function HowToPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeSection, setActiveSection] = useState(HOW_TO_DATA[0].id);
  const [search, setSearch] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoTitle, setVideoTitle] = useState('');
  const [playingVideo, setPlayingVideo] = useState<VideoItem | null>(null);

  // ── Watch Mode (auto-play presentation) ────────────────────
  const [watchMode, setWatchMode] = useState(false);
  const [watchStepIndex, setWatchStepIndex] = useState(0);
  const [watchPlaying, setWatchPlaying] = useState(false);
  const [watchSpeed, setWatchSpeed] = useState(5); // seconds per step

  const watchSection = HOW_TO_DATA.find((s) => s.id === activeSection);
  const watchSteps = watchSection?.steps || [];
  const watchProgress = watchSteps.length > 0 ? ((watchStepIndex + 1) / watchSteps.length) * 100 : 0;

  const nextWatchStep = useCallback(() => {
    if (watchStepIndex < watchSteps.length - 1) {
      setWatchStepIndex((i) => i + 1);
    } else {
      // Move to next section
      const idx = HOW_TO_DATA.indexOf(watchSection!);
      if (idx < HOW_TO_DATA.length - 1) {
        setActiveSection(HOW_TO_DATA[idx + 1].id);
        setWatchStepIndex(0);
      } else {
        setWatchPlaying(false);
      }
    }
  }, [watchStepIndex, watchSteps, watchSection]);

  const prevWatchStep = useCallback(() => {
    if (watchStepIndex > 0) {
      setWatchStepIndex((i) => i - 1);
    } else {
      const idx = HOW_TO_DATA.indexOf(watchSection!);
      if (idx > 0) {
        const prev = HOW_TO_DATA[idx - 1];
        setActiveSection(prev.id);
        setWatchStepIndex(prev.steps.length - 1);
      }
    }
  }, [watchStepIndex, watchSection]);

  useEffect(() => {
    if (!watchPlaying || !watchMode) return;
    const timer = setInterval(() => nextWatchStep(), watchSpeed * 1000);
    return () => clearInterval(timer);
  }, [watchPlaying, watchMode, nextWatchStep, watchSpeed]);

  const startWatchMode = () => {
    setWatchMode(true);
    setWatchStepIndex(0);
    setWatchPlaying(true);
  };

  const stopWatchMode = () => {
    setWatchMode(false);
    setWatchPlaying(false);
    setWatchStepIndex(0);
  };

  const currentWatchStep = watchSteps[watchStepIndex];

  const current = HOW_TO_DATA.find((s) => s.id === activeSection);

  // ── Video Tutorials ────────────────────────────────────────
  const { data: allDocs = [] } = useQuery({
    queryKey: ['howto-videos'],
    queryFn: async () => { const r = await nestClient.get('/documents'); return r.data; },
  });

  const videos: VideoItem[] = (allDocs as any[])
    .filter((d: any) => d.category === 'howto-video')
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const videoUpload = useMutation({
    mutationFn: async () => {
      if (!videoFile) throw new Error('No file selected');
      const fd = new FormData();
      fd.append('file', videoFile);
      fd.append('category', 'howto-video');
      if (videoTitle) fd.append('notes', videoTitle);
      const r = await nestClient.post('/documents/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return r.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['howto-videos'] });
      setVideoFile(null);
      setVideoTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const getStreamUrl = async (docId: number): Promise<string> => {
    const r = await nestClient.get(`/documents/${docId}/stream`);
    return r.data.streamUrl;
  };

  const handlePlayVideo = async (video: VideoItem) => {
    if (video.streamUrl) {
      setPlayingVideo(video);
      return;
    }
    try {
      const url = await getStreamUrl(video.id);
      setPlayingVideo({ ...video, streamUrl: url });
    } catch {
      alert('Could not load video stream.');
    }
  };

  const filtered = search
    ? HOW_TO_DATA.filter(
        (s) =>
          s.title.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase()) ||
          s.steps.some(
            (st) =>
              st.instruction.toLowerCase().includes(search.toLowerCase()) ||
              (st.detail && st.detail.toLowerCase().includes(search.toLowerCase())),
          ),
      )
    : HOW_TO_DATA;

  return (
    <div className="glass-page position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #f5faff 45%, #d1fae5 100%)', borderRadius: '20px', minHeight: '100vh', padding: '16px' }}>
      <div className="position-absolute rounded-circle" style={{ width: '340px', height: '340px', top: '-80px', right: '-60px', background: 'radial-gradient(circle, rgba(13,110,253,0.30), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <div className="position-absolute rounded-circle" style={{ width: '400px', height: '400px', bottom: '8%', left: '-120px', background: 'radial-gradient(circle, rgba(0,201,167,0.30), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <style>{`
        .glass-page .card {
          position: relative;
          z-index: 1;
          background: rgba(255,255,255,0.60) !important;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.9) !important;
          box-shadow: 0 22px 45px rgba(10,37,64,0.20), 0 6px 14px rgba(10,37,64,0.10), inset 0 2px 0 rgba(13,110,253,0.45), inset 0 -2px 0 rgba(0,201,167,0.45) !important;
          transition: transform .25s ease, box-shadow .25s ease, background .25s ease;
        }
        .glass-page .card:hover {
          transform: translateY(-5px);
          background: rgba(255,255,255,0.70) !important;
          box-shadow: 0 30px 60px rgba(10,37,64,0.28), 0 10px 20px rgba(10,37,64,0.14), inset 0 2px 0 rgba(13,110,253,0.60), inset 0 -2px 0 rgba(0,201,167,0.60) !important;
        }
        .glass-page .card .card-header,
        .glass-page .card-header {
          background: rgba(255,255,255,0.35) !important;
          border-bottom: 1px solid rgba(255,255,255,0.6) !important;
        }
        .glass-page .table thead.table-light {
          background: rgba(255,255,255,0.35) !important;
        }
      `}</style>
      <div className="container-fluid py-3" style={{ maxWidth: '1300px', position: 'relative', zIndex: 1 }}>
        {/* Header */}
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h3 className="mb-1">
            <i className="bi bi-journal-text me-2 text-primary"></i>
            How-To Guide
          </h3>
          <p className="text-muted small mb-0">
            Step-by-step instructions for every OpenRx feature
          </p>
        </div>
        <input
          className="form-control form-control-sm"
          style={{ width: '280px' }}
          placeholder="Search how-to guides..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (e.target.value.trim() && filtered.length > 0) {
              setActiveSection(filtered[0].id);
            }
          }}
        />
      </div>

      {/* ── Video Tutorials ────────────────────────────────── */}
      <div className="card shadow-sm border-0 mb-4">
        <div className="card-header bg-dark text-white d-flex align-items-center gap-2 py-2">
          <i className="bi bi-camera-video fs-5"></i>
          <h5 className="mb-0">Video Tutorials</h5>
          <span className="badge bg-light text-dark ms-2">{videos.length}</span>
        </div>
        <div className="card-body">
          {/* Upload (admin only) */}
          {user?.role === 'admin' && (
            <div className="card bg-light border mb-3">
              <div className="card-body py-2">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <i className="bi bi-cloud-upload text-primary"></i>
                  <span className="small fw-semibold">Upload How-To Video</span>
                </div>
                <div className="row g-2 align-items-end">
                  <div className="col-md-7">
                    <input ref={fileInputRef} type="file" className="form-control form-control-sm"
                      accept=".mp4,.webm,.mov,.avi,.mkv" onChange={e => setVideoFile(e.target.files?.[0] || null)} />
                    {videoFile && <div className="mt-1 small text-muted">
                      <i className="bi bi-file-play me-1"></i>{videoFile.name} ({(videoFile.size / 1024 / 1024).toFixed(1)} MB)
                    </div>}
                  </div>
                  <div className="col-md-3">
                    <input className="form-control form-control-sm" placeholder="Video title (optional)"
                      value={videoTitle} onChange={e => setVideoTitle(e.target.value)} />
                  </div>
                  <div className="col-md-2">
                    <button className="btn btn-primary btn-sm w-100" disabled={!videoFile || videoUpload.isPending}
                      onClick={() => videoUpload.mutate()}>
                      {videoUpload.isPending ? <span className="spinner-border spinner-border-sm"></span> : <><i className="bi bi-upload me-1"></i>Upload</>}
                    </button>
                  </div>
                </div>
                {videoUpload.isError && <div className="alert alert-danger small py-1 mt-2 mb-0">
                  <i className="bi bi-exclamation-triangle me-1"></i>Upload failed. Try again.
                </div>}
                {videoUpload.isSuccess && <div className="alert alert-success small py-1 mt-2 mb-0">
                  <i className="bi bi-check-circle me-1"></i>Video uploaded successfully!
                </div>}
              </div>
            </div>
          )}

          {/* Video Player */}
          {playingVideo && (
            <div className="card border-primary mb-3">
              <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center py-2">
                <span className="small"><i className="bi bi-play-circle me-1"></i>{playingVideo.originalName}</span>
                <button className="btn btn-sm btn-outline-light" onClick={() => setPlayingVideo(null)}>✕ Close</button>
              </div>
              <div className="card-body p-0 bg-black">
                <video controls autoPlay style={{ width: '100%', maxHeight: '500px' }} key={playingVideo.id}>
                  <source src={playingVideo.streamUrl} type={playingVideo.mimeType || 'video/mp4'} />
                  Your browser does not support the video tag.
                </video>
              </div>
            </div>
          )}

          {/* Video List */}
          {videos.length > 0 ? (
            <div className="row g-2">
              {videos.map((v) => (
                <div className="col-md-6 col-lg-4" key={v.id}>
                  <div className="card h-100 shadow-sm">
                    <div className="card-body d-flex align-items-center gap-2 py-2"
                      style={{ cursor: 'pointer' }} onClick={() => handlePlayVideo(v)}>
                      <div className="bg-primary rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                        style={{ width: '40px', height: '40px' }}>
                        <i className="bi bi-play-fill text-white"></i>
                      </div>
                      <div className="flex-grow-1" style={{ minWidth: 0 }}>
                        <div className="small fw-semibold text-truncate">{v.originalName}</div>
                        <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                          {new Date(v.createdAt).toLocaleDateString()} · {(parseInt(v.sizeBytes) / 1024 / 1024).toFixed(1)} MB
                        </div>
                      </div>
                      <i className="bi bi-play-circle text-primary"></i>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted small mb-0 text-center py-2">
              <i className="bi bi-camera-video-off me-1"></i>
              No tutorial videos yet. {user?.role === 'admin' ? 'Upload one above!' : 'Check back soon.'}
            </p>
          )}
        </div>
      </div>

      <div className="row g-4">
        {/* Sidebar Navigation */}
        <div className="col-md-3">
          <div className="card shadow-sm sticky-top" style={{ top: '1rem', maxHeight: '80vh', overflow: 'auto' }}>
            <div className="card-header bg-primary text-white py-2">
              <h6 className="mb-0 small">
                <i className="bi bi-list-ul me-2"></i>Topics ({filtered.length})
              </h6>
            </div>
            <div className="list-group list-group-flush">
              {filtered.map((section) => (
                <button
                  key={section.id}
                  className={`list-group-item list-group-item-action border-0 d-flex align-items-center gap-2 py-2 px-3 ${
                    activeSection === section.id ? 'active' : ''
                  }`}
                  style={{ fontSize: '0.85rem' }}
                  onClick={() => setActiveSection(section.id)}
                >
                  <i className={`bi ${section.icon}`} style={{ fontSize: '0.9rem' }}></i>
                  <span>{section.title}</span>
                  <span className="badge bg-secondary ms-auto" style={{ fontSize: '0.6rem' }}>
                    {section.steps.length}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="text-center py-4 text-muted small">
                  <i className="bi bi-search" style={{ fontSize: '1.5rem' }}></i>
                  <p className="mt-2 mb-0">No matching topics</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="col-md-9">
          {current ? (
            <div className="card shadow-sm border-0">
              {/* Section Header */}
              <div className="card-header bg-white d-flex align-items-center gap-3 py-3 border-bottom">
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center text-white flex-shrink-0"
                  style={{ width: '48px', height: '48px', backgroundColor: '#0d6efd' }}
                >
                  <i className={`bi ${current.icon} fs-5`}></i>
                </div>
                <div>
                  <h4 className="mb-1">{current.title}</h4>
                  <p className="text-muted mb-0 small">{current.description}</p>
                </div>
                <div className="d-flex gap-2 ms-auto">
                  <button className="btn btn-outline-danger btn-sm" onClick={startWatchMode}
                    title="Auto-play this guide as a video presentation">
                    <i className="bi bi-play-circle me-1"></i>Watch Guide
                  </button>
                  {current.quickLink && (
                    <NavLink to={current.quickLink.to} className="btn btn-primary btn-sm">
                      <i className="bi bi-arrow-right me-1"></i>
                      {current.quickLink.label}
                    </NavLink>
                  )}
                </div>
              </div>

              {/* Steps */}
              <div className="card-body">
                <div className="timeline">
                  {current.steps.map((s) => (
                    <div key={s.step} className="d-flex gap-3 mb-4 pb-2">
                      {/* Step Number */}
                      <div
                        className="rounded-circle d-flex align-items-center justify-content-center text-white flex-shrink-0 fw-bold"
                        style={{
                          width: '36px',
                          height: '36px',
                          minWidth: '36px',
                          backgroundColor: '#0d6efd',
                          fontSize: '0.9rem',
                        }}
                      >
                        {s.step}
                      </div>
                      {/* Step Content */}
                      <div className="pt-1">
                        <div className="fw-semibold mb-1">{s.instruction}</div>
                        {s.detail && (
                          <div className="text-muted small">
                            <i className="bi bi-info-circle me-1 text-primary"></i>
                            {s.detail}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Navigation between sections */}
                <div className="d-flex justify-content-between align-items-center border-top pt-3 mt-2">
                  <button
                    className="btn btn-outline-secondary btn-sm"
                    disabled={HOW_TO_DATA.indexOf(current) === 0}
                    onClick={() => {
                      const idx = HOW_TO_DATA.indexOf(current);
                      if (idx > 0) setActiveSection(HOW_TO_DATA[idx - 1].id);
                    }}
                  >
                    <i className="bi bi-chevron-left me-1"></i>Previous
                  </button>
                  <span className="text-muted small">
                    {HOW_TO_DATA.indexOf(current) + 1} of {HOW_TO_DATA.length}
                  </span>
                  <button
                    className="btn btn-outline-secondary btn-sm"
                    disabled={HOW_TO_DATA.indexOf(current) === HOW_TO_DATA.length - 1}
                    onClick={() => {
                      const idx = HOW_TO_DATA.indexOf(current);
                      if (idx < HOW_TO_DATA.length - 1) setActiveSection(HOW_TO_DATA[idx + 1].id);
                    }}
                  >
                    Next<i className="bi bi-chevron-right ms-1"></i>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="card shadow-sm border-0">
              <div className="card-body text-center py-5">
                <i className="bi bi-journal-x text-muted" style={{ fontSize: '3rem' }}></i>
                <h5 className="mt-3">No topic selected</h5>
                <p className="text-muted">Choose a topic from the sidebar or search above.</p>
              </div>
            </div>
          )}

          {/* Quick Reference */}
          <div className="mt-4">
            <div className="card shadow-sm border-0">
              <div className="card-header bg-transparent">
                <h6 className="mb-0">
                  <i className="bi bi-lightning-charge me-2 text-warning"></i>
                  Quick Reference
                </h6>
              </div>
              <div className="card-body">
                <div className="row g-2">
                  {[
                    { label: 'Login', to: '/login', icon: 'bi-box-arrow-in-right' },
                    { label: 'Dashboard', to: '/dashboard', icon: 'bi-speedometer2' },
                    { label: 'Patients', to: '/patients', icon: 'bi-people' },
                    { label: 'Calendar', to: '/appointments', icon: 'bi-calendar3' },
                    { label: 'Labs', to: '/labs', icon: 'bi-flask' },
                    { label: 'Documents', to: '/documents', icon: 'bi-shield-lock' },
                    { label: 'DICOM', to: '/dicom', icon: 'bi-image' },
                    { label: 'Billing', to: '/billing', icon: 'bi-currency-dollar' },
                    { label: 'Reports', to: '/reports', icon: 'bi-graph-up' },
                    { label: 'Admin', to: '/admin', icon: 'bi-gear' },
                    { label: 'License', to: '/license', icon: 'bi-key' },
                    { label: 'Wiki', to: '/wiki', icon: 'bi-book' },
                    { label: 'FAQ', to: '/help', icon: 'bi-question-circle' },
                    { label: 'DB Admin', to: '/db-admin', icon: 'bi-database' },
                    { label: 'Messages', to: '/messages', icon: 'bi-chat-dots' },
                    { label: 'Providers', to: '/providers', icon: 'bi-person-badge' },
                  ].map((link) => (
                    <div className="col-6 col-md-3 col-lg-2" key={link.to}>
                      <NavLink
                        to={link.to}
                        className="btn btn-outline-secondary btn-sm w-100 text-start d-flex align-items-center gap-2"
                      >
                        <i className={`bi ${link.icon}`}></i>
                        <span style={{ fontSize: '0.78rem' }}>{link.label}</span>
                      </NavLink>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Still need help */}
          <div
            className="card shadow-sm border-0 mt-4 text-white"
            style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #6610f2 100%)' }}
          >
            <div className="card-body text-center py-4">
              <i className="bi bi-headset" style={{ fontSize: '2rem' }}></i>
              <h5 className="mt-2 mb-1">Still need help?</h5>
              <p className="mb-3 opacity-75 small">
                Can't find what you're looking for? Check the FAQ, Wiki, or contact our support team.
              </p>
              <div className="d-flex justify-content-center gap-2 flex-wrap">
                <NavLink to="/help" className="btn btn-light btn-sm">
                  <i className="bi bi-question-circle me-1"></i>FAQ & Help
                </NavLink>
                <NavLink to="/wiki" className="btn btn-outline-light btn-sm">
                  <i className="bi bi-book me-1"></i>Wiki / Docs
                </NavLink>
                <a href="mailto:support@transtechologies.com" className="btn btn-outline-light btn-sm">
                  <i className="bi bi-envelope me-1"></i>Email Support
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Watch Mode Overlay ─────────────────────────────── */}
      {watchMode && currentWatchStep && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.92)', zIndex: 9999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontFamily: 'system-ui, sans-serif',
        }}>
          <button onClick={stopWatchMode} style={{
            position: 'absolute', top: '20px', right: '20px',
            background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white',
            fontSize: '1.5rem', width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer',
          }}>✕</button>
          <div style={{ maxWidth: '800px', width: '90%', textAlign: 'center' }}>
            <div style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
              <i className={`bi ${watchSection?.icon || 'bi-book'} me-2`}></i>
              {watchSection?.title}
            </div>
            <div style={{
              width: '80px', height: '80px', borderRadius: '50%',
              background: 'linear-gradient(135deg, #0d6efd, #6610f2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px', fontSize: '2rem', fontWeight: 'bold',
            }}>
              {currentWatchStep.step}
            </div>
            <h2 style={{ fontSize: '1.8rem', fontWeight: 600, marginBottom: '12px', lineHeight: 1.3 }}>
              {currentWatchStep.instruction}
            </h2>
            {currentWatchStep.detail && (
              <p style={{ fontSize: '1.1rem', opacity: 0.8, lineHeight: 1.5, maxWidth: '650px', margin: '0 auto 30px' }}>
                <i className="bi bi-info-circle me-2" style={{ color: '#0d6efd' }}></i>
                {currentWatchStep.detail}
              </p>
            )}
            <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.15)', borderRadius: '3px', marginBottom: '24px' }}>
              <div style={{
                width: `${watchProgress}%`, height: '100%',
                background: 'linear-gradient(90deg, #0d6efd, #6610f2)',
                borderRadius: '3px', transition: 'width 0.4s ease',
              }}></div>
            </div>
            <div style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '20px' }}>
              Step {watchStepIndex + 1} of {watchSteps.length}
              {watchSection && <> · {HOW_TO_DATA.indexOf(watchSection) + 1}/{HOW_TO_DATA.length} sections</>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <button onClick={prevWatchStep} style={{
                background: 'rgba(255,255,255,0.12)', border: 'none', color: 'white',
                width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer', fontSize: '1.2rem',
              }} title="Previous">⏮</button>
              <button onClick={() => setWatchPlaying(!watchPlaying)} style={{
                background: '#0d6efd', border: 'none', color: 'white',
                width: '56px', height: '56px', borderRadius: '50%', cursor: 'pointer', fontSize: '1.5rem',
              }} title={watchPlaying ? 'Pause' : 'Play'}>
                {watchPlaying ? '⏸' : '▶'}
              </button>
              <button onClick={nextWatchStep} style={{
                background: 'rgba(255,255,255,0.12)', border: 'none', color: 'white',
                width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer', fontSize: '1.2rem',
              }} title="Next">⏭</button>
              <select value={watchSpeed} onChange={e => setWatchSpeed(Number(e.target.value))} style={{
                background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
                color: 'white', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem',
              }}>
                <option value={3}>3s Fast</option>
                <option value={5}>5s Normal</option>
                <option value={8}>8s Slow</option>
                <option value={12}>12s Slower</option>
              </select>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
