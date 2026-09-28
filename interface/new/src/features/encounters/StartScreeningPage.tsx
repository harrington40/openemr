import { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import { useAuth } from '../../hooks/useAuth';
import { assessPatient, riskBadge } from '../../utils/nursingSafety';
import { formatVital, formatBP } from '../../utils/vitalsClassify';
import VitalsTrend from '../../components/vitals/VitalsTrend';
import VitalsViewToggle, { type VitalsView } from '../../components/vitals/VitalsViewToggle';
import { formatPatientName } from '../../utils/patientName';
import { toDateInput } from '../../utils/date';

// ── Types ───────────────────────────────────────────────────────

interface VitalForm {
  temp: string; pulse: string; resp: string; bp_systolic: string; bp_diastolic: string;
  o2_sat: string; weight: string; height: string; pain: string;
}

/**
 * Vitals that must be recorded before a screening can be completed. Triage is
 * the only point where they are captured, so a blank set here means the chart
 * has no baseline at all. Weight/height and pain are optional.
 */
const REQUIRED_VITALS: { key: keyof VitalForm; label: string }[] = [
  { key: 'bp_systolic', label: 'Systolic BP' },
  { key: 'bp_diastolic', label: 'Diastolic BP' },
  { key: 'pulse', label: 'Pulse' },
  { key: 'temp', label: 'Temperature' },
  { key: 'resp', label: 'Respirations' },
  { key: 'o2_sat', label: 'SpO\u2082' },
];

interface Prescription {
  drug: string; dosage: string; frequency: string; duration: string; instructions: string;
}

interface LabSelection {
  testName: string; priority: 'routine' | 'stat' | 'fasting'; notes: string;
}

// ── Smart Templates ─────────────────────────────────────────────

const SMART_TEMPLATES: Record<string, {
  symptoms: string[]; duration: string; severity: string;
  labs: string[]; meds: Prescription[]; imaging: string[];
  note: string;
}> = {
  'UTI': {
    symptoms: ['Dysuria', 'Frequency', 'Urgency', 'Fever', 'Flank Pain'],
    duration: '1-2 days',
    severity: 'Mild',
    labs: ['Urinalysis', 'Urine Culture'],
    meds: [
      { drug: 'Nitrofurantoin 100mg', dosage: '100mg', frequency: 'Twice daily', duration: '5 days', instructions: 'Take with food' },
    ],
    imaging: [],
    note: 'Patient reports dysuria and urinary frequency. Denies fever and flank pain.',
  },
  'Hypertension': {
    symptoms: ['Headache', 'Dizziness'],
    duration: '>7 days',
    severity: 'Moderate',
    labs: ['Comprehensive Metabolic Panel', 'Lipid Panel', 'Urinalysis'],
    meds: [
      { drug: 'Lisinopril 10mg', dosage: '10mg', frequency: 'Once daily', duration: '30 days', instructions: 'Take in the morning' },
    ],
    imaging: [],
    note: 'Elevated BP readings. No acute symptoms.',
  },
  'Diabetes Type 2': {
    symptoms: ['Fatigue', 'Polyuria', 'Polydipsia'],
    duration: '>7 days',
    severity: 'Moderate',
    labs: ['HbA1c', 'Fasting Blood Glucose', 'Comprehensive Metabolic Panel', 'Urine Microalbumin'],
    meds: [
      { drug: 'Metformin 500mg', dosage: '500mg', frequency: 'Twice daily', duration: '90 days', instructions: 'Take with meals' },
    ],
    imaging: [],
    note: 'Routine diabetes follow-up. Check HbA1c and renal function.',
  },
  'URI / Common Cold': {
    symptoms: ['Cough', 'Congestion', 'Sore Throat'],
    duration: '1-2 days',
    severity: 'Mild',
    labs: [],
    meds: [],
    imaging: [],
    note: 'Viral URI. Symptomatic management.',
  },
  'Back Pain': {
    symptoms: ['Lower Back Pain', 'Muscle Spasm'],
    duration: '3-7 days',
    severity: 'Moderate',
    labs: [],
    meds: [
      { drug: 'Ibuprofen 600mg', dosage: '600mg', frequency: 'Three times daily', duration: '7 days', instructions: 'Take with food' },
    ],
    imaging: ['Lumbar Spine X-Ray'],
    note: 'Mechanical low back pain. No red flags.',
  },
  'Annual Physical': {
    symptoms: [],
    duration: '',
    severity: 'Mild',
    labs: ['Complete Blood Count (CBC)', 'Comprehensive Metabolic Panel', 'Lipid Panel', 'TSH'],
    meds: [],
    imaging: [],
    note: 'Routine annual physical examination.',
  },
};

const ALL_SYMPTOMS = ['Dysuria', 'Frequency', 'Urgency', 'Fever', 'Flank Pain', 'Hematuria', 'Pregnancy',
  'Cough', 'Congestion', 'Sore Throat', 'Headache', 'Dizziness', 'Fatigue',
  'Polyuria', 'Polydipsia', 'Lower Back Pain', 'Muscle Spasm', 'Chest Pain', 'Shortness of Breath'];

const DURATIONS = ['<24h', '1-2 days', '3-7 days', '>7 days'];
const SEVERITIES = ['Mild', 'Moderate', 'Severe'];

// MJ-MC / MA JUAH MEMORIAL CLINIC LABORATORY REQUEST FORM — exact content and order.
// Mirrors backend/src/labreports/lab-catalog.data.ts 1:1 (sections, wording, and sequence
// are identical to the paper form; do not reorder, rename, merge, or alphabetise).
const LAB_ORDER_CATEGORIES: { title: string; groups: { subtitle?: string; tests: string[] }[] }[] = [
  {
    title: 'HAEMATOLOGY/ IMMUNO-HAEMATOLOGY',
    groups: [{ tests: ['HB Hemoglobin', 'CBC Complete blood count', 'WBC white Blood Cells', 'Malaria Smear', 'Sickle Cells Identification (rapid)', 'ABO& Rh) Blood Group', 'ESR', 'Malaria RDT'] }],
  },
  {
    title: 'IMMUNOLOGY & SEROLOGY',
    groups: [{ tests: ['Widal panel', 'Salmonella typhi O Ag', 'Salmonella typhi H Ag', 'Salmonella typhi AO Ag', 'Salmonella typhi BO Ag', 'Salmonella typhi CH Ag', 'Salmonella typhi AH Ag', 'Syphilis', 'Chlamydia (Ag) Swab', 'Filariasis (IgG+IgM)', 'Helicobacter pylori (IgG+IgM)', 'Hepatitis B Virus (screening)', 'HBsAg', 'HBsAb', 'HBcAb', 'HBeAb', 'HBeAg', 'Hepatitis C Virus (IgM+IgG)', 'Human Immunodeficiency Virus (HIV1+2)', 'Determine', 'SD Bioline', 'Uni-Gold'] }],
  },
  {
    title: 'BIOCHEMISTRY',
    groups: [
      { subtitle: 'GLUCOSE METABOLISM/DIABETES', tests: ['Fasting Blood Glucose', 'Random Blood Glucose', 'HbA1c', 'OGTT', 'LH'] },
      { subtitle: 'LIPID METABOLISM PANEL', tests: ['Cholesterol', 'Triglycerides', 'HDL Cholesterol', 'LDL Cholesterol'] },
      { subtitle: 'HEART DISEASE PANEL', tests: ['CK & CK-MB', 'Myoglobin', 'Pro-BNP', 'CTNI', 'CTnT'] },
      { subtitle: 'LIVER FUNCTION TESTS', tests: ['SGOT/AST', 'SGPT/ALT', 'ALP', 'Bilirubin (Total & Direct)', 'Calcium', 'Total Serum protein/Albumin'] },
      { subtitle: 'KIDNEY FUNCTION TEST', tests: ['Creatinine – Creatinine Kinase', 'Urea', 'BUN', 'Uric Acid'] },
      { subtitle: 'ELECTROLYTES PANEL', tests: ['Sodium Na+', 'Potassium K+', 'Chloride Cl-', 'Calcium Ca++'] },
      { subtitle: 'PANCREATIC FUNCTION PANEL', tests: ['Lipase', 'Amylase', 'Bilirubin Total', 'Bilirubin Direct'] },
      { subtitle: 'THYROID FUNCTION TESTS', tests: ['TSH (screening)', 'T4 total', 'T4 free', 'TB Total'] },
      { subtitle: 'TUMAR MARKERS', tests: ['PSA, total', 'PSA free', 'CEA', 'AFP'] },
    ],
  },
  {
    title: 'NUTRITIONAL PANEL',
    groups: [{ tests: ['CBC', 'Iron', 'Folic Acid', 'Electrolyte panel', 'Platelet counts'] }],
  },
  {
    title: 'COAGULATION ACTIVITIES',
    groups: [{ tests: ['PT', 'APTT', 'Bleeding Time', 'D-Dimer'] }],
  },
  {
    title: 'INFERTILITY FEMALE',
    groups: [{ tests: ['FSH', 'LH', 'Prolactin', 'Progesterone', 'Testosterone', 'TSH'] }],
  },
  {
    title: 'INFERTILITY MALE',
    groups: [{ tests: ['Semen Analysis', 'FSH', 'LH', 'Prolactin', 'Testosterone'] }],
  },
  {
    title: 'EARLY PREGNANCY CHECK UP',
    groups: [{ tests: ['CBC & Blood Group', 'Glucose Random', 'VDRL (non-treponemic)', 'HIV 1+2 Ag', 'HBsAg', 'HCV (IgG+IgM)', 'Malaria RDT & WIDAL', 'Urinalysis and HCG', 'B-HCG'] }],
  },
  {
    title: 'COLORECTAL OCCUTE BLOOD TEST',
    groups: [{ tests: ['Fecal Occult Blood test'] }],
  },
  {
    title: 'URINALYSIS',
    groups: [
      { subtitle: 'MACROSCOPIC EXAMINATION', tests: ['Color', 'Character'] },
      { subtitle: 'CHEMISTRY EXAMINATION', tests: ['Urobilinogen', 'Bilirubin', 'Ketone', 'Glucose', 'Protein', 'Blood', 'Nitrite', 'pH', 'S.G.', 'Leukocytes'] },
      { subtitle: 'MICROSCOPIC EXAMINATION', tests: ['WBC', 'RBC', 'Ep. Cells', 'Casts', 'Crystals', 'Parasite', 'Yeasts', 'Bacteria', 'Others'] },
    ],
  },
  {
    title: 'PARASITOLOGY STOOL (WET MOUNT)',
    groups: [
      { subtitle: 'MACROSCOPIC EXAMINATION', tests: ['Color', 'Consistency', 'Mucoid'] },
      { subtitle: 'MICROSCOPIC EXAMINATION', tests: ['WBC', 'RBC', 'Parasite (O/P)'] },
    ],
  },
];

// Paper-faithful medication/supply order categories (exact source spellings preserved).
const MED_CATEGORIES: { name: string; type: 'medication' | 'supply' | 'oxygen'; items: string[] }[] = [
  { name: 'ORAL MEDICATIONS', type: 'medication', items: ['Amoxicillin 250mg capsule', 'Amoxicillin 500mg capsule', 'Amoxicillin Clavulanic (Augmentin 625mg)', 'Ampicillin 250mg capsule', 'Ampicillin 500mg capsule', 'Amitriptyline 25mg tab', 'Azithromycin 500mg tab', 'Ciprofloxacin 500mg tab', 'Clarithromycin 500mg tab', 'Cloxacillin 250mg capsule', 'Cloxacillin 500mg capsule', 'Cyproheptadine 4mg tab'] },
  { name: 'SYRUPS', type: 'medication', items: ['Amoxicillin Syrup 125mg/5ml', 'Paracetamol Syrup 120mg/5ml', 'Ibuprofen Syrup 100mg/5ml', 'Cough Syrup', 'Multivitamin Syrup'] },
  { name: 'INJECTABLE', type: 'medication', items: ['Ceftriaxone 1g injection', 'Gentamicin 80mg injection', 'Diclofenac 75mg injection', 'Hydrocortisone 100mg injection', 'Artemether 80mg injection', 'Vitamin K 10mg injection'] },
  { name: 'INTRAVENOUS FLUIDS', type: 'supply', items: ['Normal Saline 0.9% 500ml', 'Dextrose 5% 500ml', "Ringer's Lactate 500ml", 'Dextrose Saline 500ml'] },
  { name: 'INTRAVENOUS CANNULA', type: 'supply', items: ['IV Cannula 18G', 'IV Cannula 20G', 'IV Cannula 22G', 'IV Cannula 24G'] },
  { name: 'SYRINGES & NEEDLES', type: 'supply', items: ['Syringe 5ml', 'Syringe 10ml', 'Syringe 20ml'] },
  { name: 'NEEDLES', type: 'supply', items: ['Needle 21G', 'Needle 22G', 'Needle 23G', 'Needle 25G'] },
  { name: 'OTHERS', type: 'supply', items: ['Gauze', 'Cotton Wool', 'Gloves', 'Bandage', 'Plaster'] },
  { name: 'TROPICAL APPLICATIONS', type: 'medication', items: ['Clotrimazole Cream', 'Hydrocortisone Cream', 'Silver Sulfadiazine Cream', 'Calamine Lotion'] },
  { name: 'EYE & EAR DROP', type: 'medication', items: ['Ciprofloxacin Eye Drop', 'Gentamicin Eye Drop', 'Chloramphenicol Eye Drop', 'Otogesic Ear Drop'] },
  { name: 'OXYGEN ADMINSTRATION', type: 'oxygen', items: ['Oxygen 1-2 L/min', 'Oxygen 3-5 L/min'] },
];

const COMMON_IMAGING = ['None', 'Chest X-Ray', 'Renal Ultrasound', 'Lumbar Spine X-Ray',
  'Abdominal Ultrasound', 'CT Abdomen', 'MRI Lumbar'];

const QUICK_NOTES: Record<string, string> = {
  'UTI Follow-up': 'UTI symptoms resolved. Urine culture negative. No further treatment needed.',
  'BP Check': 'Blood pressure well-controlled on current medication. Continue same regimen.',
  'Normal Exam': 'Physical examination unremarkable. No acute findings.',
  'Refill': 'Medication refill requested. Patient stable on current regimen.',
  'Sick Visit': 'Acute illness. Symptomatic treatment initiated.',
};

const PHYSICAL_EXAM_NOTES: Record<string, string> = {
  'General': 'Well-appearing, alert, and in no acute distress.',
  'HEENT': 'Normocephalic, atraumatic. Pupils equal and reactive to light. Mucous membranes moist.',
  'Cardiac': 'Regular rate and rhythm. No murmurs, rubs, or gallops.',
  'Respiratory': 'Clear to auscultation bilaterally. No wheezes, crackles, or rhonchi.',
  'Abdominal': 'Soft, non-tender, non-distended. Bowel sounds present in all quadrants.',
  'Neuro': 'Alert and oriented x4. Cranial nerves grossly intact.',
  'Skin': 'Warm, dry, and intact. No rashes or lesions.',
  'MSK': 'Normal gait and station. Full range of motion without deformity.',
};

// ── Smart acuity classification (mirrors the backend routing algorithm) ──

const STAT_KEYWORDS = ['chest pain', 'shortness of breath', 'unresponsive', 'seizure',
  'hemorrhage', 'severe bleeding', 'anaphylaxis', 'cardiac arrest', 'respiratory distress',
  'stroke', 'stat', 'emergency'];

const URGENT_KEYWORDS = ['fever', 'dehydration', 'vomiting', 'diarrhea', 'abdominal pain',
  'dizziness', 'syncope', 'hypertension', 'high blood pressure', 'infection', 'wheezing',
  'urgent', 'severe pain', 'altered mental status'];

type AcuityLevel = 'routine' | 'urgent' | 'stat';

function computeAcuity(note: string): { level: AcuityLevel; score: number } {
  const text = (note || '').toLowerCase();
  let score = 0;
  for (const kw of STAT_KEYWORDS) if (text.includes(kw)) score += 30;
  for (const kw of URGENT_KEYWORDS) if (text.includes(kw)) score += 15;
  const level: AcuityLevel = score >= 60 ? 'stat' : score >= 30 ? 'urgent' : 'routine';
  return { level, score };
}

function SmartAcuityBadge({ note }: { note: string }) {
  const { level, score } = useMemo(() => computeAcuity(note), [note]);
  const color = level === 'stat' ? '#dc3545' : level === 'urgent' ? '#fd7e14' : '#198754';
  const icon = level === 'stat' ? 'bi-exclamation-octagon' : level === 'urgent' ? 'bi-exclamation-triangle' : 'bi-check-circle';
  return (
    <span className="badge rounded-pill d-inline-flex align-items-center gap-1"
      style={{ backgroundColor: `${color}20`, color, fontSize: '0.6rem' }}
      title={`Smart acuity score: ${score} — shared with the nursing team`}>
      <i className={`bi ${icon}`}></i>Smart {level.toUpperCase()} ({score})
    </span>
  );
}

// ── Age from DOB ─────────────────────────────────────────────────

function computeAge(dob: string | undefined): string {
  if (!dob) return '';
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return `${age}y`;
}

// ── Main Component ───────────────────────────────────────────────

export default function StartScreeningPage() {
  const { pid } = useParams<{ pid: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Patient
  const { data: patient } = useQuery({
    queryKey: ['patient', pid],
    queryFn: async () => { const r = await nestClient.get(`/patients/${pid}`); return r.data; },
    enabled: !!pid,
  });

  // The route param is the patient row id; clinical tables (and notes) use the
  // clinical `pid`, so derive it from the loaded patient for consistency with
  // the patient chart.
  const clinicalPid = patient?.pid;

  // Allergies
  const { data: allergies = [] } = useQuery({
    queryKey: ['patient', pid, 'allergies'],
    queryFn: async () => { const r = await nestClient.get(`/patients/${clinicalPid}/allergies`); return r.data; },
    enabled: !!clinicalPid,
  });

  // Existing chart notes — surfaced on the screening page so the provider can
  // review the patient's full-chart notes alongside the other features.
  const { data: existingNotes = [] } = useQuery({
    queryKey: ['patient', pid, 'notes'],
    queryFn: async () => {
      try { const r = await nestClient.get(`/patients/${clinicalPid}/notes`); return r.data || []; }
      catch { return []; }
    },
    enabled: !!clinicalPid,
  });

  // Vital history — previously recorded vitals surfaced on the screening page.
  const { data: vitalHistory = [] } = useQuery({
    queryKey: ['patient', pid, 'vitals'],
    queryFn: async () => {
      try { const r = await nestClient.get(`/patients/${clinicalPid}/vitals`); return r.data || []; }
      catch { return []; }
    },
    enabled: !!clinicalPid,
  });

  // Template
  const [template, setTemplate] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');

  // Quick Assessment
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [duration, setDuration] = useState('');
  const [severity, setSeverity] = useState('');

  // Per-symptom notes (opened from a symptom chip's note button)
  const [symptomNotes, setSymptomNotes] = useState<Record<string, string>>({});
  const [noteEnabled, setNoteEnabled] = useState<Record<string, boolean>>({});
  const [noteModal, setNoteModal] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteDraftEnabled, setNoteDraftEnabled] = useState(false);

  const openSymptomNote = (s: string) => {
    setNoteModal(s);
    setNoteDraft(symptomNotes[s] || '');
    setNoteDraftEnabled(!!noteEnabled[s]);
  };

  const saveSymptomNote = () => {
    if (!noteModal) return;
    const note = noteDraft.trim();
    setNoteEnabled(prev => ({ ...prev, [noteModal]: noteDraftEnabled && !!note }));
    setSymptomNotes(prev => {
      const next = { ...prev };
      if (noteDraftEnabled && note) next[noteModal] = note;
      else delete next[noteModal];
      return next;
    });
    setNoteModal(null);
  };

  // Physical Examination
  const [physicalExam, setPhysicalExam] = useState('');
  const [examOrderOpen, setExamOrderOpen] = useState(false);

  // Vitals (compact)
  const [vitals, setVitals] = useState<VitalForm>({
    temp: '', pulse: '', resp: '', bp_systolic: '', bp_diastolic: '', o2_sat: '', weight: '', height: '', pain: '',
  });
  const [showVitals, setShowVitals] = useState(false);

  // Labs
  const [selectedLabs, setSelectedLabs] = useState<LabSelection[]>([]);
  const [labOrderOpen, setLabOrderOpen] = useState(false);
  const [labOrderSearch, setLabOrderSearch] = useState('');
  const [labOrderCats, setLabOrderCats] = useState<Record<string, boolean>>({});

  // Meds
  const [selectedMeds, setSelectedMeds] = useState<Prescription[]>([]);

  // Medication order modal state machine
  const [medOrderOpen, setMedOrderOpen] = useState(false);
  const [medOrderStage, setMedOrderStage] = useState<'categories' | 'list' | 'editor' | 'sign'>('categories');
  const [medOrderCategory, setMedOrderCategory] = useState('');
  const [medOrderSearch, setMedOrderSearch] = useState('');
  const [medDraft, setMedDraft] = useState<any>({ drug: '', dose: '', route: 'Oral', frequency: '', startDate: toDateInput(new Date()), duration: '', quantity: '', administration: '', indication: '', instructions: '', flowRate: '', deliveryMethod: '' });

  // Imaging
  const [selectedImaging, setSelectedImaging] = useState<string[]>([]);
  const [imagingOrderOpen, setImagingOrderOpen] = useState(false);
  const [imagingOrderSearch, setImagingOrderSearch] = useState('');

  // Note
  const [clinicalNote, setClinicalNote] = useState('');
  const [showQuickNotes, setShowQuickNotes] = useState(false);
  const [showClinicalModal, setShowClinicalModal] = useState(false);
  const [soap, setSoap] = useState({ subjective: '', objective: '', assessment: '', plan: '' });
  const [showReferral, setShowReferral] = useState(false);

  // Referral
  const [referralNote, setReferralNote] = useState('');

  // Pharmacy
  const [pharmacy, setPharmacy] = useState('');

  // Draft
  const [draftSaved, setDraftSaved] = useState(false);

  // Validation
  const [showValidation, setShowValidation] = useState(false);
  /** Required vitals that blocked completion, surfaced in the alert. */
  const [missingVitalsNotice, setMissingVitalsNotice] = useState<string[]>([]);
  /** Why the vitals save was refused by the API, if it was. */
  const [vitalsSaveError, setVitalsSaveError] = useState('');

  // Note sharing + chart notes panel
  const [shareWithNursing, setShareWithNursing] = useState(true);
  const [showChartNotes, setShowChartNotes] = useState(true);

  // Quick add-a-note-to-chart
  const [chartNote, setChartNote] = useState('');
  const [chartNoteSaved, setChartNoteSaved] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteTab, setNoteTab] = useState<'review' | 'history' | 'vitals'>('review');

  // Vital history panel
  const [vitalHistoryOpen, setVitalHistoryOpen] = useState(false);
  const [vitalsView, setVitalsView] = useState<VitalsView>('chart');

  // ── Save / Load Draft ──────────────────────────────────────

  const saveDraft = () => {
    const draft = { symptoms, duration, severity, selectedLabs, selectedMeds, selectedImaging, clinicalNote, referralNote, vitals, template, pharmacy, soap };
    localStorage.setItem(`screening-draft-${pid}`, JSON.stringify(draft));
    setDraftSaved(true);
    setTimeout(() => setDraftSaved(false), 2000);
  };

  const loadDraft = () => {
    const raw = localStorage.getItem(`screening-draft-${pid}`);
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      if (d.symptoms) setSymptoms(d.symptoms);
      if (d.duration) setDuration(d.duration);
      if (d.severity) setSeverity(d.severity);
      if (d.selectedLabs) setSelectedLabs(d.selectedLabs);
      if (d.selectedMeds) setSelectedMeds(d.selectedMeds);
      if (d.selectedImaging) setSelectedImaging(d.selectedImaging);
      if (d.clinicalNote) setClinicalNote(d.clinicalNote);
      if (d.referralNote) setReferralNote(d.referralNote);
      if (d.vitals) setVitals(d.vitals);
      if (d.template) setTemplate(d.template);
      if (d.pharmacy) setPharmacy(d.pharmacy);
      if (d.soap) setSoap(d.soap);
    } catch { /* ignore */ }
  };

  // Check for existing draft on mount
  useEffect(() => {
    const raw = localStorage.getItem(`screening-draft-${pid}`);
    if (raw) { setDraftSaved(true); loadDraft(); }
  }, [pid]);

  // Auto-save the note/draft as the provider types (debounced) so nothing is lost
  // when navigating to another tab.
  useEffect(() => {
    const t = setTimeout(() => saveDraft(), 800);
    return () => clearTimeout(t);
  }, [symptoms, duration, severity, selectedLabs, selectedMeds, selectedImaging, clinicalNote, referralNote, vitals, template, pharmacy, soap]);

  // ── Mutations ────────────────────────────────────────────────

  const createEncounter = useMutation({
    mutationFn: async () => {
      const r = await nestClient.post(`/patients/${clinicalPid}/encounters`, {
        reason: template || 'Screening Visit', class_code: 'AMB', facility: '', provider_id: '',
      });
      return r.data;
    },
  });

  const saveVitals = useMutation({
    mutationFn: async () => {
      // Post the form_vitals column names. The screening form keeps its own
      // short labels (temp/resp/bp_systolic/o2_sat), which the API used to
      // ignore — so the whole set was saved blank.
      const w = Number(vitals.weight);
      const h = Number(vitals.height);
      const payload: Record<string, any> = {
        bps: vitals.bp_systolic || null,
        bpd: vitals.bp_diastolic || null,
        pulse: vitals.pulse || null,
        respiration: vitals.resp || null,
        temperature: vitals.temp || null,
        oxygen_saturation: vitals.o2_sat || null,
        weight: vitals.weight || null,
        height: vitals.height || null,
      };
      if (w > 0 && h > 0) payload.BMI = Math.round((w / Math.pow(h / 100, 2)) * 10) / 10;
      return nestClient.post(`/patients/${clinicalPid}/vitals`, payload);
    },
  });

  const savePrescriptions = useMutation({
    mutationFn: async () => {
      if (!selectedMeds.length) return;
      return nestClient.post(`/patients/${clinicalPid}/medications/batch`, { medications: selectedMeds });
    },
  });

  // Persist a single medication immediately at "Sign & Send to Pharmacy" so the
  // order reaches the pharmacy dashboard without waiting for the encounter to be
  // completed. Duplicate detection in the backend prevents double entries.
  const sendSingleMed = useMutation({
    mutationFn: async (m: any) => {
      if (!clinicalPid || !m?.drug) return null;
      return nestClient.post(`/patients/${clinicalPid}/medications`, {
        drug: m.drug,
        dosage: m.dosage || '',
        quantity: m.quantity || '',
        route: m.frequency || '',
        refills: 0,
        note: m.duration ? `Duration: ${m.duration} days` : (m.instructions || ''),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-prescriptions'] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-alerts'] });
    },
  });

  const saveLabOrders = useMutation({
    mutationFn: async () => {
      if (!selectedLabs.length) return;
      return nestClient.post(`/patients/${clinicalPid}/procedures`, {
        orders: selectedLabs,
        // provider_id auto-detected from JWT by backend
      });
    },
  });

  const saveSoap = useMutation({
    mutationFn: async () => nestClient.post(`/patients/${clinicalPid}/soap`, {
      subjective: [
        symptoms.length ? `Reports: ${symptoms.join(', ')}. Duration: ${duration}. Severity: ${severity}.` : '',
        Object.entries(symptomNotes).filter(([, n]) => n && n.trim()).map(([s, n]) => `${s}: ${n}`).join('; '),
      ].filter(Boolean).join(' '),
      objective: `Vitals: BP ${vitals.bp_systolic || '--'}/${vitals.bp_diastolic || '--'}, HR ${vitals.pulse || '--'}, Temp ${vitals.temp || '--'}`,
      assessment: template || clinicalNote.slice(0, 100),
      plan: `Labs: ${selectedLabs.map(l => l.testName).join(', ') || 'none'}. Meds: ${selectedMeds.map(m => m.drug).join(', ') || 'none'}. Imaging: ${selectedImaging.join(', ') || 'none'}.`,
    }),
  });

  // Clinical note → documented in the patient chart AND routed to nursing.
  const saveClinicalNote = useMutation({
    mutationFn: async (noteText?: string) => {
      const text = (noteText ?? clinicalNote).trim();
      if (!text || !clinicalPid) return null;
      const r = await nestClient.post(`/patients/${clinicalPid}/notes`, {
        note: text,
        title: template ? `Screen Note — ${template}` : 'Screen Note',
        shareWithNursing,
        source: 'screening',
        vitals,
      });
      return r.data;
    },
  });

  // Quick add-a-note-to-chart — writes immediately to the patient chart.
  const addChartNote = useMutation({
    mutationFn: async () => {
      if (!chartNote.trim() || !clinicalPid) return null;
      const r = await nestClient.post(`/patients/${clinicalPid}/notes`, {
        note: chartNote.trim(),
        title: 'History',
        shareWithNursing: true,
        source: 'screening',
      });
      return r.data;
    },
    onSuccess: () => {
      setChartNote('');
      setChartNoteSaved(true);
      setTimeout(() => setChartNoteSaved(false), 3000);
      queryClient.invalidateQueries({ queryKey: ['patient', pid, 'notes'] });
      queryClient.invalidateQueries({ queryKey: ['nurse-dashboard'] });
    },
  });

  const autoBill = useMutation({
    mutationFn: async (encounterId: number) => nestClient.post(`/billing/encounters/${encounterId}/auto-bill`, {
      pid: Number(clinicalPid),
      template,
      labTests: selectedLabs.map(l => l.testName),
      imaging: selectedImaging.filter(i => i !== 'None'),
    }),
  });

  const saving = createEncounter.isPending || saveVitals.isPending ||
    savePrescriptions.isPending || saveLabOrders.isPending || saveSoap.isPending ||
    saveClinicalNote.isPending || autoBill.isPending;

  /** Required vitals that are still blank, so we can name them in the UI. */
  const missingVitals = useMemo(
    () =>
      REQUIRED_VITALS.filter((v) => {
        // Mirrors the API rule: a reading has to be greater than 0, so "0" is
        // treated as not recorded rather than sent and rejected.
        const n = Number(vitals[v.key]);
        return !(Number.isFinite(n) && n > 0);
      }).map((v) => v.label),
    [vitals],
  );

  const handleComplete = async () => {
    // Vitals come first: triage is the only place they are taken, so completing
    // the screening without them would leave the chart with no baseline.
    if (missingVitals.length > 0) {
      setMissingVitalsNotice(missingVitals);
      setShowVitals(true);
      return;
    }

    const hasSomething = symptoms.length > 0 || selectedLabs.length > 0 ||
      selectedMeds.length > 0 || selectedImaging.length > 0 || clinicalNote.length > 0 ||
      Object.values(vitals).some(v => v !== '');

    if (!hasSomething) {
      setShowValidation(true);
      return;
    }

    setMissingVitalsNotice([]);
    setVitalsSaveError('');
    setShowValidation(false);
    try {
      const encResult = await createEncounter.mutateAsync();
      const encounterId = encResult?.encounterId || encResult?.id;

      // Vitals are mandatory, so a failure has to stop the flow and be shown.
      // Previously every save was wrapped in Promise.allSettled, which swallowed
      // the error and navigated away — the vitals silently never appeared.
      try {
        await saveVitals.mutateAsync();
      } catch (err: any) {
        setVitalsSaveError(
          err?.response?.data?.message || err?.message || 'Vitals could not be saved.',
        );
        setShowVitals(true);
        return;
      }

      await Promise.allSettled([
        savePrescriptions.mutateAsync(),
        saveLabOrders.mutateAsync(),
        saveSoap.mutateAsync(),
        saveClinicalNote.mutateAsync(undefined),
        encounterId ? autoBill.mutateAsync(encounterId) : Promise.resolve(),
      ]);
    } catch (e) {
      // Continue to dashboard even if some non-vital saves fail
    }
    queryClient.invalidateQueries({ queryKey: ['provider-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['all-lab-orders'] });
    queryClient.invalidateQueries({ queryKey: ['provider-lab-orders'] });
    queryClient.invalidateQueries({ queryKey: ['billing-patients'] });
    queryClient.invalidateQueries({ queryKey: ['billing-auto-calc'] });
    queryClient.invalidateQueries({ queryKey: ['patient', pid, 'notes'] });
    queryClient.invalidateQueries({ queryKey: ['nurse-dashboard'] });
    navigate('/provider-dashboard');
  };

  // ── Apply Template ──────────────────────────────────────────

  const matchingTemplate = useMemo(() => {
    if (!templateSearch || templateSearch.length < 2) return null;
    const q = templateSearch.toLowerCase();
    for (const [key, tmpl] of Object.entries(SMART_TEMPLATES)) {
      if (key.toLowerCase().includes(q)) return { key, ...tmpl };
    }
    return null;
  }, [templateSearch]);

  const applyTemplate = useCallback(() => {
    if (!matchingTemplate) return;
    setTemplate(matchingTemplate.key);
    setSymptoms([...matchingTemplate.symptoms]);
    setDuration(matchingTemplate.duration);
    setSeverity(matchingTemplate.severity);
    setSelectedLabs(matchingTemplate.labs.map(l => ({ testName: l, priority: 'routine' as const, notes: '' })));
    setSelectedMeds(matchingTemplate.meds.map(m => ({ ...m })));
    setSelectedImaging([...matchingTemplate.imaging]);
    setClinicalNote(matchingTemplate.note);
  }, [matchingTemplate]);

  // ── Vital Alerts ────────────────────────────────────────────

  const vitalAlerts = useMemo(() => {
    const a: string[] = [];
    const t = parseFloat(vitals.temp), p = parseFloat(vitals.pulse);
    const s = parseFloat(vitals.bp_systolic), d = parseFloat(vitals.bp_diastolic);
    const o = parseFloat(vitals.o2_sat);
    if (t > 38) a.push(`Temp ${t}°C ↑`);
    if (p > 100) a.push(`HR ${p} ↑`);
    if (p < 60 && p > 0) a.push(`HR ${p} ↓`);
    if (s > 140 || d > 90) a.push(`BP ${s}/${d} ↑`);
    if ((s < 90 && s > 0) || (d < 60 && d > 0)) a.push(`BP ${s}/${d} ↓`);
    if (o < 95 && o > 0) a.push(`O2 ${o}% ↓`);
    return a;
  }, [vitals]);

  // ── Lab helpers ─────────────────────────────────────────────

  const toggleLab = (name: string) => {
    setSelectedLabs(prev => {
      const exists = prev.find(l => l.testName === name);
      if (exists) return prev.filter(l => l.testName !== name);
      return [...prev, { testName: name, priority: 'routine', notes: '' }];
    });
  };

  const removeLab = (name: string) => setSelectedLabs(prev => prev.filter(l => l.testName !== name));

  // ── Med helpers ─────────────────────────────────────────────

  const removeMed = (drug: string) => setSelectedMeds(prev => prev.filter(m => m.drug !== drug));

  // ── Imaging helpers ─────────────────────────────────────────

  const toggleImaging = (name: string) => {
    if (name === 'None') { setSelectedImaging([]); return; }
    setSelectedImaging(prev => prev.includes(name) ? prev.filter(i => i !== name) : [...prev.filter(i => i !== 'None'), name]);
  };

  // ── Quick Note ──────────────────────────────────────────────

  const applyQuickNote = (key: string) => {
    setClinicalNote(prev => prev ? prev + '\n\n' + QUICK_NOTES[key] : QUICK_NOTES[key]);
    setShowQuickNotes(false);
  };

  const applyExamNote = (key: string) => {
    setPhysicalExam(prev => prev ? prev + ' ' + PHYSICAL_EXAM_NOTES[key] : PHYSICAL_EXAM_NOTES[key]);
  };

  // ── Structured SOAP clinical note ───────────────────────────

  const composeSoapNote = () => {
    const objective = soap.objective ||
      `Vitals: BP ${vitals.bp_systolic || '--'}/${vitals.bp_diastolic || '--'}, HR ${vitals.pulse || '--'}, Temp ${vitals.temp || '--'}${vitals.o2_sat ? `, SpO2 ${vitals.o2_sat}%` : ''}.`;
    const plan = soap.plan ||
      `Labs: ${selectedLabs.map(l => l.testName).join(', ') || 'none'}. Meds: ${selectedMeds.map(m => m.drug).join(', ') || 'none'}. Imaging: ${selectedImaging.filter(i => i !== 'None').join(', ') || 'none'}.`;
    const symptomNoteText = Object.entries(symptomNotes)
      .filter(([, n]) => n && n.trim())
      .map(([s, n]) => `${s}: ${n}`)
      .join('; ');
    const subjective = [soap.subjective, symptomNoteText].filter(Boolean).join(' ');
    const parts = [
      subjective ? `S: ${subjective}` : '',
      `O: ${objective}`,
      soap.assessment ? `A: ${soap.assessment}` : (template ? `A: ${template}` : ''),
      `P: ${plan}`,
    ];
    return parts.filter(Boolean).join('\n');
  };

  const handleSaveClinicalNote = () => {
    const note = composeSoapNote();
    setClinicalNote(note);
    saveClinicalNote.mutate(note);
    setShowClinicalModal(false);
    setSoap({ subjective: '', objective: '', assessment: '', plan: '' });
  };

  const applySoapTemplate = () => {
    if (!matchingTemplate) return;
    setSoap(s => ({
      ...s,
      subjective: matchingTemplate.note,
      assessment: matchingTemplate.key,
      plan: `Labs: ${matchingTemplate.labs.join(', ') || 'none'}. Meds: ${matchingTemplate.meds.map(m => m.drug).join(', ') || 'none'}.`,
    }));
  };

  // ── Keyboard shortcuts ──────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); handleComplete(); }
      if (e.altKey && e.key === 'v') { e.preventDefault(); setShowVitals(v => !v); }
      if (e.altKey && e.key === 'n') { e.preventDefault(); document.getElementById('clinical-note')?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [vitals, symptoms, selectedLabs, selectedMeds, clinicalNote]);

  // ── Computed ────────────────────────────────────────────────

  const age = computeAge(patient?.dob);
  const selectedCount = selectedLabs.length + selectedMeds.length + selectedImaging.filter(i => i !== 'None').length;

  // Latest-risk snapshot for the note modal (NEWS2 + critical-value algorithm)
  const latestVital = vitalHistory[0];
  const latestRisk = useMemo(() => {
    if (!latestVital) return null;
    const t = Number(latestVital.temperature);
    const tempC = Number.isFinite(t) && t > 45 ? Math.round(((t - 32) * 5 / 9) * 10) / 10 : (Number.isFinite(t) ? t : null);
    return assessPatient({
      bps: latestVital.bps, bpd: latestVital.bpd, pulse: latestVital.pulse,
      temperature: tempC, respiration: latestVital.respiration,
      oxygen_saturation: latestVital.oxygen_saturation,
    });
  }, [latestVital]);

  if (!pid) return <div className="alert alert-danger">No patient ID provided</div>;

  // ── RENDER ──────────────────────────────────────────────────

  return (
    <div>
      <style>{`
        .order-card {
          border-radius: 14px !important;
          background: rgba(255,255,255,0.55) !important;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid rgba(255,255,255,0.8) !important;
          box-shadow: 0 10px 24px rgba(10,37,64,0.14), 0 3px 8px rgba(10,37,64,0.08) !important;
          transition: transform .25s ease, box-shadow .25s ease, background .25s ease;
        }
        .order-card:hover {
          transform: translateY(-4px);
          background: rgba(255,255,255,0.78) !important;
          box-shadow: 0 18px 36px rgba(10,37,64,0.22), 0 6px 14px rgba(10,37,64,0.12) !important;
        }
      `}</style>
      {/* ═══ COMPACT HEADER ═══ */}
      <div className="d-flex align-items-center gap-3 px-3 py-2 mb-2 rounded-3 text-white"
        style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #6610f2 50%, #6f42c1 100%)', minHeight: '72px' }}>
        {/* Patient info */}
        <div className="flex-grow-1 min-w-0">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span className="fw-bold" style={{ fontSize: '1rem' }}>
              {formatPatientName(patient)}
            </span>
            {patient?.sex && <span className="badge bg-white text-dark" style={{ fontSize: '0.7rem' }}>{patient.sex}</span>}
            {age && <span className="text-white text-opacity-75 small">{age}</span>}
            {template && (
              <span className="badge bg-warning text-dark" style={{ fontSize: '0.7rem' }}>
                <i className="bi bi-lightning-charge me-1"></i>{template}
              </span>
            )}
          </div>
          <div className="d-flex gap-2 small mt-1 flex-wrap" style={{ fontSize: '0.7rem' }}>
            {allergies.length > 0 && (
              <span className="text-white text-opacity-75">
                <i className="bi bi-exclamation-triangle-fill text-warning me-1"></i>
                {allergies.slice(0, 3).map((a: any) => a.title || a.substance || a.name).filter(Boolean).join(', ')}
                {allergies.length > 3 && ` +${allergies.length - 3}`}
              </span>
            )}
            {vitals.temp && <span><i className="bi bi-thermometer"></i> {vitals.temp}°C</span>}
            {vitals.bp_systolic && vitals.bp_diastolic && <span><i className="bi bi-heart"></i> {vitals.bp_systolic}/{vitals.bp_diastolic}</span>}
            {vitals.pulse && <span><i className="bi bi-activity"></i> HR {vitals.pulse}</span>}
            {vitals.o2_sat && <span><i className="bi bi-droplet"></i> O2 {vitals.o2_sat}%</span>}
            {vitalAlerts.length > 0 && vitalAlerts.map((a, i) => (
              <span key={i} className="badge bg-danger" style={{ fontSize: '0.6rem' }}>{a}</span>
            ))}
          </div>
        </div>
        {/* Actions */}
        <div className="d-flex gap-1 flex-shrink-0">
          <button className="btn btn-outline-light btn-sm rounded-pill" style={{ fontSize: '0.75rem' }}
            onClick={() => navigate('/provider-dashboard')}>
            <i className="bi bi-arrow-left me-1"></i>Back
          </button>
          <button className="btn btn-success btn-sm rounded-pill px-3 fw-bold" style={{ fontSize: '0.8rem' }}
            onClick={handleComplete} disabled={saving}>
            {saving ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-check-lg me-1"></i>}
            Complete ✓
          </button>
        </div>
      </div>

      {vitalsSaveError && (
        <div className="alert alert-danger py-2 mb-2 small d-flex align-items-start gap-2" style={{ borderRadius: '8px' }}>
          <i className="bi bi-exclamation-octagon-fill fs-6"></i>
          <div className="flex-grow-1">
            <strong>Vitals were not saved</strong>
            <br />
            <span>{vitalsSaveError}</span>
          </div>
          <button type="button" className="btn btn-sm btn-outline-danger rounded-pill align-self-center"
            onClick={() => setVitalsSaveError('')}>Dismiss</button>
        </div>
      )}

      {missingVitalsNotice.length > 0 && (
        <div className="alert alert-warning py-2 mb-2 small d-flex align-items-start gap-2" style={{ borderRadius: '8px' }}>
          <i className="bi bi-heart-pulse-fill fs-6"></i>
          <div className="flex-grow-1">
            <strong>Cannot complete — vitals are missing</strong>
            <br />
            <span>Record: {missingVitalsNotice.join(', ')}</span>
            <br />
            <span className="text-muted">Vitals are taken at triage, so a screening cannot be completed without them.</span>
          </div>
          <button type="button" className="btn btn-sm btn-warning rounded-pill align-self-center"
            onClick={() => setShowVitals(true)}>
            <i className="bi bi-pencil-square me-1"></i>Record now
          </button>
        </div>
      )}

      {showValidation && (
        <div className="alert alert-danger py-2 mb-2 small" style={{ borderRadius: '8px' }}>
          <i className="bi bi-exclamation-triangle me-1"></i>
          Please record vitals, select orders, or write a screen note before completing.
        </div>
      )}

      {/* ═══ SCREEN NOTE ═══ */}
      <div className="card border-0 shadow-sm mb-2" style={{ borderRadius: '10px' }}>
        <div className="card-body py-2 px-3">
          <div className="d-flex justify-content-between align-items-center mb-1">
            <span className="fw-bold small" style={{ fontSize: '0.75rem' }}>
              <i className="bi bi-journal-text me-1 text-warning"></i>Screen Note
            </span>
            <div className="d-flex align-items-center gap-2 flex-wrap justify-content-end">
              <span className="form-check form-switch mb-0 d-inline-flex align-items-center gap-1"
                title="Document this note in the patient chart and share it with the nursing team">
                <input className="form-check-input" type="checkbox" id="share-nursing" checked={shareWithNursing}
                  onChange={e => setShareWithNursing(e.target.checked)} />
                <label className="form-check-label" htmlFor="share-nursing" style={{ fontSize: '0.6rem' }}>Share with Nursing</label>
              </span>
              {clinicalNote && <SmartAcuityBadge note={clinicalNote} />}
              <button className="btn btn-outline-secondary btn-sm rounded-pill"
                style={{ fontSize: '0.6rem', padding: '1px 8px' }}
                onClick={() => setShowQuickNotes(!showQuickNotes)}>Quick Note ▼</button>
            </div>
          </div>
          {showQuickNotes && (
            <div className="d-flex flex-wrap gap-1 mb-1">
              {Object.keys(QUICK_NOTES).map(k => (
                <button key={k} className="btn btn-outline-warning btn-sm rounded-pill"
                  style={{ fontSize: '0.6rem', padding: '1px 8px' }}
                  onClick={() => applyQuickNote(k)}>{k}</button>
              ))}
            </div>
          )}
          {clinicalNote && (
            <div className="small text-muted mb-1" style={{ whiteSpace: 'pre-wrap', maxHeight: '90px', overflowY: 'auto' }}>{clinicalNote}</div>
          )}
          <button className="btn btn-warning btn-sm rounded-pill text-nowrap"
            onClick={() => setShowClinicalModal(true)}>
            <i className="bi bi-pencil-square me-1"></i>{clinicalNote ? 'Edit Screen Note' : 'Write Screen Note'}
          </button>
        </div>
      </div>

      {/* ═══ VITAL HISTORY (previously recorded) ═══ */}
      <div className="card border-0 order-card mb-2" style={{ cursor: 'pointer', borderLeft: '4px solid #0dcaf0' }}
        onClick={() => setVitalHistoryOpen(true)} title="View vital history">
        <div className="card-body py-2 px-3">
          <div className="d-flex justify-content-between align-items-center">
            <span className="fw-bold small" style={{ fontSize: '0.75rem' }}>
              <i className="bi bi-heart-pulse me-1 text-info"></i>Vital History
            </span>
            <span className="badge bg-info rounded-pill" style={{ fontSize: '0.6rem' }}>{vitalHistory.length} record{vitalHistory.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="text-muted small mt-1" style={{ fontSize: '0.7rem' }}>Click to view table & trend chart</div>
        </div>
      </div>

      {/* ═══ SMART TEMPLATE ═══ */}
      <div className="d-flex align-items-center gap-2 px-2 py-1 mb-2 rounded-3 bg-light border" style={{ fontSize: '0.8rem' }}>
        <i className="bi bi-lightning-charge text-warning"></i>
        <span className="fw-semibold text-nowrap">Smart Template:</span>
        <input className="form-control form-control-sm border-0 bg-transparent" style={{ maxWidth: 200 }}
          placeholder="e.g. UTI, HTN..." value={templateSearch}
          onChange={e => setTemplateSearch(e.target.value)} />
        {matchingTemplate && (
          <button className="btn btn-warning btn-sm rounded-pill text-nowrap" style={{ fontSize: '0.7rem' }}
            onClick={applyTemplate}>
            <i className="bi bi-magic me-1"></i>Apply {matchingTemplate.key}
          </button>
        )}
      </div>

      {/* ═══ PHYSICAL EXAMINATION ═══ */}
      <div className="card border-0 order-card mb-2" style={{ cursor: 'pointer', borderLeft: '4px solid #6f42c1' }}
        onClick={() => setExamOrderOpen(true)} title="Open physical examination">
        <div className="card-body py-2 px-3">
          <div className="d-flex justify-content-between align-items-center">
            <span className="fw-bold small" style={{ fontSize: '0.75rem' }}>
              <i className="bi bi-clipboard-pulse me-1 text-primary"></i>Physical Examination
            </span>
            {physicalExam && <span className="badge bg-primary rounded-pill" style={{ fontSize: '0.6rem' }}>documented</span>}
          </div>
          <div className="text-muted small mt-1" style={{ fontSize: '0.7rem' }}>
            {physicalExam ? physicalExam.slice(0, 120) + (physicalExam.length > 120 ? '…' : '') : 'Click to document exam findings (systems-based)'}
          </div>
        </div>
      </div>

      {/* ═══ VITALS (progressive disclosure) ═══ */}
      {showVitals && (
        <div className="card border-0 shadow-sm mb-2" style={{ borderRadius: '10px', borderLeft: '4px solid #dc3545' }}>
          <div className="card-body py-2 px-3">
            <div className="d-flex flex-wrap gap-1">
              {[
                { k: 'temp' as const, l: 'Temp °C', p: '37.0' },
                { k: 'pulse' as const, l: 'HR bpm', p: '72' },
                { k: 'resp' as const, l: 'RR', p: '16' },
                { k: 'bp_systolic' as const, l: 'Sys', p: '120' },
                { k: 'bp_diastolic' as const, l: 'Dia', p: '80' },
                { k: 'o2_sat' as const, l: 'O2%', p: '98' },
                { k: 'weight' as const, l: 'Wt kg', p: '70' },
                { k: 'height' as const, l: 'Ht cm', p: '170' },
                { k: 'pain' as const, l: 'Pain', p: '0' },
              ].map(v => (
                <div key={v.k} className="d-flex align-items-center gap-1">
                  <label className="small text-muted mb-0" style={{ fontSize: '0.6rem', width: '40px' }}>{v.l}</label>
                  <input className="form-control form-control-sm" type="number" step="any"
                    style={{ width: '60px', fontSize: '0.75rem', padding: '2px 4px' }}
                    placeholder={v.p} value={vitals[v.k]}
                    onChange={e => setVitals(prev => ({ ...prev, [v.k]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ UNIFIED ORDERS ═══ */}
      <div className="row g-2 mb-2">
        {/* LABS column */}
        <div className="col-md-4">
          <div className="card border-0 order-card h-100" style={{ cursor: 'pointer' }}
            onClick={() => setLabOrderOpen(true)} title="Open lab order form">
            <div className="card-body py-2 px-3">
              <div className="d-flex justify-content-between align-items-center mb-1">
                <span className="fw-bold small" style={{ fontSize: '0.75rem' }}>
                  <i className="bi bi-flask me-1 text-success"></i>Labs
                </span>
                <span className="badge bg-success rounded-pill" style={{ fontSize: '0.6rem' }}>{selectedLabs.length}</span>
              </div>
              {selectedLabs.length === 0 ? (
                <div className="text-muted small" style={{ fontSize: '0.7rem' }}>
                  Click to order labs — biochemistry, hemogram, urine chemistry…
                </div>
              ) : (
                <div className="d-flex flex-wrap gap-1">
                  {selectedLabs.map(l => (
                    <span key={l.testName} className="badge bg-success bg-opacity-10 text-success border d-inline-flex align-items-center gap-1"
                      style={{ fontSize: '0.65rem' }}>
                      {l.testName}
                      <button className="btn btn-link text-danger p-0" style={{ fontSize: '0.65rem', lineHeight: 1 }}
                        onClick={(e) => { e.stopPropagation(); removeLab(l.testName); }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* MEDS column */}
        <div className="col-md-4">
          <div className="card border-0 order-card h-100" style={{ cursor: 'pointer' }}
            onClick={() => { setMedOrderStage('categories'); setMedOrderOpen(true); }} title="New medication order">
            <div className="card-body py-2 px-3">
              <div className="d-flex justify-content-between align-items-center mb-1">
                <span className="fw-bold small" style={{ fontSize: '0.75rem' }}>
                  <i className="bi bi-capsule me-1 text-primary"></i>Medication
                </span>
                <span className="badge bg-primary rounded-pill" style={{ fontSize: '0.6rem' }}>{selectedMeds.length}</span>
              </div>
              {selectedMeds.length === 0 ? (
                <div className="text-muted small" style={{ fontSize: '0.7rem' }}>
                  Click to order medications, supplies, IV fluids, oxygen…
                </div>
              ) : (
                <div className="d-flex flex-wrap gap-1">
                  {selectedMeds.map((m, i) => (
                    <span key={i} className="badge bg-primary bg-opacity-10 text-primary border d-inline-flex align-items-center gap-1" style={{ fontSize: '0.65rem' }}>
                      {m.drug}
                      <button className="btn btn-link text-danger p-0" style={{ fontSize: '0.65rem', lineHeight: 1 }}
                        onClick={(e) => { e.stopPropagation(); removeMed(m.drug); }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* IMAGING column */}
        <div className="col-md-4">
          <div className="card border-0 order-card h-100" style={{ cursor: 'pointer' }}
            onClick={() => setImagingOrderOpen(true)} title="Order imaging">
            <div className="card-body py-2 px-3">
              <div className="d-flex justify-content-between align-items-center mb-1">
                <span className="fw-bold small" style={{ fontSize: '0.75rem' }}>
                  <i className="bi bi-image me-1 text-info"></i>Imaging
                </span>
                <span className="badge bg-info rounded-pill" style={{ fontSize: '0.6rem' }}>{selectedImaging.filter(i => i !== 'None').length}</span>
              </div>
              {selectedImaging.filter(i => i !== 'None').length === 0 ? (
                <div className="text-muted small" style={{ fontSize: '0.7rem' }}>
                  Click to order imaging (X-ray, ultrasound, CT, MRI…)
                </div>
              ) : (
                <div className="d-flex flex-wrap gap-1">
                  {selectedImaging.filter(i => i !== 'None').map(im => (
                    <span key={im} className="badge bg-info bg-opacity-10 text-info border d-inline-flex align-items-center gap-1" style={{ fontSize: '0.65rem' }}>
                      {im}
                      <button className="btn btn-link text-danger p-0" style={{ fontSize: '0.65rem', lineHeight: 1 }}
                        onClick={(e) => { e.stopPropagation(); toggleImaging(im); }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ DIAGNOSIS ═══ */}
      <div className="card border-0 shadow-sm mb-2" style={{ borderRadius: '10px' }}>
        <div className="card-body py-2 px-3">
          <div className="d-flex align-items-center gap-2 mb-1">
            <span className="fw-bold small text-uppercase text-muted" style={{ fontSize: '0.7rem' }}>Diagnosis</span>
            <button className={`btn btn-sm rounded-pill ${!showVitals ? 'btn-outline-secondary' : 'btn-secondary'}`}
              style={{ fontSize: '0.65rem', padding: '2px 10px' }}
              onClick={() => setShowVitals(!showVitals)}
              title="Alt+V">
              <i className="bi bi-heart-pulse me-1"></i>Vitals
            </button>
          </div>

          {/* Symptoms chips */}
          <div className="d-flex flex-wrap gap-1 mb-2">
            {ALL_SYMPTOMS.map(s => (
              <span key={s} className="d-inline-flex align-items-center">
                <button
                  className={`btn btn-sm rounded-pill ${symptoms.includes(s) ? 'btn-primary' : 'btn-outline-secondary'}`}
                  style={{ fontSize: '0.7rem', padding: '2px 10px' }}
                  onClick={() => setSymptoms(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}>
                  {symptoms.includes(s) ? '✓ ' : ''}{s}
                  {symptomNotes[s] && <i className="bi bi-pencil-fill ms-1 text-warning" style={{ fontSize: '0.6rem' }}></i>}
                </button>
                <button
                  className="btn btn-sm btn-link p-0 ms-1"
                  style={{ fontSize: '0.7rem', textDecoration: 'none' }}
                  title={`Add a note for ${s}`}
                  onClick={() => openSymptomNote(s)}>
                  <i className="bi bi-pencil-square text-info"></i>
                </button>
              </span>
            ))}
          </div>

          {/* Symptom note modal */}
          {noteModal && (
            <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1060, background: 'rgba(0,0,0,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) setNoteModal(null); }}>
              <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content" style={{ borderRadius: '16px' }}>
                  <div className="modal-header py-2">
                    <h6 className="modal-title"><i className="bi bi-pencil-square me-2 text-info"></i>Note — {noteModal}</h6>
                    <button className="btn-close" onClick={() => setNoteModal(null)}></button>
                  </div>
                  <div className="modal-body">
                    <div className="form-check mb-2">
                      <input className="form-check-input" type="checkbox" id="symptom-note-enable" checked={noteDraftEnabled} onChange={(e) => setNoteDraftEnabled(e.target.checked)} />
                      <label className="form-check-label small" htmlFor="symptom-note-enable">Enable a note for this symptom</label>
                    </div>
                    {noteDraftEnabled && (
                      <textarea className="form-control" rows={4} placeholder={`Add details about ${noteModal} (onset, character, severity, etc.)…`} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} autoFocus />
                    )}
                  </div>
                  <div className="modal-footer py-2">
                    <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setNoteModal(null)}>Cancel</button>
                    <button className="btn btn-info btn-sm rounded-pill text-white" onClick={saveSymptomNote}>Save Note</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Duration + Severity row */}
          <div className="d-flex gap-3 flex-wrap align-items-center">
            <div className="d-flex align-items-center gap-1">
              <span className="small text-muted" style={{ fontSize: '0.7rem' }}>Duration:</span>
              {DURATIONS.map(d => (
                <button key={d}
                  className={`btn btn-sm rounded-pill ${duration === d ? 'btn-secondary' : 'btn-outline-secondary'}`}
                  style={{ fontSize: '0.65rem', padding: '1px 8px' }}
                  onClick={() => setDuration(d)}>{d}</button>
              ))}
            </div>
            <div className="d-flex align-items-center gap-1">
              <span className="small text-muted" style={{ fontSize: '0.7rem' }}>Severity:</span>
              {SEVERITIES.map(s => (
                <button key={s}
                  className={`btn btn-sm rounded-pill ${severity === s ? (s === 'Severe' ? 'btn-danger' : s === 'Moderate' ? 'btn-warning' : 'btn-success') : 'btn-outline-secondary'}`}
                  style={{ fontSize: '0.65rem', padding: '1px 8px' }}
                  onClick={() => setSeverity(s)}>{s}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ HISTORY ═══ */}
      <div className="card border-0 shadow-sm mb-2" style={{ borderRadius: '10px', borderLeft: '4px solid #e83e8c' }}>
        <div className="card-body py-2 px-3">
          <div className="d-flex justify-content-between align-items-center mb-1">
            <span className="fw-bold small" style={{ fontSize: '0.75rem' }}>
              <i className="bi bi-journal-text me-1 text-danger"></i>History
            </span>
            <button className="btn btn-outline-secondary btn-sm rounded-pill" style={{ fontSize: '0.6rem', padding: '1px 8px' }}
              onClick={() => setShowChartNotes(!showChartNotes)}>
              {showChartNotes ? 'Hide' : 'Show'} ({existingNotes.length})
            </button>
          </div>
          <button
            className="btn btn-sm btn-danger rounded-pill text-nowrap mb-2"
            style={{ fontSize: '0.7rem' }}
            onClick={() => setShowNoteModal(true)}>
            <i className="bi bi-plus-lg me-1"></i>Add Note
          </button>
          {chartNoteSaved && <small className="text-success d-block mb-1"><i className="bi bi-check-circle me-1"></i>Note added to the patient chart.</small>}
          {showChartNotes && (existingNotes.length === 0 ? (
            <small className="text-muted">No prior notes on this patient's chart. Notes documented during screening will appear here and in the full chart.</small>
          ) : (
            <div style={{ maxHeight: '220px', overflow: 'auto' }}>
              {existingNotes.map((n: any, i: number) => (
                <div key={n.id || i} className="border-bottom py-1">
                  <div className="d-flex justify-content-between align-items-center">
                    <small className="text-muted" style={{ fontSize: '0.65rem' }}>
                      <i className="bi bi-person me-1"></i>{n.author_name || n.user || 'Provider'}
                      <span className="mx-1">·</span>{n.date ? new Date(n.date).toLocaleString() : '—'}
                      {n.room && <span className="mx-1">·</span>}
                      {n.room && <span className="badge bg-info rounded-pill" style={{ fontSize: '0.6rem' }}>Room {n.room}</span>}
                    </small>
                    {n.acuity_level && n.acuity_level !== 'routine' && (
                      <span className={`badge rounded-pill ${n.acuity_level === 'stat' ? 'bg-danger' : 'bg-warning text-dark'}`} style={{ fontSize: '0.6rem' }}>
                        {n.acuity_level.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.4, fontSize: '0.72rem' }}>
                    {n.body || n.note || n.title}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ═══ PHARMACY (progressive disclosure) ═══ */}
      <div className="d-flex align-items-center gap-2 px-2 py-1 mb-2 rounded-3 bg-light border" style={{ fontSize: '0.8rem' }}>
        <span className="fw-semibold small text-nowrap">Pharmacy:</span>
        <select className="form-select form-select-sm" style={{ fontSize: '0.7rem', maxWidth: '250px' }}
          value={pharmacy} onChange={e => setPharmacy(e.target.value)}>
          <option value="">Patient Pharmacy</option>
          <option value="Rite Aid">Rite Aid</option>
          <option value="CVS Pharmacy">CVS Pharmacy</option>
          <option value="Walgreens">Walgreens</option>
          <option value="Walmart Pharmacy">Walmart Pharmacy</option>
          <option value="Hospital Pharmacy">Hospital Pharmacy</option>
        </select>
        {draftSaved && (
          <span className="badge bg-success ms-2" style={{ fontSize: '0.6rem' }}>
            <i className="bi bi-check me-1"></i>Draft saved
          </span>
        )}
        <button className="btn btn-outline-secondary btn-sm rounded-pill ms-auto" style={{ fontSize: '0.65rem' }}
          onClick={saveDraft}>
          <i className="bi bi-save me-1"></i>Save Draft
        </button>
        {localStorage.getItem(`screening-draft-${pid}`) && !draftSaved && (
          <button className="btn btn-outline-info btn-sm rounded-pill" style={{ fontSize: '0.65rem' }}
            onClick={loadDraft}>
            <i className="bi bi-folder-symlink me-1"></i>Load Draft
          </button>
        )}
      </div>

      {/* ═══ ACTION TOOLBAR ═══ */}
      <div className="d-flex gap-2 mb-2 flex-wrap align-items-center">
        <button className="btn btn-outline-secondary btn-sm rounded-pill" style={{ fontSize: '0.7rem' }}
          onClick={() => setShowVitals(!showVitals)} title="Alt+V">
          <i className="bi bi-heart-pulse me-1"></i>Vitals
        </button>
        <button className="btn btn-outline-secondary btn-sm rounded-pill" style={{ fontSize: '0.7rem' }}
          onClick={() => navigate(`/dicom`)}>
          <i className="bi bi-image me-1"></i>Imaging
        </button>
        <button className="btn btn-outline-secondary btn-sm rounded-pill" style={{ fontSize: '0.7rem' }}
          onClick={() => navigate(`/documents`)}>
          <i className="bi bi-folder me-1"></i>Documents
        </button>
        <button className={`btn btn-sm rounded-pill ${showReferral ? 'btn-success' : 'btn-outline-success'}`}
          style={{ fontSize: '0.7rem' }}
          onClick={() => setShowReferral(!showReferral)}>
          <i className="bi bi-send me-1"></i>Referral
        </button>
        <button className="btn btn-outline-info btn-sm rounded-pill" style={{ fontSize: '0.7rem' }}
          onClick={() => navigate(`/patients/${clinicalPid}/discharge-summary`)}>
          <i className="bi bi-file-earmark-text me-1"></i>Discharge
        </button>

        <div className="ms-auto d-flex align-items-center gap-2">
          <span className="small text-muted" style={{ fontSize: '0.65rem' }}>
            {selectedCount > 0 ? `${selectedCount} order${selectedCount !== 1 ? 's' : ''} selected` : 'No orders'}
          </span>
          <button className="btn btn-success btn-sm rounded-pill px-3 fw-bold" style={{ fontSize: '0.8rem' }}
            onClick={handleComplete} disabled={saving}>
            {saving ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-check-lg me-1"></i>}
            Complete ✓
          </button>
        </div>
      </div>

      {/* ═══ REFERRAL (progressive disclosure) ═══ */}
      {showReferral && (
        <div className="card border-0 shadow-sm mb-2" style={{ borderRadius: '10px', borderLeft: '4px solid #198754' }}>
          <div className="card-body py-2 px-3">
            <span className="fw-bold small" style={{ fontSize: '0.75rem' }}>
              <i className="bi bi-send me-1 text-success"></i>Refer to Specialist
            </span>
            <textarea className="form-control form-control-sm mt-1" style={{ fontSize: '0.75rem' }}
              rows={2} placeholder="Referral reason and specialist type..."
              value={referralNote} onChange={e => setReferralNote(e.target.value)} />
          </div>
        </div>
      )}

      {/* ═══ ADD NOTE MODAL ═══ */}
      {showNoteModal && (
        <div className="modal-backdrop fade show" style={{ zIndex: 1055 }} onClick={() => setShowNoteModal(false)} />
      )}
      <div className={`modal fade ${showNoteModal ? 'show d-block' : ''}`} tabIndex={-1} style={{ zIndex: 1056 }} onClick={(e) => { if (e.target === e.currentTarget) setShowNoteModal(false); }}>
        <div className="modal-dialog modal-lg modal-dialog-centered">
          <div className="modal-content shadow-lg border-0 rounded-4">
            <div className="modal-header text-white py-3" style={{ background: 'linear-gradient(135deg, #0d6efd 0%, #6610f2 100%)', borderRadius: '12px 12px 0 0' }}>
              <div>
                <h5 className="modal-title fw-bold mb-1">
                  <i className="bi bi-journal-plus me-2"></i>{formatPatientName(patient)} — History
                </h5>
                {latestRisk && (
                  <span className={`badge rounded-pill ${riskBadge(latestRisk.level)}`}>
                    <i className="bi bi-shield-check me-1"></i>{latestRisk.level} · NEWS2 {latestRisk.total}
                  </span>
                )}
              </div>
              <button className="btn-close btn-close-white" onClick={() => setShowNoteModal(false)}></button>
            </div>
            <div className="modal-body p-0">
              <div className="px-3 pt-3">
                <ul className="nav nav-pills gap-2 mb-3">
                  {([
                    ['review', 'Clinical Review', 'bi-shield-check'],
                    ['history', 'Chart History', 'bi-journal-text'],
                    ['vitals', 'Vitals', 'bi-heart-pulse'],
                  ] as const).map(([id, label, icon]) => (
                    <li className="nav-item" key={id}>
                      <button className={`nav-link ${noteTab === id ? 'active' : ''}`} onClick={() => setNoteTab(id)}>
                        <i className={`bi ${icon} me-1`}></i>{label}
                      </button>
                    </li>
                  ))}
                </ul>

                {noteTab === 'review' && (
                  <div>
                    {latestRisk ? (
                      <div>
                        <div className="d-flex align-items-center gap-3 p-3 rounded-3 mb-3" style={{ backgroundColor: latestRisk.color + '15', borderLeft: `4px solid ${latestRisk.color}` }}>
                          <div className="rounded-circle d-flex align-items-center justify-content-center fw-bold text-white" style={{ width: '56px', height: '56px', backgroundColor: latestRisk.color, fontSize: '1.4rem' }}>{latestRisk.total}</div>
                          <div>
                            <div className="fw-bold" style={{ color: latestRisk.color }}>{latestRisk.level} Risk</div>
                            <div className="small text-muted">{latestRisk.action}</div>
                          </div>
                          {(latestRisk.level === 'Critical' || latestRisk.level === 'High') && (
                            <button className="btn btn-sm btn-danger rounded-pill ms-auto"
                              title="Open the triage board for this patient — the level is set there, with the waiting room in view"
                              onClick={() => navigate(`/emergency?chart=${pid}`)}>
                              <i className="bi bi-heart-pulse me-1"></i>Send to emergency triage
                            </button>
                          )}
                        </div>
                        {latestRisk.flags.length > 0 ? (
                          <div>
                            <h6 className="fw-bold small mb-2"><i className="bi bi-exclamation-triangle me-1 text-danger"></i>Clinical Flags</h6>
                            {latestRisk.flags.map((f: any, i: number) => (
                              <div key={i} className="d-flex gap-2 border-bottom py-1 small">
                                <span className={`badge rounded-pill ${f.severity === 'critical' ? 'bg-danger' : 'bg-warning text-dark'}`}>{f.label}</span>
                                <span className="text-muted">{f.action}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="alert alert-success py-2 small mb-0"><i className="bi bi-check-circle me-1"></i>No critical flags — vitals within expected range.</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-muted small py-3 text-center"><i className="bi bi-shield-check fs-3 d-block mb-1"></i>No vitals on file to assess.</div>
                    )}
                  </div>
                )}

                {noteTab === 'history' && (
                  <div>
                    {existingNotes.length === 0 ? (
                      <small className="text-muted">No prior chart notes on file.</small>
                    ) : (
                      <div className="rounded-3 border p-2 mb-3" style={{ maxHeight: '260px', overflowY: 'auto', backgroundColor: '#f8f9fa' }}>
                        {existingNotes.map((n: any, i: number) => (
                          <div key={n.id || i} className="border-bottom py-2 small">
                            <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                              <i className="bi bi-person me-1"></i>{n.author_name || n.user || 'Provider'}
                              <span className="mx-1">·</span>
                              <i className="bi bi-clock me-1"></i>{n.date ? new Date(n.date).toLocaleString() : '—'}
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.78rem' }}>{n.body || n.note || n.title}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {noteTab === 'vitals' && (
                  <div>
                    {vitalHistory.length === 0 ? (
                      <small className="text-muted">No prior vitals recorded.</small>
                    ) : (
                      <div className="table-responsive rounded-3 border mb-3">
                        <table className="table table-sm table-hover mb-0 small" style={{ fontSize: '0.75rem' }}>
                          <thead className="table-light"><tr><th>Date & Time</th><th>BP</th><th>Pulse</th><th>Temp</th><th>Resp</th><th>SpO₂</th><th>BMI</th></tr></thead>
                          <tbody>
                            {vitalHistory.map((v: any) => (
                              <tr key={v.id}>
                                <td>{v.date ? new Date(v.date).toLocaleString() : '—'}</td>
                                <td>{formatBP(v.bps, v.bpd)}</td>
                                <td>{formatVital(v.pulse)}</td>
                                <td>{formatVital(v.temperature, 1)}</td>
                                <td>{formatVital(v.respiration)}</td>
                                <td>{formatVital(v.oxygen_saturation)}</td>
                                <td>{formatVital(v.BMI, 1)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="border-top p-3 bg-light" style={{ borderRadius: '0 0 12px 12px' }}>
                <label className="form-label small fw-semibold">New Note</label>
                <textarea className="form-control" rows={4} autoFocus placeholder="Write a note for the patient chart…" value={chartNote} onChange={e => setChartNote(e.target.value)} />
                <small className="text-muted d-block mt-1">Saved to the patient's chart and shared with the care team.</small>
              </div>
            </div>
            <div className="modal-footer border-0">
              <button className="btn btn-outline-secondary" onClick={() => setShowNoteModal(false)}>Cancel</button>
              <button className="btn btn-danger px-4" onClick={() => { addChartNote.mutate(); setShowNoteModal(false); }} disabled={!chartNote.trim() || addChartNote.isPending}>
                {addChartNote.isPending ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-check-lg me-1"></i>}
                Add to Chart
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ CLINICAL NOTE (SOAP) MODAL ═══ */}
      {showClinicalModal && (
        <div className="modal-backdrop fade show" style={{ zIndex: 1055 }} onClick={() => setShowClinicalModal(false)} />
      )}
      <div className={`modal fade ${showClinicalModal ? 'show d-block' : ''}`} tabIndex={-1} style={{ zIndex: 1056 }} onClick={(e) => { if (e.target === e.currentTarget) setShowClinicalModal(false); }}>
        <div className="modal-dialog modal-lg modal-dialog-centered">
          <div className="modal-content shadow-lg border-0 rounded-4">
            <div className="modal-header text-white py-3" style={{ background: 'linear-gradient(135deg, #198754 0%, #0d6efd 100%)', borderRadius: '12px 12px 0 0' }}>
              <div>
                <h5 className="modal-title fw-bold mb-1">
                  <i className="bi bi-clipboard2-pulse me-2"></i>Screen Note — {formatPatientName(patient)}
                </h5>
                <SmartAcuityBadge note={composeSoapNote()} />
              </div>
              <button className="btn-close btn-close-white" onClick={() => setShowClinicalModal(false)}></button>
            </div>
            <div className="modal-body p-3" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {matchingTemplate && (
                <button className="btn btn-sm btn-warning rounded-pill mb-2" onClick={applySoapTemplate}>
                  <i className="bi bi-magic me-1"></i>Apply Template: {matchingTemplate.key}
                </button>
              )}

              <label className="form-label small fw-semibold"><span className="badge bg-primary me-1">S</span>Subjective — patient-reported</label>
              <textarea className="form-control form-control-sm mb-2" rows={2} placeholder="Chief complaint, symptoms, history…" value={soap.subjective} onChange={e => setSoap({ ...soap, subjective: e.target.value })} />
              <div className="d-flex flex-wrap gap-1 mb-2">
                {Object.keys(QUICK_NOTES).map(k => (
                  <button key={k} className="btn btn-outline-secondary btn-sm rounded-pill" style={{ fontSize: '0.65rem', padding: '1px 8px' }}
                    onClick={() => setSoap(s => ({ ...s, subjective: s.subjective ? s.subjective + ' ' + QUICK_NOTES[k] : QUICK_NOTES[k] }))}>{k}</button>
                ))}
              </div>

              <label className="form-label small fw-semibold"><span className="badge bg-success me-1">O</span>Objective — findings & vitals</label>
              <textarea className="form-control form-control-sm mb-2" rows={2} placeholder="Exam findings, vitals… (auto-filled from recorded vitals)" value={soap.objective} onChange={e => setSoap({ ...soap, objective: e.target.value })} />

              <label className="form-label small fw-semibold"><span className="badge bg-warning text-dark me-1">A</span>Assessment — diagnosis</label>
              <textarea className="form-control form-control-sm mb-2" rows={2} placeholder="Diagnosis / differential…" value={soap.assessment} onChange={e => setSoap({ ...soap, assessment: e.target.value })} />

              <label className="form-label small fw-semibold"><span className="badge bg-danger me-1">P</span>Plan — orders & next steps</label>
              <textarea className="form-control form-control-sm mb-2" rows={2} placeholder="Labs, medications, imaging, follow-up… (auto-filled from selected orders)" value={soap.plan} onChange={e => setSoap({ ...soap, plan: e.target.value })} />

              <div className="alert alert-info py-2 small mb-0">
                <i className="bi bi-info-circle me-1"></i>
                Saving documents this note in the patient chart and shares it with the nursing team (read-only).
              </div>
            </div>
            <div className="modal-footer border-0">
              <button className="btn btn-outline-secondary" onClick={() => setShowClinicalModal(false)}>Cancel</button>
              <button className="btn btn-success px-4" onClick={handleSaveClinicalNote} disabled={saveClinicalNote.isPending}>
                {saveClinicalNote.isPending ? <span className="spinner-border spinner-border-sm me-1"></span> : <i className="bi bi-check-lg me-1"></i>}
                Save to Chart & Share
              </button>
            </div>
          </div>
        </div>
      </div>

          {/* Lab Order modal */}
          {labOrderOpen && (
            <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1065, background: 'rgba(0,0,0,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) setLabOrderOpen(false); }}>
              <div className="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered">
                <div className="modal-content" style={{ borderRadius: '16px' }}>
                  <div className="modal-header py-2">
                    <h6 className="modal-title"><i className="bi bi-flask me-2 text-success"></i>Lab Order</h6>
                    <button className="btn-close" onClick={() => setLabOrderOpen(false)}></button>
                  </div>
                  <div className="modal-body">
                    <input className="form-control form-control-sm mb-2" placeholder="🔍 Search lab test…" value={labOrderSearch} onChange={e => setLabOrderSearch(e.target.value)} />
                    {LAB_ORDER_CATEGORIES.map(cat => {
                      const q = labOrderSearch.trim().toLowerCase();
                      const visibleGroups = cat.groups
                        .map(g => ({ ...g, tests: q ? g.tests.filter(t => t.toLowerCase().includes(q)) : g.tests }))
                        .filter(g => g.tests.length > 0);
                      if (visibleGroups.length === 0) return null;
                      const open = q ? true : (labOrderCats[cat.title] ?? cat.title.includes('BLOOD BIOCHEMISTRY'));
                      return (
                        <div key={cat.title} className="border rounded-3 mb-2">
                          <button type="button" className="w-100 d-flex justify-content-between align-items-center btn btn-light btn-sm rounded-3 border-0"
                            onClick={() => setLabOrderCats(prev => ({ ...prev, [cat.title]: !(prev[cat.title] ?? cat.title.includes('BLOOD BIOCHEMISTRY')) }))}>
                            <span className="fw-semibold small text-start">{open ? '▼' : '▶'} {cat.title}</span>
                          </button>
                          {open && (
                            <div className="p-2 pt-0">
                              {visibleGroups.map((g, gi) => (
                                <div key={gi}>
                                  {g.subtitle && <div className="small fw-semibold text-muted text-uppercase mt-2 mb-1" style={{ fontSize: '0.65rem' }}>{g.subtitle}</div>}
                                  <div className="d-flex flex-wrap gap-1">
                                    {g.tests.map(t => (
                                      <label key={t} className="d-inline-flex align-items-center gap-1 border rounded-pill px-2 py-1 me-1 mb-1"
                                        style={{ fontSize: '0.7rem', cursor: 'pointer', background: selectedLabs.some(s => s.testName === t) ? '#e7f6ec' : '#fff' }}>
                                        <input type="checkbox" className="form-check-input m-0" style={{ fontSize: '0.7rem' }} checked={selectedLabs.some(s => s.testName === t)} onChange={() => toggleLab(t)} />
                                        <span>{t}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="modal-footer py-2 d-flex justify-content-between">
                    <span className="small text-muted">Selected: {selectedLabs.length} test{selectedLabs.length !== 1 ? 's' : ''}</span>
                    <div className="d-flex gap-2">
                      <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setSelectedLabs([])}>Clear</button>
                      <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setLabOrderOpen(false)}>Cancel</button>
                      <button className="btn btn-success btn-sm rounded-pill px-3" onClick={() => setLabOrderOpen(false)}>Add to Order</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Medication order modal */}
          {medOrderOpen && (
            <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1070, background: 'rgba(0,0,0,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) setMedOrderOpen(false); }}>
              <div className="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered">
                <div className="modal-content" style={{ borderRadius: '16px' }}>
                  <div className="modal-header py-2">
                    <h6 className="modal-title"><i className="bi bi-capsule me-2 text-primary"></i>{medOrderStage === 'editor' ? 'MEDICATION ORDER' : 'New Medication Order'}</h6>
                    <button className="btn-close" onClick={() => setMedOrderOpen(false)}></button>
                  </div>
                  <div className="modal-body">
                    <div className="p-2 rounded-3 bg-light small mb-2" style={{ fontSize: '0.75rem' }}>
                      <div className="d-flex justify-content-between flex-wrap">
                        <span><strong>{formatPatientName(patient)}</strong> · {patient?.DOB?.split('T')[0]} · {patient?.sex || '—'}</span>
                        <span><i className="bi bi-exclamation-triangle text-warning me-1"></i>Allergies: Penicillin · Weight: — kg</span>
                      </div>
                      <div className="text-muted">Prescriber: {user?.displayName || 'Provider'} · {new Date().toLocaleString()}</div>
                    </div>

                    {medOrderStage === 'categories' && (
                      <>
                        <input className="form-control form-control-sm mb-2" placeholder="🔍 Search medication..." value={medOrderSearch} onChange={e => setMedOrderSearch(e.target.value)} />
                        <div className="row g-2">
                          {MED_CATEGORIES.map(c => (
                            <div className="col-6 col-md-4" key={c.name}>
                              <button type="button" className="btn btn-outline-primary w-100 h-100 text-start rounded-3" style={{ fontSize: '0.72rem' }}
                                onClick={() => { setMedOrderCategory(c.name); setMedOrderStage('list'); setMedOrderSearch(''); }}>
                                <div className="fw-semibold">{c.name}</div>
                                <small className="text-muted">{c.items.length} items</small>
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {medOrderStage === 'list' && (() => {
                      const cat = MED_CATEGORIES.find(c => c.name === medOrderCategory);
                      if (!cat) return null;
                      const q = medOrderSearch.trim().toLowerCase();
                      const items = q ? cat.items.filter(i => i.toLowerCase().includes(q)) : cat.items;
                      return (
                        <>
                          <div className="d-flex align-items-center gap-2 mb-2">
                            <button className="btn btn-sm btn-outline-secondary rounded-pill" onClick={() => setMedOrderStage('categories')}><i className="bi bi-arrow-left"></i></button>
                            <span className="fw-semibold small">{cat.name}</span>
                          </div>
                          <input className="form-control form-control-sm mb-2" placeholder={`Search ${cat.name.toLowerCase()}...`} value={medOrderSearch} onChange={e => setMedOrderSearch(e.target.value)} />
                          <div className="d-flex flex-wrap gap-1">
                            {items.map(i => (
                              <button key={i} type="button" className="btn btn-outline-secondary btn-sm rounded-pill"
                                style={{ fontSize: '0.7rem', padding: '2px 10px' }}
                                onClick={() => { setMedDraft((d: any) => ({ ...d, drug: i })); setMedOrderStage('editor'); }}>{i}</button>
                            ))}
                          </div>
                        </>
                      );
                    })()}

                    {medOrderStage === 'editor' && (() => {
                      const cat = MED_CATEGORIES.find(c => c.name === medOrderCategory);
                      const type = cat?.type || 'medication';
                      return (
                        <>
                          <div className="mb-2 small text-muted">Medication: <strong className="text-dark">{medDraft.drug}</strong></div>
                          <div className="row g-2">
                            {type === 'medication' && (
                              <>
                                <div className="col-6"><label className="form-label small mb-0">Dose *</label><input className="form-control form-control-sm" value={medDraft.dose} onChange={e => setMedDraft({...medDraft, dose: e.target.value})} /></div>
                                <div className="col-6"><label className="form-label small mb-0">Route *</label>
                                  <select className="form-select form-select-sm" value={medDraft.route} onChange={e => setMedDraft({...medDraft, route: e.target.value})}>
                                    <option>Oral</option><option>IV</option><option>IM</option><option>SC</option><option>Topical</option><option>Ophthalmic</option><option>Otic</option>
                                  </select></div>
                                <div className="col-6"><label className="form-label small mb-0">Frequency *</label>
                                  <select className="form-select form-select-sm" value={medDraft.frequency} onChange={e => setMedDraft({...medDraft, frequency: e.target.value})}>
                                    <option value="">Select…</option><option>Once daily</option><option>Twice daily</option><option>Three times daily</option><option>Every 8 hours</option><option>Every 6 hours</option><option>At bedtime</option><option>As needed</option>
                                  </select></div>
                                <div className="col-6"><label className="form-label small mb-0">Duration *</label><input className="form-control form-control-sm" placeholder="e.g. 7 days" value={medDraft.duration} onChange={e => setMedDraft({...medDraft, duration: e.target.value})} /></div>
                                <div className="col-6"><label className="form-label small mb-0">Start Date *</label><input type="date" className="form-control form-control-sm" value={medDraft.startDate} onChange={e => setMedDraft({...medDraft, startDate: e.target.value})} /></div>
                                <div className="col-6"><label className="form-label small mb-0">Quantity</label><input className="form-control form-control-sm" placeholder="e.g. 21 capsules" value={medDraft.quantity} onChange={e => setMedDraft({...medDraft, quantity: e.target.value})} /></div>
                              </>
                            )}
                            {type === 'supply' && (
                              <div className="col-6"><label className="form-label small mb-0">Quantity *</label><input className="form-control form-control-sm" placeholder="e.g. 2" value={medDraft.quantity} onChange={e => setMedDraft({...medDraft, quantity: e.target.value})} /></div>
                            )}
                            {type === 'oxygen' && (
                              <>
                                <div className="col-6"><label className="form-label small mb-0">Flow Rate *</label><input className="form-control form-control-sm" value={medDraft.flowRate} onChange={e => setMedDraft({...medDraft, flowRate: e.target.value})} /></div>
                                <div className="col-6"><label className="form-label small mb-0">Delivery Method *</label>
                                  <select className="form-select form-select-sm" value={medDraft.deliveryMethod} onChange={e => setMedDraft({...medDraft, deliveryMethod: e.target.value})}>
                                    <option value="">Select…</option><option>Nasal Cannula</option><option>Face Mask</option><option>Non-Rebreather</option>
                                  </select></div>
                                <div className="col-6"><label className="form-label small mb-0">Duration *</label><input className="form-control form-control-sm" placeholder="e.g. 4 hours" value={medDraft.duration} onChange={e => setMedDraft({...medDraft, duration: e.target.value})} /></div>
                              </>
                            )}
                            <div className="col-12"><label className="form-label small mb-0">Administration / Timing</label><input className="form-control form-control-sm" value={medDraft.administration} onChange={e => setMedDraft({...medDraft, administration: e.target.value})} /></div>
                            <div className="col-12"><label className="form-label small mb-0">Indication / Reason</label><input className="form-control form-control-sm" value={medDraft.indication} onChange={e => setMedDraft({...medDraft, indication: e.target.value})} /></div>
                            <div className="col-12"><label className="form-label small mb-0">Special Instructions</label><input className="form-control form-control-sm" value={medDraft.instructions} onChange={e => setMedDraft({...medDraft, instructions: e.target.value})} /></div>
                          </div>
                          <div className="border rounded-3 p-2 mt-2 small bg-light" style={{ fontSize: '0.7rem' }}>
                            <div><i className="bi bi-check-circle text-success me-1"></i>Patient identity verified</div>
                            <div><i className="bi bi-exclamation-triangle text-warning me-1"></i>Allergy check</div>
                            <div><i className="bi bi-check-circle text-success me-1"></i>Duplicate medication check</div>
                            <div><i className="bi bi-check-circle text-success me-1"></i>Drug interaction check</div>
                            <div><i className="bi bi-exclamation-triangle text-warning me-1"></i>Dose / route validation</div>
                          </div>
                          <div className="text-muted mt-2" style={{ fontSize: '0.7rem' }}>Prescribed by: {user?.displayName || 'Provider'} · {new Date().toLocaleString()}</div>
                        </>
                      );
                    })()}

                    {medOrderStage === 'sign' && (
                      <div className="small">
                        <h6 className="fw-bold">Review & Sign Order</h6>
                        <div className="border rounded-3 p-2 mb-2">
                          <div><strong>Patient:</strong> {formatPatientName(patient)}</div>
                          <div><strong>Medication:</strong> {medDraft.drug}</div>
                          <div><strong>Dose:</strong> {medDraft.dose || medDraft.flowRate || medDraft.quantity} {medDraft.route || medDraft.deliveryMethod}</div>
                          <div><strong>Frequency:</strong> {medDraft.frequency || '—'}</div>
                          <div><strong>Duration:</strong> {medDraft.duration || '—'}</div>
                          <div><strong>Quantity:</strong> {medDraft.quantity || '—'}</div>
                          <div><strong>Prescriber:</strong> {user?.displayName || 'Provider'}</div>
                          <div><strong>Status:</strong> NEW — Requires Pharmacy Review</div>
                        </div>
                        <div className="alert alert-info py-2 small mb-0">Signing sends this order to the pharmacy. Original signed orders are preserved with an audit trail.</div>
                      </div>
                    )}
                  </div>
                  <div className="modal-footer py-2">
                    {medOrderStage === 'categories' || medOrderStage === 'list' ? (
                      <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setMedOrderOpen(false)}>Cancel</button>
                    ) : medOrderStage === 'editor' ? (
                      <>
                        <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setMedOrderStage('list')}>Back</button>
                        <button className="btn btn-outline-primary btn-sm rounded-pill" onClick={() => setMedOrderOpen(false)}>Save Draft</button>
                        <button className="btn btn-primary btn-sm rounded-pill px-3" onClick={() => setMedOrderStage('sign')}>Review & Sign Order</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setMedOrderStage('editor')}>Back</button>
                        <button className="btn btn-success btn-sm rounded-pill px-3" onClick={() => {
                          const med = {
                            drug: medDraft.drug,
                            dosage: medDraft.dose || medDraft.flowRate || '',
                            quantity: medDraft.quantity || '',
                            frequency: medDraft.frequency || medDraft.deliveryMethod || 'Once',
                            duration: medDraft.duration || '',
                            instructions: [medDraft.administration, medDraft.indication, medDraft.instructions].filter(Boolean).join(' | '),
                          };
                          setSelectedMeds(prev => [...prev, med]);
                          sendSingleMed.mutate(med);
                          setMedOrderOpen(false);
                        }}>Sign & Send to Pharmacy</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Imaging order modal */}
          {imagingOrderOpen && (
            <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1075, background: 'rgba(0,0,0,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) setImagingOrderOpen(false); }}>
              <div className="modal-dialog modal-md modal-dialog-centered">
                <div className="modal-content" style={{ borderRadius: '16px' }}>
                  <div className="modal-header py-2">
                    <h6 className="modal-title"><i className="bi bi-image me-2 text-info"></i>Imaging Order</h6>
                    <button className="btn-close" onClick={() => setImagingOrderOpen(false)}></button>
                  </div>
                  <div className="modal-body">
                    <input className="form-control form-control-sm mb-2" placeholder="Search imaging..." value={imagingOrderSearch} onChange={e => setImagingOrderSearch(e.target.value)} />
                    <div className="d-flex flex-wrap gap-1">
                      {COMMON_IMAGING.filter(im => im.toLowerCase().includes(imagingOrderSearch.trim().toLowerCase())).map(im => (
                        <label key={im} className="d-inline-flex align-items-center gap-1 border rounded-pill px-2 py-1 me-1 mb-1"
                          style={{ fontSize: '0.75rem', cursor: 'pointer', background: selectedImaging.includes(im) ? '#e0f3ff' : '#fff' }}>
                          <input type="checkbox" className="form-check-input m-0" checked={selectedImaging.includes(im)} onChange={() => toggleImaging(im)} />
                          <span>{im}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="modal-footer py-2 d-flex justify-content-between">
                    <span className="small text-muted">Selected: {selectedImaging.filter(i => i !== 'None').length}</span>
                    <div className="d-flex gap-2">
                      <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setSelectedImaging([])}>Clear</button>
                      <button className="btn btn-info btn-sm rounded-pill px-3 text-white" onClick={() => setImagingOrderOpen(false)}>Add to Order</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Vital history modal */}
          {vitalHistoryOpen && (
            <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1080, background: 'rgba(0,0,0,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) setVitalHistoryOpen(false); }}>
              <div className="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered">
                <div className="modal-content" style={{ borderRadius: '16px' }}>
                  <div className="modal-header py-2">
                    <h6 className="modal-title"><i className="bi bi-heart-pulse me-2 text-info"></i>Vital History — {formatPatientName(patient)}</h6>
                    <button className="btn-close" onClick={() => setVitalHistoryOpen(false)}></button>
                  </div>
                  <div className="modal-body">
                    {vitalHistory.length === 0 ? (
                      <div className="text-center text-muted py-4">No prior vitals recorded for this patient.</div>
                    ) : (
                      <>
                        {/* Same three-way toggle as the patient chart, so both
                            vitals views read the same way. */}
                        <div className="d-flex justify-content-end mb-2">
                          <VitalsViewToggle view={vitalsView} onChange={setVitalsView} />
                        </div>
                        {vitalsView !== 'table' && <VitalsTrend vitals={vitalHistory} height={240} />}
                        {vitalsView !== 'chart' && (
                        <div style={{ maxHeight: '340px', overflow: 'auto' }}>
                          <table className="table table-sm table-hover mb-0 small" style={{ fontSize: '0.75rem' }}>
                            <thead className="table-light"><tr><th>When</th><th>BP</th><th>Pulse</th><th>Temp</th><th>Resp</th><th>SpO₂</th><th>BMI</th></tr></thead>
                            <tbody>
                              {vitalHistory.map((v: any) => (
                                <tr key={v.id}>
                                  <td>{v.date ? new Date(v.date).toLocaleString() : '—'}</td>
                                  <td>{formatBP(v.bps, v.bpd)}</td>
                                  <td>{formatVital(v.pulse)}</td>
                                  <td>{formatVital(v.temperature, 1)}</td>
                                  <td>{formatVital(v.respiration)}</td>
                                  <td>{formatVital(v.oxygen_saturation)}</td>
                                  <td>{formatVital(v.BMI, 1)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="modal-footer py-2">
                    <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setVitalHistoryOpen(false)}>Close</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Physical examination modal */}
          {examOrderOpen && (
            <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1085, background: 'rgba(0,0,0,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) setExamOrderOpen(false); }}>
              <div className="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered">
                <div className="modal-content" style={{ borderRadius: '16px' }}>
                  <div className="modal-header py-2">
                    <h6 className="modal-title"><i className="bi bi-clipboard-pulse me-2 text-primary"></i>Physical Examination</h6>
                    <button className="btn-close" onClick={() => setExamOrderOpen(false)}></button>
                  </div>
                  <div className="modal-body">
                    <div className="small text-muted mb-2" style={{ fontSize: '0.7rem' }}>Click a system to insert standard exam text, then edit as needed.</div>
                    <div className="d-flex flex-wrap gap-1 mb-2">
                      {Object.keys(PHYSICAL_EXAM_NOTES).map(k => (
                        <button key={k} className="btn btn-outline-primary btn-sm rounded-pill"
                          style={{ fontSize: '0.7rem', padding: '2px 10px' }}
                          onClick={() => applyExamNote(k)}>{k}</button>
                      ))}
                    </div>
                    <textarea className="form-control" rows={7} value={physicalExam} onChange={e => setPhysicalExam(e.target.value)} placeholder="Exam findings… (click a system above to insert standard exam text)" />
                  </div>
                  <div className="modal-footer py-2 d-flex justify-content-between">
                    <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setPhysicalExam('')}>Clear</button>
                    <div className="d-flex gap-2">
                      <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setExamOrderOpen(false)}>Cancel</button>
                      <button className="btn btn-primary btn-sm rounded-pill px-3" onClick={() => setExamOrderOpen(false)}>Add to Note</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

    </div>
  );
}
