import { useState } from 'react';
import { NavLink } from 'react-router-dom';

interface WikiSection {
  id: string;
  title: string;
  icon: string;
  content: string;
  subsections?: { id: string; title: string; content: string }[];
}

const WIKI_CONTENT: WikiSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: 'bi-rocket-takeoff',
    content: 'Welcome to OpenRx — a comprehensive electronic prescription and health records system designed for modern healthcare practices. OpenRx combines EHR, e-prescribing, lab management, imaging, secure document sharing, and billing into one unified platform.',
    subsections: [
      {
        id: 'login',
        title: 'Logging In',
        content: 'Navigate to the login page and enter your credentials. Default admin credentials are admin / pass. For security, change your password immediately after first login from the Admin panel.',
      },
      {
        id: 'dashboard',
        title: 'Dashboard Overview',
        content: 'The dashboard provides a real-time overview of your clinic: total patients, today\'s appointments, pending claims, recent messages, and quick-access links to common tasks.',
      },
      {
        id: 'license',
        title: 'License Activation',
        content: 'OpenRx uses a subscription-based license model. Enter your license key at /license to activate. Licenses work offline for the full subscription duration. Tiers: Basic (5 users), Professional (25 users), Enterprise (100 users).',
      },
    ],
  },
  {
    id: 'patients',
    title: 'Patient Management',
    icon: 'bi-people',
    content: 'Manage patient records, search, register new patients, and access detailed patient charts.',
    subsections: [
      {
        id: 'search',
        title: 'Searching Patients',
        content: 'Use the patient search page to find patients by name, ID, phone, or email. Results display key demographics and link to the full patient chart.',
      },
      {
        id: 'registration',
        title: 'Registering New Patients',
        content: 'Fill out the registration form with demographics, contact information, insurance details, and assign a primary provider. All fields marked with an asterisk are required.',
      },
      {
        id: 'chart',
        title: 'Patient Chart',
        content: 'The patient chart includes encounters, vitals, medications, allergies, conditions, immunizations, lab results, imaging, billing history, and secure documents — all in one view.',
      },
    ],
  },
  {
    id: 'appointments',
    title: 'Appointments & Scheduling',
    icon: 'bi-calendar-event',
    content: 'Schedule, manage, and track patient appointments with a full-featured calendar and patient flow board.',
    subsections: [
      {
        id: 'calendar',
        title: 'Appointment Calendar',
        content: 'View appointments by day, week, or month. Color-coded by provider and status. Click any slot to create a new appointment or click existing appointments to view/edit details.',
      },
      {
        id: 'flow-board',
        title: 'Patient Flow Board',
        content: 'Track patients through your clinic workflow: Checked In → In Progress → Checkout. Update status with one click. See wait times and provider assignments at a glance.',
      },
      {
        id: 'recall',
        title: 'Recall Board',
        content: 'Manage patient recall lists for follow-up appointments, preventive care reminders, and chronic disease management.',
      },
    ],
  },
  {
    id: 'clinical',
    title: 'Clinical Workflows',
    icon: 'bi-heart-pulse',
    content: 'Document encounters, manage medications, track allergies and conditions, record vitals, and generate clinical notes.',
    subsections: [
      {
        id: 'encounters',
        title: 'Visits & SOAP Notes',
        content: 'Create and manage patient encounters with SOAP note templates (Subjective, Objective, Assessment, Plan). Link encounters to diagnoses, procedures, and billing codes.',
      },
      {
        id: 'medications',
        title: 'Medications & e-Prescribing',
        content: 'Manage patient medication lists with full prescribing capabilities. Track active medications, dosages, frequencies, and refill history. Integrated with drug interaction checking.',
      },
      {
        id: 'vitals',
        title: 'Vitals Recording',
        content: 'Record and track patient vitals: blood pressure, heart rate, temperature, respiratory rate, oxygen saturation, height, weight, and BMI. View trends over time with visual charts.',
      },
    ],
  },
  {
    id: 'documents',
    title: 'Secure Documents',
    icon: 'bi-shield-lock',
    content: 'Upload, share, and manage documents securely using Backblaze B2 cloud storage with 4-digit access codes.',
    subsections: [
      {
        id: 'upload',
        title: 'Uploading Documents',
        content: 'Navigate to Documents → Upload. Select a file (PDF, image, DICOM, spreadsheet), optionally assign to a patient, choose a category, and upload. A 4-digit access code is generated — share this with the recipient.',
      },
      {
        id: 'my-documents',
        title: 'My Documents',
        content: 'The My Documents tab shows all documents you\'ve uploaded with their access codes, status (pending/accepted/rejected), and access history. Click any code to copy it.',
      },
      {
        id: 'verify',
        title: 'Recipient Verification',
        content: 'Recipients enter the 4-digit code to unlock and view documents. All access is logged with timestamps. Documents auto-mark as "Accepted" upon first successful verification.',
      },
    ],
  },
  {
    id: 'labs-imaging',
    title: 'Labs & Imaging',
    icon: 'bi-flask',
    content: 'Order lab tests, record results, and upload lab documents and medical imaging (X-ray, DICOM) to secure cloud storage.',
    subsections: [
      {
        id: 'lab-orders',
        title: 'Lab Orders',
        content: 'Create lab orders for patients with test instructions and clinical history. Track order status and add results with codes, values, units, and reference ranges.',
      },
      {
        id: 'lab-upload',
        title: 'Lab Document Upload',
        content: 'Upload lab result documents (PDFs, images) directly to Backblaze B2 storage. Documents are linked to patient records and can be downloaded with time-limited authorization URLs.',
      },
      {
        id: 'dicom',
        title: 'DICOM / X-Ray Viewer',
        content: 'View DICOM medical images with window/level adjustment, zoom, and pan controls. Upload X-ray and DICOM files to secure B2 storage linked to patient records.',
      },
    ],
  },
  {
    id: 'billing',
    title: 'Billing & Claims',
    icon: 'bi-currency-dollar',
    content: 'Manage patient billing, process insurance claims, track transactions, and generate financial reports.',
    subsections: [
      {
        id: 'billing-dash',
        title: 'Billing Dashboard',
        content: 'Overview of all billing activity: outstanding balances, recent transactions, claim statuses, and aging reports.',
      },
      {
        id: 'claims',
        title: 'Insurance Claims',
        content: 'Create and submit insurance claims with CPT/HCPCS codes, ICD diagnoses, and provider information. Track claim status from submission through adjudication.',
      },
    ],
  },
  {
    id: 'security',
    title: 'Security & Access Control',
    icon: 'bi-shield-check',
    content: 'OpenRx implements multi-layer role-based access control with JWT authentication and attribute-based policies.',
    subsections: [
      {
        id: 'roles',
        title: 'User Roles',
        content: 'Roles: Admin (full access), Physician (clinical + prescribing), Nurse (clinical view), Pharmacist (prescriptions), Lab Tech (lab orders), Radiologist (imaging), Front Desk (scheduling), Billing (claims only), Patient (portal).',
      },
      {
        id: 'rbac',
        title: 'How RBAC Works',
        content: 'Every API request passes through three guards: JWT authentication → Role verification → Content-aware policy check. Admin users bypass all restrictions. Other users are limited to their role\'s permitted resources and their assigned patients.',
      },
    ],
  },
];

export default function WikiPage() {
  const [activeSection, setActiveSection] = useState('getting-started');
  const [search, setSearch] = useState('');

  const currentSection = WIKI_CONTENT.find((s) => s.id === activeSection);

  const filteredSections = search
    ? WIKI_CONTENT.filter(
        (s) =>
          s.title.toLowerCase().includes(search.toLowerCase()) ||
          s.content.toLowerCase().includes(search.toLowerCase()) ||
          s.subsections?.some(
            (sub) =>
              sub.title.toLowerCase().includes(search.toLowerCase()) ||
              sub.content.toLowerCase().includes(search.toLowerCase()),
          ),
      )
    : WIKI_CONTENT;

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
      <div className="container-fluid py-3" style={{ maxWidth: '1200px', position: 'relative', zIndex: 1 }}>
        {/* Header */}
      <div className="d-flex align-items-center justify-content-between mb-4">
        <div>
          <h3 className="mb-1">
            <i className="bi bi-book me-2 text-primary"></i>
            OpenRx Wiki
          </h3>
          <p className="text-muted small mb-0">
            Documentation & User Guide ·{' '}
            <a href="https://wiki.transtechologies.com/en/home" target="_blank" rel="noreferrer">
              wiki.transtechologies.com
            </a>
          </p>
        </div>
        <div className="d-flex gap-2">
          <input
            className="form-control form-control-sm"
            style={{ width: '250px' }}
            placeholder="Search wiki..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="row g-4">
        {/* Sidebar Navigation */}
        <div className="col-md-3">
          <div className="card shadow-sm">
            <div className="card-header bg-primary text-white py-2">
              <h6 className="mb-0 small"><i className="bi bi-list me-2"></i>Contents</h6>
            </div>
            <div className="card-body p-0" style={{ maxHeight: '70vh', overflow: 'auto' }}>
              <nav className="nav flex-column">
                {filteredSections.map((section) => (
                  <button
                    key={section.id}
                    className={`btn btn-link text-start text-decoration-none py-2 px-3 border-bottom ${
                      activeSection === section.id ? 'bg-primary bg-opacity-10 fw-bold' : 'text-dark'
                    }`}
                    style={{ fontSize: '0.85rem' }}
                    onClick={() => setActiveSection(section.id)}
                  >
                    <i className={`bi ${section.icon} me-2 ${activeSection === section.id ? 'text-primary' : 'text-muted'}`}></i>
                    {section.title}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="col-md-9">
          {currentSection && (
            <div className="card shadow-sm">
              <div className="card-header bg-white d-flex align-items-center gap-2 py-3">
                <i className={`bi ${currentSection.icon} text-primary fs-5`}></i>
                <h4 className="mb-0">{currentSection.title}</h4>
              </div>
              <div className="card-body">
                <p className="lead text-muted">{currentSection.content}</p>

                {currentSection.subsections && (
                  <div className="mt-4">
                    {currentSection.subsections.map((sub) => (
                      <div key={sub.id} className="mb-4" id={sub.id}>
                        <h5 className="border-bottom pb-2 mb-2">
                          <i className="bi bi-bookmark me-2 text-primary"></i>
                          {sub.title}
                        </h5>
                        <p className="text-muted">{sub.content}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick Links */}
                <div className="mt-4 pt-3 border-top">
                  <h6 className="text-muted small mb-2">Related Links</h6>
                  <div className="d-flex flex-wrap gap-2">
                    <NavLink to="/documents" className="btn btn-outline-primary btn-sm">
                      <i className="bi bi-shield-lock me-1"></i>Secure Documents
                    </NavLink>
                    <NavLink to="/license" className="btn btn-outline-primary btn-sm">
                      <i className="bi bi-key me-1"></i>License
                    </NavLink>
                    <NavLink to="/db-admin" className="btn btn-outline-primary btn-sm">
                      <i className="bi bi-database me-1"></i>Database Admin
                    </NavLink>
                    <a href="mailto:support@transtechologies.com" className="btn btn-outline-secondary btn-sm">
                      <i className="bi bi-envelope me-1"></i>Contact Support
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center mt-5 pt-4 border-top">
        <p className="text-muted small mb-1">
          <i className="bi bi-heart-pulse text-danger me-1"></i>
          OpenRx — Electronic Prescription & Health Records
        </p>
        <p className="text-muted small">
          <a href="https://wiki.transtechologies.com/en/home" target="_blank" rel="noreferrer">
            wiki.transtechologies.com/en/home
          </a>
          {' · '}
          <a href="mailto:support@transtechologies.com">support@transtechologies.com</a>
        </p>
      </div>
      </div>
    </div>
  );
}
