import { ReactNode, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../../api/nest-client';
import { createPatient } from '../../../api/endpoints/patients';
import PhoneInput from '../../../components/shared/PhoneInput';
import CitySelect from '../../../components/shared/CitySelect';
import { isInvalidLiberiaNationalNumber } from '../../../utils/liberia';
import { formatPatientName } from '../../../utils/patientName';

/**
 * The registration form, shared.
 *
 * This is the same two-step form the register uses — same fields, same duplicate
 * check, same override rule — extracted so the emergency department can register
 * a new arrival *through the standard flow* instead of a parallel one. A second
 * copy would eventually validate differently, and duplicated patient records are
 * exactly the kind of mess nobody unwinds later.
 */

export interface RegistrationForm {
  fname: string;
  lname: string;
  mname: string;
  DOB: string;
  sex: string;
  email: string;
  phone_contact: string;
  street: string;
  city: string;
  providerID: string;
}

export const EMPTY_REGISTRATION: RegistrationForm = {
  fname: '', lname: '', mname: '', DOB: '', sex: '', email: '', phone_contact: '', street: '', city: '', providerID: '',
};

export interface RegistrationResult {
  id: number;
  pid: number;
  publicId: string;
}

/** Step 1 cannot be left until both names are present — the chart needs a name. */
export function canAdvance(form: RegistrationForm): boolean {
  return !!form.fname.trim() && !!form.lname.trim();
}

/**
 * The payload for `POST /patients`.
 *
 * Trimmed, blanks become empty strings, and `status` is left to the caller: a
 * normal registration lands on the service default (`active`), while the nurse
 * aide intake deliberately files `pending` for registrar approval. An emergency
 * arrival must be `active` — the nurse dashboard only shows active patients, so
 * a pending emergency registration would be invisible to the ward.
 */
export function registrationPayload(form: RegistrationForm, status?: string): Record<string, any> {
  const payload: Record<string, any> = {
    fname: form.fname.trim(),
    lname: form.lname.trim(),
    mname: form.mname.trim(),
    DOB: form.DOB || null,
    sex: form.sex || '',
    email: form.email.trim(),
    phone_contact: form.phone_contact.trim(),
    street: form.street.trim(),
    city: form.city,
  };
  const provider = Number(form.providerID);
  if (Number.isFinite(provider) && provider > 0) payload.providerID = provider;
  if (status) payload.status = status;
  return payload;
}

/** True when the phone number cannot be submitted as entered. */
export function invalidPhone(form: RegistrationForm): boolean {
  return isInvalidLiberiaNationalNumber(form.phone_contact);
}

export default function RegisterPatientModal({
  open,
  onClose,
  onRegistered,
  title = 'Register New Patient',
  submitLabel = 'Register New Patient',
  status,
  defaultProviderId,
  headerNote,
  onUseExisting,
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the created patient. The caller decides where to go next. */
  onRegistered: (result: RegistrationResult) => void;
  title?: string;
  submitLabel?: string;
  /** Omit to use the service default (`active`). */
  status?: string;
  defaultProviderId?: string;
  /** Extra line under the title, e.g. to explain this is an emergency arrival. */
  headerNote?: ReactNode;
  /** When `open` the form may fall back to an existing chart instead. */
  onUseExisting?: (patient: any) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RegistrationForm>({ ...EMPTY_REGISTRATION, providerID: defaultProviderId || '' });
  const [step, setStep] = useState(1);
  const [duplicates, setDuplicates] = useState<any[]>([]);
  /**
   * Registering a second record for someone who already exists is blocked by
   * default; this has to be switched on deliberately on the form.
   */
  const [overrideDuplicate, setOverrideDuplicate] = useState(false);
  const [checkingDup, setCheckingDup] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  const { data: providers = [] } = useQuery({
    queryKey: ['providers-list'],
    queryFn: async () => { const r = await nestClient.get('/admin/users'); return r.data; },
    enabled: open,
  });

  const create = useMutation({
    mutationFn: (payload: Record<string, any>) => createPatient(payload),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      // The register and the nurse dashboard both read patient lists; refresh
      // them so an emergency arrival appears everywhere at once.
      queryClient.invalidateQueries({ queryKey: ['nurse-dashboard'] });
      reset();
      onRegistered({ id: result.id, pid: result.pid, publicId: result.publicId });
    },
    onError: (err: any) => {
      console.error('Patient registration failed:', err?.response?.data?.message || err?.message, err);
    },
  });

  const reset = () => {
    setForm({ ...EMPTY_REGISTRATION, providerID: defaultProviderId || '' });
    setStep(1);
    setDuplicates([]);
    setOverrideDuplicate(false);
  };

  // Start each opening from a clean form.
  useEffect(() => {
    if (open) {
      reset();
      setTimeout(() => firstRef.current?.focus(), 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const update = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const nextStep = () => { if (canAdvance(form)) setStep(2); };
  const submit = () => {
    if (!canAdvance(form) || invalidPhone(form)) return;
    create.mutate(registrationPayload(form, status));
  };

  const checkDuplicates = async () => {
    setCheckingDup(true);
    setDuplicates([]);
    try {
      const r = await nestClient.get('/patients/check-duplicate', {
        params: { fname: form.fname, lname: form.lname, DOB: form.DOB, phone: form.phone_contact },
      });
      const hits = Array.isArray(r.data) ? r.data : [];
      setDuplicates(hits);
      if (!hits.length) submit();
    } catch {
      // A failed duplicate check must not block registration.
      submit();
    } finally {
      setCheckingDup(false);
    }
  };

  const handleSubmit = () => {
    if (!canAdvance(form) || invalidPhone(form)) return;
    // Blocked unless the registrar has explicitly switched the override on.
    if (overrideDuplicate) { submit(); return; }
    void checkDuplicates();
  };


  return (
    <>
      {open && (
        <div className="modal-backdrop fade show" style={{ zIndex: 1055 }} onClick={onClose} />
      )}
      <div className={`modal fade ${open ? 'show d-block' : ''}`} tabIndex={-1} style={{ zIndex: 1056 }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal-dialog modal-lg modal-dialog-centered">
          <div className="modal-content shadow-lg border-0 rounded-4">
            <div className="modal-header border-0 pb-0">
              <div>
                <h4 className="modal-title"><i className="bi bi-person-plus me-2 text-success"></i>{title}</h4>
                <p className="text-muted small mb-0 mt-1">Step {step} of 2 — {step === 1 ? 'Personal Information' : 'Contact & Address'}</p>
                {headerNote}
              </div>
              <button className="btn-close" onClick={onClose}></button>
            </div>

            <div className="modal-body py-4">
              {/* Progress */}
              <div className="d-flex justify-content-center mb-4">
                <div className="d-flex align-items-center gap-2" style={{ width: '200px' }}>
                  <div className={`rounded-circle d-flex align-items-center justify-content-center ${step >= 1 ? 'bg-success text-white' : 'bg-light'}`} style={{ width: '32px', height: '32px', fontSize: '0.8rem' }}>1</div>
                  <div className={`flex-grow-1 ${step >= 2 ? 'bg-success' : 'bg-light'}`} style={{ height: '3px' }}></div>
                  <div className={`rounded-circle d-flex align-items-center justify-content-center ${step >= 2 ? 'bg-success text-white' : 'bg-light'}`} style={{ width: '32px', height: '32px', fontSize: '0.8rem' }}>2</div>
                </div>
              </div>

              {step === 1 && (
                <div onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); nextStep(); } }}>
                  <h6 className="text-muted text-uppercase small mb-3">Personal Information</h6>
                  <div className="row g-3">
                    <div className="col-md-4"><label className="form-label small fw-semibold">First Name *</label><input ref={firstRef} className="form-control" value={form.fname} onChange={e => update('fname', e.target.value)} placeholder="John" /></div>
                    <div className="col-md-4"><label className="form-label small fw-semibold">Last Name *</label><input className="form-control" value={form.lname} onChange={e => update('lname', e.target.value)} placeholder="Doe" /></div>
                    <div className="col-md-4"><label className="form-label small fw-semibold">Middle Name</label><input className="form-control" value={form.mname} onChange={e => update('mname', e.target.value)} placeholder="A." /></div>
                    <div className="col-md-4"><label className="form-label small fw-semibold">Date of Birth</label><input className="form-control" type="date" value={form.DOB} onChange={e => update('DOB', e.target.value)} /></div>
                    <div className="col-md-4"><label className="form-label small fw-semibold">Sex</label><select className="form-select" value={form.sex} onChange={e => update('sex', e.target.value)}><option value="">— Select —</option><option>Male</option><option>Female</option></select></div>
                  </div>
                </div>
              )}


              {step === 2 && (
                <div>
                  <h6 className="text-muted text-uppercase small mb-3">Contact Information</h6>
                  <div className="row g-3 mb-4">
                    <div className="col-md-6"><label className="form-label small fw-semibold">Email</label><input className="form-control" type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="patient@email.com" /></div>
                    <div className="col-md-6"><label className="form-label small fw-semibold">Phone</label><PhoneInput value={form.phone_contact} onChange={(v) => update('phone_contact', v)} /></div>
                  </div>
                  <h6 className="text-muted text-uppercase small mb-3">Provider Assignment</h6>
                  <div className="row g-3 mb-4">
                    <div className="col-md-6">
                      <label className="form-label small fw-semibold">Primary Care Provider</label>
                      <select className="form-select" value={form.providerID} onChange={e => update('providerID', e.target.value)}>
                        <option value="">— Select Provider —</option>
                        {providers.filter((p: any) => p.active).map((p: any) => (
                          <option key={p.id} value={p.id}>{p.title ? `${p.title} ` : ''}{p.fname} {p.lname}{p.specialty ? ` (${p.specialty})` : ''}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <h6 className="text-muted text-uppercase small mb-3">Address</h6>
                  <div className="row g-3">
                    <div className="col-12"><label className="form-label small fw-semibold">Street</label><input className="form-control" value={form.street} onChange={e => update('street', e.target.value)} placeholder="123 Main Street" /></div>
                    <div className="col-md-12"><label className="form-label small fw-semibold">City</label><CitySelect value={form.city} onChange={(v) => update('city', v)} /></div>
                  </div>
                </div>
              )}

              {checkingDup && (
                <div className="alert alert-light border d-flex align-items-center gap-2 small">
                  <span className="spinner-border spinner-border-sm text-primary"></span>
                  Checking for an existing patient record…
                </div>
              )}

              {duplicates.length > 0 && (
                <div className="alert alert-warning p-3 rounded-3">
                  <div className="fw-semibold mb-2">
                    <i className="bi bi-shield-exclamation me-1"></i>
                    Registration blocked — this patient may already be on file
                  </div>
                  {duplicates.map((d: any) => (
                    <div key={d.id} className="d-flex align-items-center justify-content-between border-bottom py-2 small">
                      <div>
                        <strong>{formatPatientName(d)}</strong>
                        <div className="text-muted">DOB: {d.DOB || '—'} · Phone: {d.phone_contact || '—'}</div>
                      </div>
                      <button className="btn btn-sm btn-outline-primary rounded-pill px-3"
                        onClick={() => { setDuplicates([]); onUseExisting?.(d); }}>
                        Use Existing <i className="bi bi-arrow-right ms-1"></i>
                      </button>
                    </div>
                  ))}
                  <div className="form-check form-switch mt-3 mb-1">
                    <input className="form-check-input" type="checkbox" role="switch"
                      id="override-duplicate" checked={overrideDuplicate}
                      onChange={(e) => setOverrideDuplicate(e.target.checked)} />
                    <label className="form-check-label small fw-semibold" htmlFor="override-duplicate">
                      Override — register as a new patient anyway
                    </label>
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                    Only use the override when you are sure this is a different person
                    (for example a shared phone number or a common name). Leave it off to
                    open the existing chart instead of creating a duplicate.
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer border-0 pt-0">
              {step === 2 && <button className="btn btn-outline-secondary" onClick={() => setStep(1)}><i className="bi bi-arrow-left me-1"></i>Back</button>}
              <div className="flex-grow-1"></div>
              {step === 1 && <button className="btn btn-primary px-4" onClick={nextStep} disabled={!canAdvance(form)}>Next <i className="bi bi-arrow-right ms-1"></i></button>}
              {step === 2 && (
                <button className="btn btn-success px-4" onClick={handleSubmit} disabled={create.isPending || checkingDup}>
                  {create.isPending ? <><span className="spinner-border spinner-border-sm me-2" />Registering...</> : <><i className="bi bi-check-lg me-1"></i>{submitLabel}</>}
                </button>
              )}
              {create.isError && <small className="text-danger">Registration failed. Please try again.</small>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

