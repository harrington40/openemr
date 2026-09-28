import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';

const ORDER_SETS: Record<string, string[]> = {
  'Annual Physical': ['CBC', 'CMP', 'Lipid Panel', 'TSH', 'UA'],
  'Diabetes Follow-up': ['HbA1c', 'CMP', 'Lipid Panel', 'Microalbumin', 'UA'],
  'Hypertension': ['CMP', 'Lipid Panel', 'EKG', 'UA'],
  'Pre-Op Clearance': ['CBC', 'CMP', 'PT/PTT', 'EKG', 'CXR'],
};

export default function CamosPage() {
  const queryClient = useQueryClient();
  const [pid, setPid] = useState('');
  const [selectedSet, setSelectedSet] = useState('');

  const createOrders = useMutation({
    mutationFn: async () => {
      const orders = ORDER_SETS[selectedSet] || [];
      for (const order of orders) {
        await nestClient.post(`/patients/${pid}/procedures`, { order_status: 'pending', patient_instructions: order, clinical_hx: selectedSet });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['labs', pid] }),
  });

  return (
    <div>
      <h3 className="mb-3"><i className="bi bi-clipboard-check me-2"></i>CAMOS — Computer Aided Ordering</h3>
      <div className="card shadow-sm mb-4">
        <div className="card-header"><h5 className="mb-0">Quick Order Set</h5></div>
        <div className="card-body">
          <div className="row g-2 mb-3">
            <div className="col-md-3"><label className="form-label small">Patient ID</label><input className="form-control form-control-sm" value={pid} onChange={e => setPid(e.target.value)} /></div>
            <div className="col-md-4"><label className="form-label small">Order Set</label><select className="form-select form-select-sm" value={selectedSet} onChange={e => setSelectedSet(e.target.value)}><option value="">— Select —</option>{Object.keys(ORDER_SETS).map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            <div className="col-md-3 align-self-end"><button className="btn btn-primary btn-sm w-100" onClick={() => createOrders.mutate()} disabled={!pid || !selectedSet || createOrders.isPending}>{createOrders.isPending ? 'Ordering...' : 'Place Orders'}</button></div>
          </div>
          {selectedSet && (
            <div className="alert alert-info small mb-0">
              <strong>{selectedSet}:</strong> {ORDER_SETS[selectedSet].join(', ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
