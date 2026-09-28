import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../../api/nest-client';
import { readOnlyNote } from '../../../utils/clinicalPermissions';

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'date' | 'datetime' | 'textarea';
  options?: string[];
  unit?: string;
  required?: boolean;
  placeholder?: string;
}

interface FormTemplate {
  id: string;
  label: string;
  icon: string;
  category: string;
  fields: FieldDef[];
}

const FORM_TEMPLATES: FormTemplate[] = [
  {
    id: 'vitals_advanced', label: 'Advanced Vitals', icon: 'bi-heart-pulse', category: 'Routine',
    fields: [
      { key: 'bp_systolic', label: 'Systolic BP', type: 'number', unit: 'mmHg', placeholder: '120' },
      { key: 'bp_diastolic', label: 'Diastolic BP', type: 'number', unit: 'mmHg', placeholder: '80' },
      { key: 'pulse', label: 'Pulse Rate', type: 'number', unit: 'bpm', placeholder: '72' },
      { key: 'temperature', label: 'Temperature', type: 'number', unit: '°F', placeholder: '98.6' },
      { key: 'respiration', label: 'Respiration', type: 'number', unit: '/min', placeholder: '16' },
      { key: 'oxygen_saturation', label: 'O₂ Saturation', type: 'number', unit: '%', placeholder: '98' },
      { key: 'weight', label: 'Weight', type: 'number', unit: 'kg', placeholder: '70' },
      { key: 'height', label: 'Height', type: 'number', unit: 'cm', placeholder: '170' },
      { key: 'bmi', label: 'BMI', type: 'number', unit: 'kg/m²', placeholder: 'Auto' },
      { key: 'blood_glucose', label: 'Blood Glucose', type: 'number', unit: 'mg/dL', placeholder: '100' },
      { key: 'pain_level', label: 'Pain Level (0-10)', type: 'select', options: ['0','1','2','3','4','5','6','7','8','9','10'] },
    ],
  },
  {
    id: 'general_exam', label: 'General Examination', icon: 'bi-clipboard2-pulse', category: 'Routine',
    fields: [
      { key: 'general_appearance', label: 'General Appearance', type: 'select', options: ['Well-nourished','Ill-appearing','Cachectic','Obese'] },
      { key: 'consciousness', label: 'Level of Consciousness', type: 'select', options: ['Alert','Drowsy','Stuporous','Comatose'] },
      { key: 'orientation', label: 'Orientation', type: 'select', options: ['Oriented x3','Oriented x2','Oriented x1','Disoriented'] },
      { key: 'skin', label: 'Skin', type: 'select', options: ['Normal','Pale','Jaundiced','Cyanotic','Rash','Dry'] },
      { key: 'eyes', label: 'Eyes/Pupils', type: 'select', options: ['Normal','Anemic','Jaundiced','PERL','Sluggish'] },
      { key: 'ent', label: 'ENT Examination', type: 'select', options: ['Normal','Abnormal'] },
      { key: 'neck', label: 'Neck', type: 'select', options: ['Supple','Stiff','Lymphadenopathy','JVD'] },
      { key: 'chest', label: 'Chest/Lungs', type: 'select', options: ['Clear','Wheezes','Crackles','Diminished','Ronchi'] },
      { key: 'heart', label: 'Heart', type: 'select', options: ['RRR no murmur','Tachycardia','Murmur','Irregular'] },
      { key: 'abdomen', label: 'Abdomen', type: 'select', options: ['Soft non-tender','Tender','Distended','Rigid','Hepatomegaly'] },
      { key: 'extremities', label: 'Extremities', type: 'select', options: ['Normal','Edema','Clubbing','Cyanosis','Deformity'] },
      { key: 'neurological', label: 'Neurological', type: 'select', options: ['Intact','Focal deficit','Weakness','Numbness'] },
    ],
  },
  {
    id: 'emergency', label: 'Emergency Assessment', icon: 'bi-exclamation-triangle', category: 'Emergency',
    fields: [
      { key: 'triage_category', label: 'Triage Category', type: 'select', options: ['Resuscitation','Emergency','Urgent','Semi-urgent','Non-urgent'] },
      { key: 'airway', label: 'Airway', type: 'select', options: ['Patent','Obstructed','Assisted'] },
      { key: 'breathing', label: 'Breathing', type: 'select', options: ['Normal','Tachypnea','Bradypnea','Labored','Apnea'] },
      { key: 'circulation', label: 'Circulation', type: 'select', options: ['Normal','Tachycardia','Bradycardia','Shock','Cardiac Arrest'] },
      { key: 'disability', label: 'Disability (AVPU)', type: 'select', options: ['Alert','Verbal','Pain','Unresponsive'] },
      { key: 'exposure', label: 'Exposure Findings', type: 'textarea', placeholder: 'Trauma, burns, rashes, bleeding...' },
      { key: 'gcs_eyes', label: 'GCS — Eyes', type: 'select', options: ['4-Spontaneous','3-To voice','2-To pain','1-None'] },
      { key: 'gcs_verbal', label: 'GCS — Verbal', type: 'select', options: ['5-Oriented','4-Confused','3-Words','2-Sounds','1-None'] },
      { key: 'gcs_motor', label: 'GCS — Motor', type: 'select', options: ['6-Obeys','5-Localizes','4-Withdraws','3-Flexion','2-Extension','1-None'] },
      { key: 'chief_complaint', label: 'Chief Complaint', type: 'textarea', placeholder: 'Describe the emergency...' },
      { key: 'onset', label: 'Onset Time', type: 'datetime' },
      { key: 'allergies_emergency', label: 'Known Allergies', type: 'textarea', placeholder: 'Drug allergies...' },
    ],
  },
  {
    id: 'surgery', label: 'Surgical Notes', icon: 'bi-scissors', category: 'Surgery',
    fields: [
      { key: 'procedure', label: 'Procedure Name', type: 'text', placeholder: 'e.g. Appendectomy' },
      { key: 'surgeon', label: 'Surgeon', type: 'text' },
      { key: 'anesthesia', label: 'Anesthesia Type', type: 'select', options: ['General','Spinal','Epidural','Local','Sedation'] },
      { key: 'incision_time', label: 'Incision Time', type: 'datetime' },
      { key: 'closure_time', label: 'Closure Time', type: 'datetime' },
      { key: 'blood_loss', label: 'Estimated Blood Loss', type: 'number', unit: 'mL' },
      { key: 'findings', label: 'Operative Findings', type: 'textarea' },
      { key: 'complications', label: 'Complications', type: 'select', options: ['None','Bleeding','Infection','Anesthetic','Other'] },
      { key: 'drains', label: 'Drains Placed', type: 'text', placeholder: 'Type and location' },
      { key: 'specimens', label: 'Specimens Sent', type: 'textarea', placeholder: 'Pathology, culture...' },
      { key: 'post_op_plan', label: 'Post-Op Plan', type: 'textarea' },
    ],
  },
  {
    id: 'intake_output', label: 'Intake & Output', icon: 'bi-droplet', category: 'Monitoring',
    fields: [
      { key: 'oral_intake', label: 'Oral Intake', type: 'number', unit: 'mL' },
      { key: 'iv_intake', label: 'IV Fluids', type: 'number', unit: 'mL' },
      { key: 'other_intake', label: 'Other Intake', type: 'number', unit: 'mL' },
      { key: 'urine_output', label: 'Urine Output', type: 'number', unit: 'mL' },
      { key: 'ng_output', label: 'NG Tube Output', type: 'number', unit: 'mL' },
      { key: 'drain_output', label: 'Drain Output', type: 'number', unit: 'mL' },
      { key: 'stool', label: 'Stool', type: 'select', options: ['None','Normal','Loose','Bloody','Black'] },
      { key: 'urine_color', label: 'Urine Color', type: 'select', options: ['Clear','Pale Yellow','Dark','Bloody','Cloudy'] },
      { key: 'fluid_balance', label: 'Fluid Balance Note', type: 'textarea' },
    ],
  },
  {
    id: 'delivery', label: 'Delivery / L&D', icon: 'bi-heart', category: 'Obstetrics',
    fields: [
      { key: 'gravida', label: 'Gravida', type: 'number' },
      { key: 'para', label: 'Para', type: 'number' },
      { key: 'gestation_weeks', label: 'Gestation (weeks)', type: 'number', unit: 'weeks' },
      { key: 'delivery_type', label: 'Delivery Type', type: 'select', options: ['Normal Vaginal','Assisted Vaginal','C-Section','VBAC'] },
      { key: 'delivery_time', label: 'Time of Delivery', type: 'datetime' },
      { key: 'apgar_1min', label: 'APGAR at 1 min', type: 'number', placeholder: '0-10' },
      { key: 'apgar_5min', label: 'APGAR at 5 min', type: 'number', placeholder: '0-10' },
      { key: 'birth_weight', label: 'Birth Weight', type: 'number', unit: 'g' },
      { key: 'baby_sex', label: 'Baby Sex', type: 'select', options: ['Male','Female'] },
      { key: 'complications_ld', label: 'Complications', type: 'textarea' },
      { key: 'placenta', label: 'Placenta', type: 'select', options: ['Complete','Incomplete','Retained','Manual Removal'] },
      { key: 'blood_loss_ld', label: 'Blood Loss', type: 'number', unit: 'mL' },
    ],
  },
  {
    id: 'gynecology', label: 'Gynecology Exam', icon: 'bi-gender-female', category: 'Obstetrics',
    fields: [
      { key: 'lmp', label: 'Last Menstrual Period', type: 'date' },
      { key: 'menstrual_pattern', label: 'Menstrual Pattern', type: 'select', options: ['Regular','Irregular','Amenorrhea','Menorrhagia','Post-menopausal'] },
      { key: 'breast_exam', label: 'Breast Exam', type: 'select', options: ['Normal','Lump','Discharge','Tenderness'] },
      { key: 'pelvic_exam', label: 'Pelvic Exam', type: 'select', options: ['Normal','Abnormal'] },
      { key: 'cervix', label: 'Cervix', type: 'select', options: ['Normal','Erosion','Polyp','Lesion'] },
      { key: 'uterus', label: 'Uterus', type: 'select', options: ['Normal','Enlarged','Fibroids','Tender'] },
      { key: 'adnexa', label: 'Adnexa', type: 'select', options: ['Normal','Mass','Tender'] },
      { key: 'pap_smear', label: 'Pap Smear Status', type: 'select', options: ['Done','Pending','Not done','Abnormal'] },
      { key: 'contraception', label: 'Contraception', type: 'select', options: ['None','OCP','IUD','Implant','Barrier','Sterilization'] },
    ],
  },
  {
    id: 'diabetes', label: 'Diabetes Check', icon: 'bi-droplet', category: 'Disease',
    fields: [
      { key: 'fbs', label: 'Fasting Blood Sugar', type: 'number', unit: 'mg/dL' },
      { key: 'ppbs', label: 'Post-Prandial BS', type: 'number', unit: 'mg/dL' },
      { key: 'hba1c', label: 'HbA1c', type: 'number', unit: '%' },
      { key: 'foot_exam', label: 'Foot Exam', type: 'select', options: ['Normal','Callus','Ulcer','Infection','Deformity'] },
      { key: 'foot_pulses', label: 'Foot Pulses', type: 'select', options: ['Palpable','Diminished','Absent'] },
      { key: 'monofilament', label: 'Monofilament Test', type: 'select', options: ['Normal','Reduced','Absent'] },
      { key: 'fundoscopy', label: 'Fundoscopy', type: 'select', options: ['Normal','Background Retinopathy','Proliferative','Not done'] },
      { key: 'diet_adherence', label: 'Diet Adherence', type: 'select', options: ['Good','Fair','Poor'] },
      { key: 'hypoglycemia_episodes', label: 'Recent Hypoglycemia', type: 'text' },
    ],
  },
  {
    id: 'custom', label: 'Custom Observation', icon: 'bi-pencil', category: 'Other',
    fields: [
      { key: 'title', label: 'Observation Title', type: 'text', required: true, placeholder: 'e.g. Wound Assessment' },
      { key: 'finding1', label: 'Finding 1', type: 'textarea', placeholder: 'Describe...' },
      { key: 'finding2', label: 'Finding 2', type: 'text' },
      { key: 'value1', label: 'Measurement 1', type: 'number' },
      { key: 'value2', label: 'Measurement 2', type: 'number' },
      { key: 'date_observed', label: 'Date Observed', type: 'datetime' },
      { key: 'notes_custom', label: 'Additional Notes', type: 'textarea' },
    ],
  },
];

interface Props {
  patientId: string;
  patientName: string;
  readOnly?: boolean;
  /** Used to explain *why* the form is unavailable, when it is. */
  role?: string;
}

export default function ObservationsTab({ patientId, patientName, readOnly = false, role }: Props) {
  const queryClient = useQueryClient();
  const [selectedForm, setSelectedForm] = useState<string>('vitals_advanced');
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState('');
  const [activeCategory, setActiveCategory] = useState('Routine');

  const { data: observations = [], isLoading: obsLoading } = useQuery({
    queryKey: ['patient', patientId, 'observations'],
    queryFn: async () => {
      try { const r = await nestClient.get(`/patients/${patientId}/observations`); return r.data || []; }
      catch { return []; }
    },
    enabled: !!patientId,
  });

  const saveObservation = useMutation({
    mutationFn: (data: { formId: string; formLabel: string; fields: Record<string, any> }) =>
      nestClient.post(`/patients/${patientId}/observations`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId, 'observations'] });
      setProblem('');
      setSaved(true);
      setFormData({});
      setTimeout(() => setSaved(false), 3000);
    },
    // A refused or failed save used to look like nothing happening at all.
    onError: (err: any) => {
      const message = err?.response?.data?.message;
      setProblem(
        (Array.isArray(message) ? message.join(' ') : message) ||
        err?.message ||
        'The observation could not be saved.',
      );
    },
  });

  const categories = [...new Set(FORM_TEMPLATES.map(f => f.category))];
  const filteredTemplates = FORM_TEMPLATES.filter(f => f.category === activeCategory);
  const currentTemplate = FORM_TEMPLATES.find(f => f.id === selectedForm);

  const setField = (key: string, value: any) => setFormData(prev => ({ ...prev, [key]: value }));

  const handleSubmit = () => {
    if (!currentTemplate) return;
    setProblem('');

    // Silently returning here is what made the button look dead on the Custom
    // template: the click did nothing and said nothing.
    const missing = currentTemplate.fields
      .filter((f) => f.required && !String(formData[f.key] ?? '').trim())
      .map((f) => f.label);
    if (missing.length) {
      setProblem(`Fill in ${missing.join(', ')} before saving.`);
      return;
    }

    saveObservation.mutate({ formId: currentTemplate.id, formLabel: currentTemplate.label, fields: { ...formData } });
  };

  const renderField = (field: FieldDef) => {
    const value = formData[field.key] ?? '';
    switch (field.type) {
      case 'select':
        return (
          <select className="form-select form-select-sm" value={value}
            onChange={e => setField(field.key, e.target.value)}>
            <option value="">— {field.label} —</option>
            {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      case 'boolean':
        return (
          <div className="d-flex gap-2">
            <button type="button" className={`btn btn-sm rounded-pill ${value === 'Yes' ? 'btn-success' : 'btn-outline-secondary'}`}
              onClick={() => setField(field.key, 'Yes')}>Yes</button>
            <button type="button" className={`btn btn-sm rounded-pill ${value === 'No' ? 'btn-danger' : 'btn-outline-secondary'}`}
              onClick={() => setField(field.key, 'No')}>No</button>
          </div>
        );
      case 'date':
        return <input type="date" className="form-control form-control-sm" value={value}
          onChange={e => setField(field.key, e.target.value)} />;
      case 'datetime':
        return <input type="datetime-local" className="form-control form-control-sm" value={value}
          onChange={e => setField(field.key, e.target.value)} />;
      case 'textarea':
        return <textarea className="form-control form-control-sm" rows={2} value={value} placeholder={field.placeholder}
          onChange={e => setField(field.key, e.target.value)} />;
      case 'number':
        return (
          <div className="input-group input-group-sm">
            <input type="number" step="any" className="form-control" value={value} placeholder={field.placeholder}
              onChange={e => setField(field.key, e.target.value)} />
            {field.unit && <span className="input-group-text">{field.unit}</span>}
          </div>
        );
      default:
        return <input type="text" className="form-control form-control-sm" value={value} placeholder={field.placeholder}
          onChange={e => setField(field.key, e.target.value)} />;
    }
  };

  return (
    <div>
      {/* Form Selector */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
          <div className="d-flex justify-content-between align-items-center">
            <h6 className="mb-0 fw-bold"><i className="bi bi-journal-check me-2 text-primary"></i>Clinical Observations — {patientName}</h6>
            {saved && (
              <span className="badge bg-success rounded-pill ms-2"><i className="bi bi-check-lg me-1"></i>Observation Saved</span>
            )}
          </div>
        </div>
        <div className="card-body py-2">
          {/* Category tabs */}
          <div className="d-flex gap-1 mb-2 flex-wrap">
            {categories.map(cat => (
              <button key={cat} className={`btn btn-sm rounded-pill ${activeCategory === cat ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => { setActiveCategory(cat); setSelectedForm(FORM_TEMPLATES.find(f => f.category === cat)?.id || ''); }}>
                {cat}
              </button>
            ))}
          </div>
          {/* Form templates */}
          <div className="d-flex gap-1 flex-wrap">
            {filteredTemplates.map(t => (
              <button key={t.id} className={`btn btn-sm rounded-pill ${selectedForm === t.id ? 'btn-success' : 'btn-outline-success'}`}
                onClick={() => { setSelectedForm(t.id); setFormData({}); }}>
                <i className={`bi ${t.icon} me-1`}></i>{t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Dynamic Form */}
      {currentTemplate && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: '16px' }}>
          <div className="card-header text-white py-3" style={{
            background: 'linear-gradient(135deg, #198754, #0dcaf0)', borderRadius: '16px 16px 0 0',
          }}>
            <h6 className="mb-0 fw-bold"><i className={`bi ${currentTemplate.icon} me-2`}></i>{currentTemplate.label}</h6>
          </div>
          <div className="card-body bg-light">
            <div className="row g-2">
              {currentTemplate.fields.map(field => (
                <div key={field.key} className={field.type === 'textarea' ? 'col-12' : 'col-md-4 col-sm-6'}>
                  <label className="form-label small fw-semibold">
                    {field.label} {field.required && <span className="text-danger">*</span>}
                  </label>
                  {renderField(field)}
                </div>
              ))}
            </div>
            {saved && (
              <div className="alert alert-success py-2 small"><i className="bi bi-check-circle me-1"></i>Observation saved to the chart.</div>
            )}
            {problem && (
              <div className="alert alert-danger py-2 small">
                <i className="bi bi-exclamation-triangle me-1"></i>
                {problem}
              </div>
            )}
            {!readOnly && (
              <div className="d-flex gap-2 mt-3">
                <button className="btn btn-success rounded-pill px-4" onClick={handleSubmit}
                  disabled={saveObservation.isPending}>
                  {saveObservation.isPending ? (
                    <><span className="spinner-border spinner-border-sm me-1"></span>Saving...</>
                  ) : (
                    <><i className="bi bi-check-lg me-1"></i>Save Observation</>
                  )}
                </button>
                <button className="btn btn-outline-secondary rounded-pill" onClick={() => setFormData({})}>Clear Form</button>
              </div>
            )}
            {readOnly && (
              <div className="alert alert-light border py-2 small mb-0 mt-3">
                <i className="bi bi-lock me-1"></i>
                {readOnlyNote('observations', role)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Observation History */}
      <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
        <div className="card-header bg-white py-3" style={{ borderRadius: '16px 16px 0 0' }}>
          <h6 className="mb-0 fw-bold">
            <i className="bi bi-clock-history me-2 text-info"></i>Observation History ({observations.length})
          </h6>
        </div>
        <div className="card-body p-0" style={{ maxHeight: '400px', overflow: 'auto' }}>
          {obsLoading ? (
            <div className="text-center py-3"><div className="spinner-border spinner-border-sm text-primary"></div></div>
          ) : observations.length === 0 ? (
            <div className="text-center text-muted py-4">
              <i className="bi bi-inbox fs-2 d-block mb-1 opacity-25"></i>
              <small>No observations recorded yet</small>
            </div>
          ) : (
            observations.map((obs: any, i: number) => (
              <div key={obs.id || i} className="px-3 py-2 border-bottom">
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <span className="badge bg-success rounded-pill small">{obs.formLabel || obs.form_type}</span>
                  <small className="text-muted">
                    {obs.created_at ? new Date(obs.created_at).toLocaleString() : obs.date || '—'}
                  </small>
                </div>
                <div className="row g-1 small">
                  {Object.entries(obs.fields || obs.data || {}).slice(0, 8).map(([k, v]: [string, any]) => (
                    <div key={k} className="col-md-3 col-sm-4 col-6">
                      <span className="text-muted">{k.replace(/_/g, ' ')}:</span>{' '}
                      <strong>{v?.toString() || '—'}</strong>
                    </div>
                  ))}
                  {Object.keys(obs.fields || obs.data || {}).length > 8 && (
                    <div className="col-12"><small className="text-muted">+ more fields...</small></div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
