import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';

export default function GroupTherapyPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ groupName: '', date: '', topic: '', facilitator: '', attendees: '', notes: '' });

  const saveSession = useMutation({
    mutationFn: (data: any) => nestClient.post('/messages', { title: `Group Therapy: ${data.groupName}`, body: `Topic: ${data.topic}\nFacilitator: ${data.facilitator}\nDate: ${data.date}\nAttendees: ${data.attendees}\n\nNotes: ${data.notes}`, pid: 0 }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['messages'] }); setForm({ groupName: '', date: '', topic: '', facilitator: '', attendees: '', notes: '' }); },
  });

  return (
    <div>
      <h3 className="mb-3"><i className="bi bi-people-fill me-2"></i>Group Therapy</h3>
      <div className="card shadow-sm">
        <div className="card-header"><h5 className="mb-0">Record Group Session</h5></div>
        <div className="card-body">
          <div className="row g-2">
            <div className="col-md-3"><label className="form-label small">Group Name</label><input className="form-control form-control-sm" value={form.groupName} onChange={e => setForm({...form, groupName: e.target.value})} /></div>
            <div className="col-md-2"><label className="form-label small">Date</label><input className="form-control form-control-sm" type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></div>
            <div className="col-md-3"><label className="form-label small">Topic</label><input className="form-control form-control-sm" value={form.topic} onChange={e => setForm({...form, topic: e.target.value})} /></div>
            <div className="col-md-2"><label className="form-label small">Facilitator</label><input className="form-control form-control-sm" value={form.facilitator} onChange={e => setForm({...form, facilitator: e.target.value})} /></div>
            <div className="col-md-2"><label className="form-label small">Attendees (IDs, comma)</label><input className="form-control form-control-sm" value={form.attendees} onChange={e => setForm({...form, attendees: e.target.value})} /></div>
            <div className="col-12"><label className="form-label small">Session Notes</label><textarea className="form-control form-control-sm" rows={4} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} /></div>
            <div className="col-12"><button className="btn btn-primary" onClick={() => saveSession.mutate(form)} disabled={saveSession.isPending}>Save Session</button></div>
          </div>
        </div>
      </div>
    </div>
  );
}
