import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

interface FaqCategory {
  id: string;
  title: string;
  icon: string;
  items: FaqItem[];
}

const faqData: FaqCategory[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: 'bi-rocket-takeoff',
    items: [
      {
        id: 'gs-1',
        question: 'How do I log in to OpenRx?',
        answer: 'Navigate to the login page and enter your username and password provided by your administrator. The default credentials for new installations are <strong>admin</strong> / <strong>pass</strong>. For security, change your password immediately after first login from the Admin panel.',
      },
      {
        id: 'gs-2',
        question: 'How do I search for a patient?',
        answer: 'Click <strong>Patients → Search & Register</strong> in the sidebar. You can search by name, date of birth, phone number, or patient ID. The search supports partial matching — just start typing and results will appear automatically.',
      },
      {
        id: 'gs-3',
        question: 'How do I register a new patient?',
        answer: 'From the <strong>Patient Search</strong> page, click the <strong>+ Add Patient</strong> button. Fill in the required demographics (name, DOB, sex) and any additional information. Click <strong>Save</strong> to create the patient record.',
      },
      {
        id: 'gs-4',
        question: 'What browsers are supported?',
        answer: 'OpenRx supports all modern browsers including <strong>Chrome</strong> (recommended), <strong>Firefox</strong>, <strong>Safari</strong>, and <strong>Edge</strong>. For the best experience, keep your browser updated to the latest version.',
      },
    ],
  },
  {
    id: 'appointments',
    title: 'Appointments & Scheduling',
    icon: 'bi-calendar-check',
    items: [
      {
        id: 'apt-1',
        question: 'How do I schedule an appointment?',
        answer: 'Go to <strong>Appointments → Calendar</strong>, click on an available time slot, or use the <strong>+ New Appointment</strong> button. Select the patient, provider, date/time, and visit type. Click <strong>Save</strong> to confirm the appointment.',
      },
      {
        id: 'apt-2',
        question: 'How does the Patient Flow Board work?',
        answer: 'The <strong>Patient Flow Board</strong> (Appointments → Patient Flow) shows a real-time Kanban view of all patients moving through the clinic. Drag-and-drop patients between columns (Waiting, In Exam, Checked Out, etc.) to track their progress through the visit.',
      },
      {
        id: 'apt-3',
        question: 'What is the Recall Board?',
        answer: 'The <strong>Recall Board</strong> (Appointments → Recall) helps you track patients who are due for follow-up visits, preventive screenings, or chronic care management. Set recall intervals and the system will flag patients automatically.',
      },
      {
        id: 'apt-4',
        question: 'Can patients book appointments online?',
        answer: 'Yes, OpenRx supports patient self-scheduling through the <strong>Patient Portal</strong>. Patients can log in, view available slots, and book appointments. Administrators can enable this feature in Admin → System Settings.',
      },
    ],
  },
  {
    id: 'clinical',
    title: 'Clinical Workflows',
    icon: 'bi-heart-pulse',
    items: [
      {
        id: 'cl-1',
        question: 'How do I document a patient encounter?',
        answer: 'Navigate to the patient\'s chart, then click <strong>Visits</strong>. Select <strong>New Visit</strong>, choose the visit type, and complete the SOAP note, vitals, diagnoses, procedures, and prescriptions. All data is saved in real-time.',
      },
      {
        id: 'cl-2',
        question: 'How do I e-prescribe medications?',
        answer: 'From the patient encounter, navigate to the <strong>Medications</strong> tab. Click <strong>Add Medication</strong>, search for the drug, select dosage and frequency, and submit. The prescription is transmitted electronically to the patient\'s pharmacy.',
      },
      {
        id: 'cl-3',
        question: 'How do I order and review lab tests?',
        answer: 'Use the <strong>Labs</strong> section from the sidebar. You can create lab orders, print requisition forms, and review results when they come back. Results integrate directly into the patient chart for easy access during encounters.',
      },
      {
        id: 'cl-4',
        question: 'What is Clinical Decision Support (CDS)?',
        answer: '<strong>CDS</strong> (Clinical → Decision Support) provides evidence-based alerts, reminders, and recommendations during patient care. It can flag drug interactions, suggest preventive screenings, and highlight gaps in care based on clinical guidelines.',
      },
    ],
  },
  {
    id: 'billing',
    title: 'Billing & Claims',
    icon: 'bi-credit-card',
    items: [
      {
        id: 'bl-1',
        question: 'How do I generate a superbill?',
        answer: 'After completing an encounter, go to <strong>Billing → Billing Dashboard</strong>. Select the encounter and click <strong>Generate Superbill</strong>. Review CPT/ICD-10 codes, add modifiers if needed, and submit for claims processing.',
      },
      {
        id: 'bl-2',
        question: 'How do I submit insurance claims?',
        answer: 'From the <strong>Billing Dashboard</strong>, select encounters ready for billing. Click <strong>Submit Claims</strong> to generate ANSI X12 837 electronic claims. You can batch-submit multiple claims and track their status from the same dashboard.',
      },
      {
        id: 'bl-3',
        question: 'How do I post payments and adjustments?',
        answer: 'Navigate to <strong>Billing → Medical Billing</strong>. Search for the patient or claim, then use the <strong>Post Payment</strong> option. Enter the payment amount, method, and any adjustments. The patient\'s balance updates automatically.',
      },
    ],
  },
  {
    id: 'reports',
    title: 'Reports & Analytics',
    icon: 'bi-graph-up-arrow',
    items: [
      {
        id: 'rp-1',
        question: 'What reports are available?',
        answer: 'OpenRx includes reports for <strong>clinical metrics</strong> (patient volume, diagnoses), <strong>financial performance</strong> (revenue, aging AR), <strong>practice productivity</strong> (provider RVUs, encounter counts), and <strong>quality measures</strong> (MIPS, UDS). Access them from <strong>Reports</strong> in the sidebar.',
      },
      {
        id: 'rp-2',
        question: 'How do I export report data?',
        answer: 'Most reports include an <strong>Export</strong> button that allows you to download data as CSV, Excel, or PDF. You can filter reports by date range, provider, and other parameters before exporting.',
      },
      {
        id: 'rp-3',
        question: 'What is the Surveillance report?',
        answer: 'The <strong>Surveillance</strong> report (Reports → Surveillance) monitors public health trends across your patient population. It tracks infectious diseases, immunization rates, and reportable conditions for health department submissions.',
      },
    ],
  },
  {
    id: 'portal',
    title: 'Patient Portal',
    icon: 'bi-window',
    items: [
      {
        id: 'pt-1',
        question: 'What can patients do in the portal?',
        answer: 'Patients can <strong>view their medical records</strong> (labs, medications, immunizations), <strong>send secure messages</strong> to their provider, <strong>request prescription refills</strong>, <strong>schedule appointments</strong>, <strong>pay bills online</strong>, and <strong>update demographics</strong>.',
      },
      {
        id: 'pt-2',
        question: 'How do patients access the portal?',
        answer: 'Patients can access the portal at <code>/portal/login</code>. They need their <strong>portal username and password</strong>, which are provided during registration or can be set up by clinic staff from the patient\'s chart.',
      },
      {
        id: 'pt-3',
        question: 'Is the patient portal secure?',
        answer: 'Yes. All portal communications use <strong>HTTPS encryption</strong>. The portal is <strong>HIPAA-compliant</strong>, with role-based access controls, audit logging, and automatic session timeouts. Two-factor authentication can be enabled for additional security.',
      },
    ],
  },
  {
    id: 'admin',
    title: 'Administration & Settings',
    icon: 'bi-gear',
    items: [
      {
        id: 'ad-1',
        question: 'How do I add a new user?',
        answer: 'Go to <strong>Admin → System Admin → Users</strong> tab. Fill in the username, first/last name, and click <strong>Create User</strong>. Then assign the user a role and password. New users should change their password on first login.',
      },
      {
        id: 'ad-2',
        question: 'How do I manage facilities?',
        answer: 'Navigate to <strong>Admin → System Admin → Facilities</strong> to view all locations. To add a new facility, go to the legacy interface at <code>/interface/usergroup/facilities_add.php</code>. Each facility can have its own address, phone, and service codes.',
      },
      {
        id: 'ad-3',
        question: 'How do I back up the database?',
        answer: 'Database backups can be performed from the <strong>Admin → System Admin → Legacy Links</strong> section by clicking <strong>Database</strong>. This opens the SQL Patch tool where you can export the full database. Automated backups are recommended via cron jobs.',
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    icon: 'bi-tools',
    items: [
      {
        id: 'tr-1',
        question: 'The page is loading slowly. What should I do?',
        answer: 'Try <strong>clearing your browser cache</strong> and cookies, then reload. If the issue persists, check your internet connection. For persistent performance issues, contact your system administrator — the server may need resource tuning.',
      },
      {
        id: 'tr-2',
        question: 'I forgot my password. How do I reset it?',
        answer: 'Click <strong>Forgot Password</strong> on the login screen. You\'ll receive a reset link at your registered email address. If you\'re an administrator and can\'t reset your password, another admin can reset it from Admin → Users.',
      },
      {
        id: 'tr-3',
        question: 'A patient record is not saving properly.',
        answer: 'Ensure all <strong>required fields</strong> (marked with an asterisk) are filled in. Check for any validation error messages highlighted in red. If the issue continues, try logging out and back in, or contact support with the specific error message.',
      },
      {
        id: 'tr-4',
        question: 'How do I report a bug or request a feature?',
        answer: 'Use the <strong>Discussions</strong> page in the sidebar to post topics, report bugs, or request features. Our team reviews all posts and responds within 24 hours. You can also email <a href="mailto:support@transtechologies.com">support@transtechologies.com</a> directly.',
      },
    ],
  },
];

const quickLinks = [
  { icon: 'bi-book', label: 'User Manual', href: '/wiki', desc: 'OpenRx documentation & guides' },
  { icon: 'bi-chat-square-text', label: 'Discussions', href: '/messages', desc: 'Post topics, ask questions, share knowledge' },
  { icon: 'bi-envelope', label: 'Contact Support', href: 'mailto:support@transtechologies.com', desc: 'Email our support team' },
  { icon: 'bi-key', label: 'License', href: '/license', desc: 'Activate or check license status' },
];

export default function HelpFaqPage() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>(faqData[0].id);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return faqData;

    const query = search.toLowerCase();
    return faqData
      .map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (item) =>
            item.question.toLowerCase().includes(query) ||
            item.answer.toLowerCase().replace(/<[^>]*>/g, '').includes(query),
        ),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [search]);

  const toggleItem = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleCategory = (_id: string, items: FaqItem[]) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      const allExpanded = items.every((item) => next.has(item.id));
      if (allExpanded) {
        items.forEach((item) => next.delete(item.id));
      } else {
        items.forEach((item) => next.add(item.id));
      }
      return next;
    });
  };

  const activeCat = filteredCategories.find((c) => c.id === activeCategory);
  const totalResults = filteredCategories.reduce((sum, c) => sum + c.items.length, 0);

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
      {/* Header */}
      <div className="d-flex align-items-center mb-4">
        <div>
          <h3 className="mb-1">
            <i className="bi bi-question-circle me-2 text-primary"></i>
            Help & FAQ
          </h3>
          <p className="text-muted mb-0 small">
            Find answers to common questions and learn how to use OpenRx
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="card shadow-sm mb-4 border-0">
        <div className="card-body p-3">
          <div className="input-group input-group-lg">
            <span className="input-group-text bg-white border-end-0">
              <i className="bi bi-search text-muted"></i>
            </span>
            <input
              type="text"
              className="form-control border-start-0 ps-0"
              placeholder="Search help articles..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (e.target.value.trim() && filteredCategories.length > 0) {
                  setActiveCategory(filteredCategories[0].id);
                }
              }}
            />
            {search && (
              <button
                className="btn btn-outline-secondary border-start-0"
                onClick={() => setSearch('')}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          {search && (
            <div className="mt-2 small text-muted">
              <i className="bi bi-info-circle me-1"></i>
              Found {totalResults} result{totalResults !== 1 ? 's' : ''} for "{search}"
            </div>
          )}
        </div>
      </div>

      <div className="row g-4">
        {/* Category Tabs - Left Side */}
        <div className="col-md-3">
          <div className="card shadow-sm border-0 sticky-top" style={{ top: '1rem' }}>
            <div className="card-header bg-transparent border-bottom">
              <h6 className="mb-0">
                <i className="bi bi-folder me-2"></i>Categories
              </h6>
            </div>
            <div className="list-group list-group-flush">
              {filteredCategories.map((cat) => (
                <button
                  key={cat.id}
                  className={`list-group-item list-group-item-action border-0 d-flex align-items-center gap-2 py-2 px-3 ${
                    activeCategory === cat.id ? 'active' : ''
                  }`}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  <i className={`bi ${cat.icon}`} style={{ fontSize: '0.9rem' }}></i>
                  <span className="small">{cat.title}</span>
                  <span className="badge bg-secondary ms-auto" style={{ fontSize: '0.65rem' }}>
                    {cat.items.length}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* FAQ Content - Right Side */}
        <div className="col-md-9">
          {activeCat && activeCat.items.length > 0 ? (
            <div className="card shadow-sm border-0">
              <div className="card-header bg-transparent d-flex align-items-center justify-content-between">
                <h5 className="mb-0">
                  <i className={`bi ${activeCat.icon} me-2 text-primary`}></i>
                  {activeCat.title}
                </h5>
                <button
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => toggleCategory(activeCat.id, activeCat.items)}
                >
                  {activeCat.items.every((item) => expandedItems.has(item.id)) ? (
                    <>
                      <i className="bi bi-chevron-up me-1"></i>Collapse All
                    </>
                  ) : (
                    <>
                      <i className="bi bi-chevron-down me-1"></i>Expand All
                    </>
                  )}
                </button>
              </div>
              <div className="card-body p-0">
                <div className="accordion accordion-flush" id="faqAccordion">
                  {activeCat.items.map((item, _idx) => {
                    const isOpen = expandedItems.has(item.id);
                    return (
                      <div className="accordion-item" key={item.id}>
                        <h2 className="accordion-header">
                          <button
                            className={`accordion-button ${isOpen ? '' : 'collapsed'}`}
                            type="button"
                            onClick={() => toggleItem(item.id)}
                            aria-expanded={isOpen}
                          >
                            <span className="me-2 text-primary fw-bold" style={{ fontSize: '0.85rem' }}>
                              Q:
                            </span>
                            {item.question}
                          </button>
                        </h2>
                        <div className={`accordion-collapse collapse ${isOpen ? 'show' : ''}`}>
                          <div className="accordion-body text-muted">
                            <span className="me-2 text-success fw-bold" style={{ fontSize: '0.85rem' }}>
                              A:
                            </span>
                            <span dangerouslySetInnerHTML={{ __html: item.answer }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="card shadow-sm border-0">
              <div className="card-body text-center py-5">
                <i className="bi bi-search text-muted" style={{ fontSize: '3rem' }}></i>
                <h5 className="mt-3">No results found</h5>
                <p className="text-muted mb-3">
                  Try adjusting your search terms or browse the categories on the left.
                </p>
                <button
                  className="btn btn-outline-primary"
                  onClick={() => setSearch('')}
                >
                  <i className="bi bi-arrow-counterclockwise me-1"></i>Clear Search
                </button>
              </div>
            </div>
          )}

          {/* Quick Links */}
          <div className="mt-4">
            <h6 className="text-muted mb-3 text-uppercase small fw-bold">
              <i className="bi bi-link-45deg me-1"></i>Quick Links
            </h6>
            <div className="row g-3">
              {quickLinks.map((link) => (
                <div className="col-md-4 col-lg-3" key={link.label}>
                  <a
                    href={link.href}
                    target={link.href.startsWith('http') ? '_blank' : undefined}
                    rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
                    className="text-decoration-none"
                  >
                    <div className="card shadow-sm border-0 h-100 quick-link-card">
                      <div className="card-body text-center p-3">
                        <i
                          className={`bi ${link.icon} text-primary`}
                          style={{ fontSize: '1.5rem' }}
                        ></i>
                        <h6 className="mt-2 mb-1 small fw-semibold">{link.label}</h6>
                        <p className="text-muted mb-0" style={{ fontSize: '0.72rem' }}>
                          {link.desc}
                        </p>
                      </div>
                    </div>
                  </a>
                </div>
              ))}
            </div>
          </div>

          {/* Still Need Help */}
          <div
            className="card shadow-sm border-0 mt-4 text-white"
            style={{
              background: 'linear-gradient(135deg, #0d6efd 0%, #6610f2 100%)',
            }}
          >
            <div className="card-body text-center py-4">
              <i className="bi bi-headset" style={{ fontSize: '2rem' }}></i>
              <h5 className="mt-2 mb-1">Still need help?</h5>
              <p className="mb-3 opacity-75 small">
                Can't find what you're looking for? Reach out to our support team.
              </p>
              <div className="d-flex justify-content-center gap-2 flex-wrap">
                <a href="mailto:support@openemr.local" className="btn btn-light btn-sm">
                  <i className="bi bi-envelope me-1"></i>Email Support
                </a>
                <Link to="/community" className="btn btn-outline-light btn-sm">
                  <i className="bi bi-people me-1"></i>Community Forum
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
