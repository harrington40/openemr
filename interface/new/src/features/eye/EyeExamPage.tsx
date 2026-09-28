import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';

export default function EyeExamPage() {
  const queryClient = useQueryClient();
  const [pid, setPid] = useState('');
  const [form, setForm] = useState({
    visual_acuity_od: '', visual_acuity_os: '',
    iop_od: '', iop_os: '',
    refraction_od: '', refraction_os: '',
    anterior_segment: '', posterior_segment: '',
    diagnosis: '', plan: '',
  });

  const saveExam = useMutation({
    mutationFn: (data: any) => nestClient.post(`/patients/${pid}/encounters/1/notes`, {
      code: 'EYE_EXAM', codetext: 'Eye Examination',
      description: JSON.stringify(data), clinical_notes_type: 'ophthalmology',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient', pid] });
      setForm({ visual_acuity_od: '', visual_acuity_os: '', iop_od: '', iop_os: '', refraction_od: '', refraction_os: '', anterior_segment: '', posterior_segment: '', diagnosis: '', plan: '' });
    },
  });

  return (
    <div>
      <h3 className="mb-4"><i className="bi bi-eye me-2"></i>Eye Examination (Ophthalmology)</h3>

      <div className="card shadow-sm mb-4">
        <div className="card-body">
          <div className="row g-2 mb-3">
            <div className="col-md-3"><label className="form-label small">Patient ID</label><input className="form-control form-control-sm" value={pid} onChange={e => setPid(e.target.value)} /></div>
          </div>

          <h6 className="text-muted text-uppercase small">Visual Acuity</h6>
          <div className="row g-2 mb-3">
            <div className="col-md-3"><label className="form-label small">OD (Right)</label><input className="form-control form-control-sm" placeholder="20/20" value={form.visual_acuity_od} onChange={e => setForm({...form, visual_acuity_od: e.target.value})} /></div>
            <div className="col-md-3"><label className="form-label small">OS (Left)</label><input className="form-control form-control-sm" placeholder="20/20" value={form.visual_acuity_os} onChange={e => setForm({...form, visual_acuity_os: e.target.value})} /></div>
          </div>

          <h6 className="text-muted text-uppercase small">Intraocular Pressure (mmHg)</h6>
          <div className="row g-2 mb-3">
            <div className="col-md-3"><label className="form-label small">OD</label><input className="form-control form-control-sm" type="number" value={form.iop_od} onChange={e => setForm({...form, iop_od: e.target.value})} /></div>
            <div className="col-md-3"><label className="form-label small">OS</label><input className="form-control form-control-sm" type="number" value={form.iop_os} onChange={e => setForm({...form, iop_os: e.target.value})} /></div>
          </div>

          <h6 className="text-muted text-uppercase small">Refraction</h6>
          <div className="row g-2 mb-3">
            <div className="col-md-3"><label className="form-label small">OD</label><input className="form-control form-control-sm" placeholder="-1.00 DS" value={form.refraction_od} onChange={e => setForm({...form, refraction_od: e.target.value})} /></div>
            <div className="col-md-3"><label className="form-label small">OS</label><input className="form-control form-control-sm" placeholder="-0.50 DS" value={form.refraction_os} onChange={e => setForm({...form, refraction_os: e.target.value})} /></div>
          </div>

          <h6 className="text-muted text-uppercase small">Examination</h6>
          <div className="row g-2 mb-3">
            <div className="col-md-6"><label className="form-label small">Anterior Segment</label><textarea className="form-control form-control-sm" rows={2} value={form.anterior_segment} onChange={e => setForm({...form, anterior_segment: e.target.value})} placeholder="Cornea clear, anterior chamber deep..." /></div>
            <div className="col-md-6"><label className="form-label small">Posterior Segment</label><textarea className="form-control form-control-sm" rows={2} value={form.posterior_segment} onChange={e => setForm({...form, posterior_segment: e.target.value})} placeholder="Optic nerve pink, macula flat..." /></div>
          </div>

          <div className="row g-2 mb-3">
            <div className="col-md-6"><label className="form-label small">Diagnosis</label><input className="form-control form-control-sm" value={form.diagnosis} onChange={e => setForm({...form, diagnosis: e.target.value})} /></div>
            <div className="col-md-6"><label className="form-label small">Plan</label><input className="form-control form-control-sm" value={form.plan} onChange={e => setForm({...form, plan: e.target.value})} /></div>
          </div>

          <button className="btn btn-primary" onClick={() => saveExam.mutate(form)} disabled={saveExam.isPending || !pid}>
            {saveExam.isPending ? 'Saving...' : 'Save Eye Exam'}
          </button>
          {saveExam.isSuccess && <span className="text-success ms-2"><i className="bi bi-check-circle"></i> Saved</span>}
        </div>
      </div>
    </div>
  );
}
