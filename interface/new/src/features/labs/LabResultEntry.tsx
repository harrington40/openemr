import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import { useAuth } from '../../hooks/useAuth';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const EMPTY: any = {
  result_code: '', result_text: '', result: '', units: '', range: '',
  flag: '', comments: '', result_type: 'TEXT', ref_min: null, ref_max: null,
};

/** Same flag logic as the lab request/result forms. */
function computeFlag(resultType: string, value: string, refMin: any, refMax: any): string {
  if (!value) return '';
  if (resultType === 'NUMERIC' && (refMin != null || refMax != null)) {
    const n = Number(value);
    if (isNaN(n)) return 'TEXT';
    if (refMin != null && n < Number(refMin)) return 'LOW';
    if (refMax != null && n > Number(refMax)) return 'HIGH';
    return 'NORMAL';
  }
  if (resultType === 'POSITIVE_NEGATIVE') {
    const v = value.toLowerCase();
    if (['negative', 'non-reactive', 'non reactive'].includes(v)) return 'NEGATIVE';
    if (['positive', 'reactive'].includes(v)) return 'POSITIVE';
  }
  return '';
}

const flagBadge = (f: string) =>
  f === 'LOW' ? 'bg-warning text-dark' : f === 'HIGH' ? 'bg-danger' : f === 'NORMAL' ? 'bg-success'
    : f === 'POSITIVE' ? 'bg-danger' : f === 'NEGATIVE' ? 'bg-success' : 'bg-secondary';

interface Props {
  /** Lab order to record results against. */
  orderId?: number | null;
  /** Patient, used for the order picker / header. */
  patientPid?: string;
  /** Show a lab-order selector when no orderId is fixed (e.g. Lab Result Forms). */
  showOrderPicker?: boolean;
  /** Panel/test name shown above the form (e.g. the ordered panel). */
  panelLabel?: string;
}

/**
 * Shared "Test Request" result entry — the dropdown grouped by category plus the
 * Result / Flag / Unit / Reference Range / Comments fields and the recorded
 * results table. Used by Lab Orders, Lab Management and the Lab Result Forms.
 */
export default function LabResultEntry({ orderId: orderIdProp, patientPid, showOrderPicker = false, panelLabel }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEnter = user?.role === 'lab_tech' || user?.role === 'admin';

  const [pickedOrderId, setPickedOrderId] = useState<number | null>(null);
  useEffect(() => { setPickedOrderId(orderIdProp ?? null); }, [orderIdProp]);
  const activeOrderId = orderIdProp ?? pickedOrderId;

  const { data: catalog = [] } = useQuery({
    queryKey: ['lab-catalog'],
    queryFn: async () => (await nestClient.get('/lab/catalog')).data || [],
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['patient-orders', patientPid],
    queryFn: async () => (await nestClient.get(`/patients/${patientPid}/procedures`)).data || [],
    enabled: !!patientPid && showOrderPicker,
  });

  // Default the picker to the most recent order for the patient.
  useEffect(() => {
    if (!orderIdProp && showOrderPicker && !pickedOrderId && (orders as any[]).length) {
      setPickedOrderId(Number((orders as any[])[0].id));
    }
  }, [orders, orderIdProp, showOrderPicker, pickedOrderId]);

  const { data: resultData } = useQuery({
    queryKey: ['order-results', activeOrderId],
    queryFn: async () => (await nestClient.get(`/procedures/${activeOrderId}/results`)).data,
    enabled: !!activeOrderId,
  });

  const groupedCatalog = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const t of catalog as any[]) {
      (map[t.category] ||= []).push(t);
    }
    return map;
  }, [catalog]);

  const [form, setForm] = useState<any>({ ...EMPTY });
  const [notice, setNotice] = useState('');

  const addResult = useMutation({
    mutationFn: (d: any) => nestClient.post(`/procedures/${activeOrderId}/results`, d),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['order-results', activeOrderId] });
      qc.invalidateQueries({ queryKey: ['lab-orders'] });
      qc.invalidateQueries({ queryKey: ['all-lab-orders'] });
      qc.invalidateQueries({ queryKey: ['provider-lab-orders'] });
      setForm({ ...EMPTY });
      setNotice(res?.data?.duplicate ? 'Duplicate result skipped — this test already has a result for this order.' : '');
    },
    onError: (e: any) => setNotice(e?.response?.data?.message || 'Could not save the result.'),
  });

  if (!activeOrderId) {
    return (
      <div className="text-muted small py-3">
        {showOrderPicker ? 'Select a lab order to enter or view results.' : 'No lab order selected.'}
      </div>
    );
  }

  const results = (resultData?.results || []) as any[];

  return (
    <div>
      {!orderIdProp && showOrderPicker && (
        <div className="mb-3" style={{ maxWidth: '420px' }}>
          <label className="form-label small fw-semibold">Lab Order</label>
          <select className="form-select form-select-sm" value={pickedOrderId ?? ''}
            onChange={(e) => setPickedOrderId(Number(e.target.value) || null)}>
            <option value="">— Select order —</option>
            {(orders as any[]).map((o: any) => (
              <option key={o.id} value={o.id}>
                #{o.id} · {o.instructions || 'Lab test'} ({o.orderStatus})
              </option>
            ))}
          </select>
        </div>
      )}

      {panelLabel && (
        <div className="small text-muted mb-2">Panel: <strong>{panelLabel}</strong></div>
      )}

      {canEnter && (
        <div className="row g-2 align-items-end mb-3">
          <div className="col-md-4">
            <label className="form-label small mb-0">Test Request *</label>
            <select className="form-select form-select-sm" value={form.result_code}
              onChange={(e) => {
                const t = (catalog as any[]).find((c) => c.code === e.target.value);
                const range = t?.ref_text || (t?.ref_min != null && t?.ref_max != null ? `${t.ref_min} - ${t.ref_max}` : t?.ref_min != null ? `≥ ${t.ref_min}` : t?.ref_max != null ? `≤ ${t.ref_max}` : '');
                setForm({ result_code: t?.code || '', result_text: t?.name || '', result: '', units: t?.unit || '', range, flag: '', comments: '', result_type: t?.result_type || 'TEXT', ref_min: t?.ref_min ?? null, ref_max: t?.ref_max ?? null });
              }}>
              <option value="">— Select Test —</option>
              {Object.entries(groupedCatalog).map(([cat, tests]: any) => (
                <optgroup key={cat} label={cat}>
                  {tests.map((t: any) => <option key={t.code} value={t.code}>{t.name}{t.unit ? ` (${t.unit})` : ''}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label small mb-0">Results *</label>
            {form.result_type === 'POSITIVE_NEGATIVE' ? (
              <select className="form-select form-select-sm" value={form.result}
                onChange={(e) => setForm({ ...form, result: e.target.value, flag: computeFlag(form.result_type, e.target.value, form.ref_min, form.ref_max) })}>
                <option value="">— Select —</option>
                <option>Negative</option><option>Positive</option><option>Non-Reactive</option><option>Reactive</option>
              </select>
            ) : form.result_type === 'BLOOD_GROUP' ? (
              <select className="form-select form-select-sm" value={form.result}
                onChange={(e) => setForm({ ...form, result: e.target.value, flag: computeFlag(form.result_type, e.target.value, form.ref_min, form.ref_max) })}>
                <option value="">— Select —</option>
                {BLOOD_GROUPS.map((g) => <option key={g}>{g}</option>)}
              </select>
            ) : (
              <input className="form-control form-control-sm" type={form.result_type === 'NUMERIC' ? 'number' : 'text'} step="any"
                value={form.result}
                onChange={(e) => setForm({ ...form, result: e.target.value, flag: computeFlag(form.result_type, e.target.value, form.ref_min, form.ref_max) })} />
            )}
          </div>
          <div className="col-md-2">
            <label className="form-label small mb-0">Flag</label>
            <div className="form-control form-control-sm bg-light"><span className={`badge ${flagBadge(form.flag)}`}>{form.flag || '—'}</span></div>
          </div>
          <div className="col-md-3">
            <label className="form-label small mb-0">Unit / Range</label>
            <div className="form-control form-control-sm bg-light small">{form.units || '—'}{form.range ? ` · ${form.range}` : ''}</div>
          </div>
          <div className="col-md-9">
            <label className="form-label small mb-0">Comments</label>
            <input className="form-control form-control-sm" value={form.comments}
              onChange={(e) => setForm({ ...form, comments: e.target.value })} />
          </div>
          <div className="col-md-3">
            <button className="btn btn-success btn-sm w-100 rounded-pill"
              disabled={addResult.isPending || !form.result_text || !form.result}
              onClick={() => addResult.mutate({ result_code: form.result_code, result_text: form.result_text, result: form.result, units: form.units, range: form.range, abnormal: form.flag, comments: form.comments })}>
              {addResult.isPending ? 'Saving…' : <><i className="bi bi-check-lg me-1"></i>Add Result</>}
            </button>
          </div>
        </div>
      )}

      {notice && <div className="alert alert-warning py-1 px-2 small rounded-3">{notice}</div>}

      {results.length > 0 ? (
        <div className="table-responsive">
          <table className="table table-sm small mb-0">
            <thead className="table-light">
              <tr><th>Test Request</th><th>Results</th><th>Unit</th><th>Normal Value</th><th>Flag</th><th>Comments</th></tr>
            </thead>
            <tbody>
              {results.map((r: any) => (
                <tr key={r.id}>
                  <td>{r.result_text || r.result_code}</td>
                  <td><strong>{r.result}</strong></td>
                  <td className="text-muted">{r.units || '—'}</td>
                  <td className="text-muted">{r.range || '—'}</td>
                  <td><span className={`badge ${flagBadge(r.abnormal)}`}>{r.abnormal && r.abnormal !== 'N' ? r.abnormal : '—'}</span></td>
                  <td className="text-muted">{r.comments || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center text-muted small py-3">No results recorded yet.</div>
      )}
    </div>
  );
}

