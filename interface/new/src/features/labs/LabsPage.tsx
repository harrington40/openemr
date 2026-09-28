
import { useState, useMemo, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import nestClient from '../../api/nest-client';
import { useAuth } from '../../hooks/useAuth';
import { groupOrdersByPatient } from '../../utils/groupOrdersByPatient';
import LabResultEntry from './LabResultEntry';
import { canViewFinancials } from '../../utils/permissions';
import Barcode from '../../components/shared/Barcode';
import { formatDateHuman } from '../../utils/date';

// ── Lab Test Auto-Population Data ─────────────────────────────────
export const LAB_TESTS: Record<string, { code: string; name: string; units: string[]; values: string[]; range: string }> = {
  // CBC
  'WBC': { code: 'WBC', name: 'White Blood Cell Count', units: ['x10³/µL', 'cells/µL'], values: ['3.5','4.0','5.0','6.5','7.2','8.5','9.8','10.5','11.0','12.5','15.0'], range: '4.0-11.0 x10³/µL' },
  'RBC': { code: 'RBC', name: 'Red Blood Cell Count', units: ['x10⁶/µL', 'cells/µL'], values: ['3.5','4.0','4.5','4.8','5.2','5.5','6.0'], range: '4.5-5.5 x10⁶/µL (M), 4.0-5.0 (F)' },
  'Hemoglobin': { code: 'HGB', name: 'Hemoglobin', units: ['g/dL', 'g/L'], values: ['7.0','8.5','10.0','11.5','12.0','13.0','13.5','14.5','15.0','16.0','18.0'], range: '13.5-17.5 g/dL (M), 12.0-16.0 (F)' },
  'Hematocrit': { code: 'HCT', name: 'Hematocrit', units: ['%'], values: ['25','30','33','36','38','40','42','45','48','52'], range: '38-50% (M), 35-45% (F)' },
  'Platelets': { code: 'PLT', name: 'Platelet Count', units: ['x10³/µL'], values: ['50','100','130','150','180','200','250','300','400','500'], range: '150-400 x10³/µL' },
  'MCV': { code: 'MCV', name: 'Mean Corpuscular Volume', units: ['fL'], values: ['60','70','75','80','85','90','95','100','110'], range: '80-100 fL' },
  'MCH': { code: 'MCH', name: 'Mean Corpuscular Hemoglobin', units: ['pg'], values: ['20','25','27','30','32','34'], range: '27-33 pg' },
  'Neutrophils': { code: 'NEUT', name: 'Neutrophils', units: ['%', 'x10³/µL'], values: ['20','30','40','50','55','60','65','70','80'], range: '40-70%' },
  'Lymphocytes': { code: 'LYMPH', name: 'Lymphocytes', units: ['%', 'x10³/µL'], values: ['10','15','20','25','30','35','40','45','50'], range: '20-40%' },
  // BMP/CMP
  'Glucose': { code: 'GLU', name: 'Glucose', units: ['mg/dL', 'mmol/L'], values: ['50','65','70','80','90','95','100','110','120','140','180','250','350'], range: '70-100 mg/dL (fasting)' },
  'Sodium': { code: 'Na', name: 'Sodium', units: ['mmol/L', 'mEq/L'], values: ['120','125','130','132','135','138','140','142','145','148','155'], range: '135-145 mmol/L' },
  'Potassium': { code: 'K', name: 'Potassium', units: ['mmol/L', 'mEq/L'], values: ['2.5','3.0','3.3','3.5','3.8','4.0','4.2','4.5','5.0','5.5','6.5'], range: '3.5-5.0 mmol/L' },
  'Chloride': { code: 'Cl', name: 'Chloride', units: ['mmol/L', 'mEq/L'], values: ['90','95','98','100','102','105','108','112'], range: '98-107 mmol/L' },
  'CO2': { code: 'CO2', name: 'Carbon Dioxide', units: ['mmol/L', 'mEq/L'], values: ['15','18','20','22','24','26','28','30','35'], range: '22-29 mmol/L' },
  'BUN': { code: 'BUN', name: 'Blood Urea Nitrogen', units: ['mg/dL', 'mmol/L'], values: ['5','8','10','12','15','18','20','25','30','40'], range: '7-20 mg/dL' },
  'Creatinine': { code: 'CREAT', name: 'Creatinine', units: ['mg/dL', 'µmol/L'], values: ['0.4','0.6','0.8','1.0','1.2','1.5','2.0','3.0','5.0'], range: '0.6-1.2 mg/dL (M), 0.5-1.1 (F)' },
  'Calcium': { code: 'Ca', name: 'Calcium', units: ['mg/dL', 'mmol/L'], values: ['6.0','7.0','8.0','8.5','9.0','9.5','10.0','10.5','11.5'], range: '8.5-10.5 mg/dL' },
  // Liver
  'ALT': { code: 'ALT', name: 'Alanine Aminotransferase', units: ['U/L', 'IU/L'], values: ['10','15','20','25','30','35','40','50','65','80','120'], range: '7-56 U/L' },
  'AST': { code: 'AST', name: 'Aspartate Aminotransferase', units: ['U/L', 'IU/L'], values: ['8','12','20','25','30','35','40','50','70','100'], range: '10-40 U/L' },
  'ALP': { code: 'ALP', name: 'Alkaline Phosphatase', units: ['U/L', 'IU/L'], values: ['30','44','60','80','100','120','147','200'], range: '44-147 U/L' },
  'Total Bilirubin': { code: 'TBIL', name: 'Total Bilirubin', units: ['mg/dL', 'µmol/L'], values: ['0.2','0.4','0.6','0.8','1.0','1.2','1.5','2.0','3.0'], range: '0.1-1.2 mg/dL' },
  'Total Protein': { code: 'TP', name: 'Total Protein', units: ['g/dL', 'g/L'], values: ['5.0','5.5','6.0','6.5','7.0','7.5','8.0','8.5'], range: '6.0-8.3 g/dL' },
  'Albumin': { code: 'ALB', name: 'Albumin', units: ['g/dL', 'g/L'], values: ['2.5','3.0','3.5','4.0','4.5','5.0','5.5'], range: '3.5-5.0 g/dL' },
  // Lipids
  'Total Cholesterol': { code: 'CHOL', name: 'Total Cholesterol', units: ['mg/dL', 'mmol/L'], values: ['100','120','140','160','180','200','220','240','260','300'], range: '<200 mg/dL' },
  'HDL': { code: 'HDL', name: 'HDL Cholesterol', units: ['mg/dL', 'mmol/L'], values: ['20','25','30','35','40','45','50','55','60','70','80','100'], range: '>40 mg/dL (M), >50 (F)' },
  'LDL': { code: 'LDL', name: 'LDL Cholesterol', units: ['mg/dL', 'mmol/L'], values: ['40','60','70','80','90','100','120','130','150','160','190'], range: '<100 mg/dL' },
  'Triglycerides': { code: 'TG', name: 'Triglycerides', units: ['mg/dL', 'mmol/L'], values: ['50','75','100','120','150','180','200','250','350','500'], range: '<150 mg/dL' },
  // Thyroid
  'TSH': { code: 'TSH', name: 'Thyroid Stimulating Hormone', units: ['mIU/L', 'µIU/mL'], values: ['0.1','0.3','0.5','1.0','2.0','3.0','4.0','5.0','10.0','20.0'], range: '0.4-4.0 mIU/L' },
  'Free T3': { code: 'FT3', name: 'Free T3', units: ['pg/mL', 'pmol/L'], values: ['1.5','2.0','2.5','3.0','3.5','4.0','4.5','5.0','6.0'], range: '2.3-4.2 pg/mL' },
  'Free T4': { code: 'FT4', name: 'Free T4', units: ['ng/dL', 'pmol/L'], values: ['0.5','0.8','1.0','1.2','1.5','1.8','2.0','2.5','3.0'], range: '0.8-1.8 ng/dL' },
  // Coagulation
  'PT': { code: 'PT', name: 'Prothrombin Time', units: ['seconds'], values: ['10','11','12','13','13.5','14','15','18','22'], range: '11-13.5 seconds' },
  'PTT': { code: 'PTT', name: 'Partial Thromboplastin Time', units: ['seconds'], values: ['20','25','28','30','32','35','40','45','50'], range: '25-35 seconds' },
  'INR': { code: 'INR', name: 'International Normalized Ratio', units: ['N/A'], values: ['0.8','0.9','1.0','1.1','1.2','1.5','2.0','2.5','3.0','3.5','5.0'], range: '0.9-1.2' },
  // Other
  'HbA1c': { code: 'HbA1c', name: 'Hemoglobin A1c', units: ['%', 'mmol/mol'], values: ['4.0','4.5','5.0','5.5','5.7','6.0','6.5','7.0','8.0','10.0','12.0'], range: '<5.7% (normal), 5.7-6.4% (prediabetes), ≥6.5% (diabetes)' },
  'CRP': { code: 'CRP', name: 'C-Reactive Protein', units: ['mg/L', 'mg/dL'], values: ['0.5','1.0','3.0','5.0','10.0','20.0','50.0','100.0'], range: '<3.0 mg/L' },
  'ESR': { code: 'ESR', name: 'Erythrocyte Sedimentation Rate', units: ['mm/hr'], values: ['2','5','10','15','20','30','40','50','80','100'], range: '0-15 mm/hr (M), 0-20 (F)' },
  'D-Dimer': { code: 'DDR', name: 'D-Dimer', units: ['ng/mL', 'µg/mL'], values: ['100','200','250','300','500','750','1000','2000','5000'], range: '<250 ng/mL' },
  'HIV': { code: 'HIV', name: 'HIV Test', units: ['N/A'], values: ['Non-Reactive','Reactive','Indeterminate'], range: 'Non-Reactive' },
  'HBsAg': { code: 'HBsAg', name: 'Hepatitis B Surface Antigen', units: ['N/A'], values: ['Non-Reactive','Reactive','Weakly Reactive'], range: 'Non-Reactive' },
  'HCV': { code: 'HCV', name: 'Hepatitis C Antibody', units: ['N/A'], values: ['Non-Reactive','Reactive','Indeterminate'], range: 'Non-Reactive' },
  'Malaria Smear': { code: 'MAL', name: 'Malaria Parasite Smear', units: ['N/A'], values: ['Negative','Positive (+)','Positive (++)','Positive (+++)','Positive (++++)','P. falciparum seen','Mixed infection'], range: 'Negative' },
  'Urine Culture': { code: 'UC', name: 'Urine Culture', units: ['CFU/mL'], values: ['No Growth','<10,000 CFU/mL','10,000-50,000 CFU/mL','>100,000 CFU/mL','Mixed flora'], range: 'No Growth' },
  'Blood Culture': { code: 'BC', name: 'Blood Culture', units: ['N/A'], values: ['No Growth at 5 Days','Staph. aureus','E. coli','Klebsiella pneumoniae','Pseudomonas aeruginosa','Streptococcus pneumoniae'], range: 'No Growth at 5 Days' },
  'COVID-19 PCR': { code: 'COV2', name: 'SARS-CoV-2 RNA PCR', units: ['N/A'], values: ['Not Detected','Detected','Inconclusive','Invalid'], range: 'Not Detected' },
  'Urinalysis': { code: 'UA', name: 'Urinalysis Panel', units: ['N/A'], values: ['Normal','Abnormal'], range: 'Normal' },
  'Complete Blood Count (CBC)': { code: 'CBC', name: 'Complete Blood Count Panel', units: ['N/A'], values: ['Normal','Abnormal'], range: 'Normal' },
  'Comprehensive Metabolic Panel': { code: 'CMP', name: 'Comp. Metabolic Panel', units: ['N/A'], values: ['Normal','Abnormal'], range: 'Normal' },
  'Basic Metabolic Panel (BMP)': { code: 'BMP', name: 'Basic Metabolic Panel', units: ['N/A'], values: ['Normal','Abnormal'], range: 'Normal' },
  'Lipid Panel': { code: 'LIPID', name: 'Lipid Panel', units: ['N/A'], values: ['Normal','Abnormal','Borderline'], range: 'Normal' },
  'Liver Function Test': { code: 'LFT', name: 'Liver Function Panel', units: ['N/A'], values: ['Normal','Abnormal'], range: 'Normal' },
  'Thyroid Panel': { code: 'THYR', name: 'Thyroid Panel', units: ['N/A'], values: ['Normal','Abnormal'], range: 'Normal' },
  'Coagulation Profile': { code: 'COAG', name: 'Coagulation Profile', units: ['N/A'], values: ['Normal','Abnormal'], range: 'Normal' },
  'STI Panel': { code: 'STI', name: 'STI Panel', units: ['N/A'], values: ['Non-Reactive','Reactive'], range: 'Non-Reactive' },
  'Pregnancy Test': { code: 'HCG', name: 'Pregnancy Test (hCG)', units: ['N/A'], values: ['Negative','Positive','Indeterminate'], range: 'Negative' },
  'Malaria / Parasites': { code: 'MAL', name: 'Malaria & Parasites', units: ['N/A'], values: ['Negative','Positive (+)','Positive (++)','Positive (+++)','Positive (++++)','P. falciparum seen'], range: 'Negative' },
};

// Fuzzy match: find test data by partial name match
export function findTestData(instructions: string): typeof LAB_TESTS[string] | null {
  if (!instructions) return null;
  // Exact match first
  if (LAB_TESTS[instructions]) return LAB_TESTS[instructions];
  // Case-insensitive
  const lower = instructions.toLowerCase();
  for (const [key, val] of Object.entries(LAB_TESTS)) {
    if (key.toLowerCase() === lower) return val;
  }
  // Contains match
  for (const [key, val] of Object.entries(LAB_TESTS)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) return val;
  }
  return null;
}

export const LAB_UNITS = ['mg/dL', 'mmol/L', 'mEq/L', 'g/dL', 'g/L', 'U/L', 'IU/L', '%', 'x10³/µL', 'x10⁶/µL', 'fL', 'pg', 'ng/mL', 'µg/mL', 'mIU/L', 'µIU/mL', 'pg/mL', 'pmol/L', 'ng/dL', 'seconds', 'mm/hr', 'mmol/mol', 'CFU/mL', 'mg/L', 'cells/µL', 'Non-Reactive', 'Reactive', 'Negative', 'Positive', 'Not Detected', 'Detected', 'Normal', 'Abnormal'];

export default function LabsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchPid, setSearchPid] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [validateNotice, setValidateNotice] = useState('');

  const isLabTech = user?.role === 'lab_tech' || user?.role === 'admin';

  // All lab orders (for lab techs) or provider-specific
  const { data: allOrders = [], isLoading } = useQuery({
    queryKey: ['lab-orders', isLabTech ? 'all' : 'mine'],
    queryFn: async () => {
      // Lab techs/admin see the full queue; providers only see their own orders.
      const endpoint = isLabTech ? '/lab/orders' : '/provider/lab-orders';
      const r = await nestClient.get(endpoint);
      return r.data;
    },
    refetchInterval: 15000,
  });

  // Update order status (lab tech only)
  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      nestClient.patch(`/lab/orders/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lab-orders'] });
    },
  });

  // Validate an order using the validation algorithm
  const validateOrder = useMutation({
    mutationFn: (id: number) => nestClient.post(`/lab/orders/${id}/validate`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['lab-orders'] });
      setValidateNotice(
        data?.validated
          ? `Order #${data.orderId} validated — ${data.resultCount} result${data.resultCount !== 1 ? 's' : ''}${data.criticalCount ? `, ${data.criticalCount} critical` : ''}.`
          : (data?.reason || 'Unable to validate order.'),
      );
    },
  });

  // One-shot validation of a patient's whole lab group + provider notification.
  const validateGroup = useMutation({
    mutationFn: (pid: string | number) => nestClient.post(`/lab/patients/${pid}/validate-all`, {}),
    onSuccess: (res: any) => {
      const d = res.data || {};
      queryClient.invalidateQueries({ queryKey: ['lab-orders'] });
      queryClient.invalidateQueries({ queryKey: ['all-lab-orders'] });
      queryClient.invalidateQueries({ queryKey: ['provider-lab-orders'] });
      queryClient.invalidateQueries({ queryKey: ['provider-lab-notifications'] });
      setValidateNotice(
        d.validated
          ? `Group validated — ${d.validated} order${d.validated !== 1 ? 's' : ''}, ${d.resultCount} result${d.resultCount !== 1 ? 's' : ''}. ` +
            (d.notified ? `Provider #${d.provider} notified.` : 'No provider on file to notify.')
          : (d.reason || 'Unable to validate group.'),
      );
    },
  });

  // Filter orders
  const filteredOrders = useMemo(() => {
    let list = allOrders;
    if (searchPid) {
      list = list.filter((o: any) =>
        String(o.patientPid || o.patientId).includes(searchPid) ||
        (o.patientName || '').toLowerCase().includes(searchPid.toLowerCase())
      );
    }
    if (statusFilter !== 'all') {
      list = list.filter((o: any) => o.orderStatus === statusFilter);
    }
    return list;
  }, [allOrders, searchPid, statusFilter]);

  // Smart grouping: all of a patient's labs appear once under their name.
  const groupedOrders = useMemo(() => groupOrdersByPatient(filteredOrders), [filteredOrders]);

  /** Orders in a group with results that can be validated together. */
  const readyToValidate = (g: any) =>
    (g?.orders || []).filter((o: any) => o.hasResults && o.orderStatus === 'completed');

  const canValidateGroup = ['admin', 'lab_tech'].includes(user?.role || '');

  const pendingCount = allOrders.filter((o: any) => o.orderStatus === 'pending' || o.orderStatus === 'collected' || o.orderStatus === 'processing').length;
  const completedCount = allOrders.filter((o: any) => o.orderStatus === 'completed' || o.orderStatus === 'validated').length;

  return (
    <div>
      {/* Header */}
      <div className="rounded-4 p-4 mb-4 text-white position-relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #198754 0%, #0d6efd 50%, #6f42c1 100%)' }}>
        <div className="position-absolute end-0 top-0 opacity-10" style={{ fontSize: '7rem', transform: 'rotate(10deg) translate(20px,-10px)' }}>
          <i className="bi bi-flask"></i>
        </div>
        <div className="position-relative">
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
            <div>
              <h3 className="mb-1 fw-bold"><i className="bi bi-flask me-2"></i>Laboratory Management</h3>
              <p className="mb-0 text-white text-opacity-75 small">
                All lab orders · Auto-refreshes every 15s
              </p>
            </div>
          </div>
          <div className="row g-2 mt-3">
            {[
              { v: allOrders.length, l: 'Total Orders', c: '#ffc107', i: 'bi-clipboard-check' },
              { v: pendingCount, l: 'Pending / In Progress', c: '#fd7e14', i: 'bi-hourglass-split' },
              { v: completedCount, l: 'Completed', c: '#198754', i: 'bi-check-circle' },
            ].map(s => (
              <div className="col-auto" key={s.l}>
                <div className="d-flex align-items-center gap-2 bg-white bg-opacity-15 rounded-pill px-3 py-1">
                  <i className={`bi ${s.i} small`} style={{ color: s.c }}></i>
                  <span className="fw-bold small">{s.v}</span>
                  <span className="small text-white text-opacity-75">{s.l}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="d-flex gap-2 mb-3 flex-wrap">
        <div className="input-group" style={{ maxWidth: '300px' }}>
          <span className="input-group-text bg-white"><i className="bi bi-search"></i></span>
          <input className="form-control form-control-sm" placeholder="Search by PID or patient name..."
            value={searchPid} onChange={e => setSearchPid(e.target.value)} />
        </div>
        <div className="d-flex gap-1 flex-wrap">
          {[
            { key: 'all', label: 'All', icon: 'bi-list', color: '#6c757d' },
            { key: 'pending', label: 'Pending', icon: 'bi-hourglass-split', color: '#fd7e14' },
            { key: 'collected', label: 'Collected', icon: 'bi-droplet', color: '#0dcaf0' },
            { key: 'processing', label: 'Processing', icon: 'bi-cpu', color: '#6f42c1' },
            { key: 'completed', label: 'Completed', icon: 'bi-check-circle', color: '#198754' },
            { key: 'validated', label: 'Validated', icon: 'bi-shield-check', color: '#0d6efd' },
          ].map(f => {
            const count = f.key === 'all' ? allOrders.length : allOrders.filter((o: any) => o.orderStatus === f.key).length;
            return (
              <button key={f.key}
                className={`btn btn-sm rounded-pill d-inline-flex align-items-center gap-1 ${statusFilter === f.key ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setStatusFilter(f.key)}>
                <span className="rounded-circle d-inline-flex align-items-center justify-content-center"
                  style={{ width: '18px', height: '18px', fontSize: '0.6rem', fontWeight: 700, background: f.color, color: '#fff' }}>
                  {count}
                </span>
                <i className={`bi ${f.icon}`}></i>{f.label}
              </button>
            );
          })}
        </div>
        <span className="badge bg-secondary rounded-pill ms-auto d-flex align-items-center">
          {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''}
        </span>
      </div>

      {validateNotice && (
        <div className={`alert py-2 small rounded-3 d-flex align-items-center gap-2 ${validateNotice.startsWith('Order') ? 'alert-success' : 'alert-warning'}`}>
          <i className={`bi ${validateNotice.startsWith('Order') ? 'bi-check-circle' : 'bi-exclamation-triangle'}`}></i>
          <span>{validateNotice}</span>
          <button className="btn btn-link btn-sm p-0 ms-auto text-decoration-none" onClick={() => setValidateNotice('')}>✕</button>
        </div>
      )}

      <div className="row g-3">
        {/* Orders List */}
        <div className="col-12">
          <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
            <div className="card-header bg-white d-flex justify-content-between py-3"
              style={{ borderRadius: '16px 16px 0 0' }}>
              <h6 className="mb-0 fw-bold">
                <i className="bi bi-clipboard-check me-2" style={{ color: '#198754' }}></i>
                {statusFilter === 'all' ? 'All Lab Orders' : `${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} Orders`}
              </h6>
            </div>
            <div className="card-body p-0" style={{ maxHeight: '600px', overflowY: 'auto' }}>
              {isLoading ? (
                <div className="text-center py-5"><span className="spinner-border text-primary"></span></div>
              ) : (
                <table className="table table-hover small mb-0">
                  <thead className="table-light sticky-top">
                    <tr>
                      <th>ID</th><th>Test / Order</th><th>Specimen</th><th>Date</th><th>Priority</th><th>Status</th><th>Billing</th>
                      {isLabTech && <th>Action</th>}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedOrders.map((g: any) => {
                      const color = g.hasStat ? '#dc3545' : g.pendingCount > 0 ? '#fd7e14' : g.completedCount === g.count ? '#198754' : '#0d6efd';
                      const initials = g.patientName?.split(' ').map((w: string) => w[0]).join('').slice(0, 2) || 'P';
                      return (
                      <Fragment key={g.key}>
                        {/* Patient card — fluid, color-coded for visibility */}
                        <tr>
                          <td colSpan={isLabTech ? 9 : 8} className="p-1" style={{ background: 'transparent', border: 'none' }}>
                            <div className="d-flex align-items-center gap-2 px-3 py-2"
                              style={{ borderRadius: '10px', background: `linear-gradient(90deg, ${color}1f, ${color}05)`, borderLeft: `4px solid ${color}` }}>
                              <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                                style={{ width: '34px', height: '34px', backgroundColor: `${color}24` }}>
                                <span className="fw-bold" style={{ color, fontSize: '0.8rem' }}>{initials}</span>
                              </div>
                              <div className="flex-grow-1 min-w-0">
                                <div className="fw-bold small text-truncate" style={{ color }}>{g.patientName}</div>
                                <small className="text-muted">PID {g.patientPid ?? g.patientId} · {g.count} test{g.count !== 1 ? 's' : ''}</small>
                              </div>
                              {g.hasStat && (
                                <span className="badge bg-danger rounded-pill" style={{ fontSize: '0.6rem' }}>
                                  <i className="bi bi-exclamation-triangle me-1"></i>STAT
                                </span>
                              )}
                              {g.pendingCount > 0 && (
                                <span className="badge rounded-pill" style={{ backgroundColor: '#fd7e14', color: '#fff', fontSize: '0.6rem' }}>{g.pendingCount} pending</span>
                              )}
                              {readyToValidate(g).length > 0 && (
                                <button
                                  className="btn btn-primary btn-sm rounded-pill py-0"
                                  style={{ fontSize: '0.65rem' }}
                                  title="Preview and validate every ready order for this patient in one shot, then notify the provider"
                                  disabled={validateGroup.isPending || !canValidateGroup}
                                  onClick={() => validateGroup.mutate(g.patientPid ?? g.patientId)}>
                                  <i className="bi bi-check2-square me-1"></i>
                                  Validate group ({readyToValidate(g).length})
                                </button>
                              )}
                              {g.orders.some((o: any) => o.orderStatus === 'duplicate') && (
                                <span className="badge bg-danger rounded-pill" style={{ fontSize: '0.6rem' }}>
                                  <i className="bi bi-exclamation-octagon me-1"></i>DUPLICATE
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {g.orders.map((o: any) => {
                          const statusMap: Record<string, { label: string; color: string }> = {
                            pending: { label: 'Pending', color: '#fd7e14' },
                            collected: { label: 'Collected', color: '#0dcaf0' },
                            processing: { label: 'Processing', color: '#6f42c1' },
                            completed: { label: 'Completed', color: '#198754' },
                            validated: { label: 'Validated', color: '#0d6efd' },
                            rejected: { label: 'Rejected', color: '#dc3545' },
                            referred: { label: 'Referred', color: '#ffc107' },
                            duplicate: { label: 'Duplicate', color: '#dc3545' },
                          };
                          const statusInfo = statusMap[String(o.orderStatus)] || { label: o.orderStatus, color: '#6c757d' };

                          return (
                            <tr key={o.id} className={selectedOrder === o.id ? 'table-active' : ''}
                              style={{
                                borderLeft: o.hasResults ? '4px solid #198754' : o.orderStatus === 'duplicate' ? '4px solid #dc3545' : '4px solid transparent',
                                backgroundColor: o.hasResults ? '#f0fdf4' : o.orderStatus === 'duplicate' ? '#fff5f5' : undefined,
                              }}>
                              <td><code className="small">{o.id}</code></td>
                              <td>
                                <small className="fw-semibold">{o.instructions || 'Lab test'}</small>
                                <br /><small className="text-muted" style={{ fontSize: '0.6rem' }}>{o.orderStatus}</small>
                              </td>
                              <td>
                                {o.specimenId ? (
                                  <code className="small text-success">{o.specimenId}</code>
                                ) : (
                                  <span className="text-muted" style={{fontSize:'0.65rem'}}>—</span>
                                )}
                                <div className="mt-1"><Barcode seed={o.specimenId || `LAB-${o.id}`} width={84} height={24} /></div>
                              </td>
                              <td className="text-muted" style={{whiteSpace:'nowrap'}}>
                                {formatDateHuman(o.dateOrdered)}
                              </td>
                              <td>
                                <span className={`badge rounded-pill ${o.orderPriority === 'stat' ? 'bg-danger' : o.orderPriority === 'fasting' ? 'bg-info' : 'bg-light text-dark'}`}
                                  style={{ fontSize: '0.65rem' }}>
                                  {o.orderPriority || 'routine'}
                                </span>
                              </td>
                              <td>
                                <span className="badge rounded-pill" style={{
                                  backgroundColor: statusInfo.color,
                                  color: '#fff', fontSize: '0.65rem',
                                }}>
                                  {statusInfo.label}
                                  {o.hasResults && <i className="bi bi-check-circle ms-1"></i>}
                                </span>
                              </td>
                              <td>
                                {!canViewFinancials(user) ? (
                                  <span className="badge bg-light text-muted border" style={{ fontSize: '0.65rem' }}>xxxx</span>
                                ) : !o.patient_charges_usd ? (
                                  <span className="badge bg-light text-muted border" style={{ fontSize: '0.65rem' }}>—</span>
                                ) : o.paid ? (
                                  <span className="badge bg-success" style={{ fontSize: '0.65rem' }}><i className="bi bi-check-circle me-1"></i>Paid</span>
                                ) : (
                                  <span className="badge bg-warning text-dark" style={{ fontSize: '0.65rem' }}>${Number(o.patient_balance_usd || 0).toFixed(2)} owed</span>
                                )}
                              </td>
                              {isLabTech && (
                                <td>
                                  {o.orderStatus === 'duplicate' ? (
                                    <button className="btn btn-outline-danger btn-sm py-0 px-2 rounded-pill"
                                      style={{ fontSize: '0.6rem', whiteSpace: 'nowrap' }}
                                      onClick={() => updateStatus.mutate({ id: o.id, status: 'pending' })}
                                      disabled={updateStatus.isPending}
                                      title="Keep this order — override duplicate">
                                      <i className="bi bi-shield-check me-1"></i>Override (Keep)
                                    </button>
                                  ) : o.orderStatus === 'completed' ? (
                                    <button className="btn btn-outline-primary btn-sm py-0 px-2 rounded-pill"
                                      style={{ fontSize: '0.6rem', whiteSpace: 'nowrap' }}
                                      onClick={() => validateOrder.mutate(o.id)}
                                      disabled={validateOrder.isPending}
                                      title="Run validation algorithm">
                                      <i className="bi bi-shield-check me-1"></i>Validate
                                    </button>
                                  ) : o.orderStatus === 'validated' ? (
                                    <button className="btn btn-outline-success btn-sm py-0 px-2 rounded-pill"
                                      style={{ fontSize: '0.6rem', whiteSpace: 'nowrap' }}
                                      onClick={() => updateStatus.mutate({ id: o.id, status: 'completed' })}
                                      disabled={updateStatus.isPending}
                                      title="Re-open this order for re-validation">
                                      <i className="bi bi-arrow-counterclockwise me-1"></i>Re-open
                                    </button>
                                  ) : o.orderStatus === 'pending' ? (
                                    <button className="btn btn-outline-info btn-sm py-0 px-2 rounded-pill"
                                      style={{ fontSize: '0.6rem', whiteSpace: 'nowrap' }}
                                      onClick={() => updateStatus.mutate({ id: o.id, status: 'collected' })}
                                      disabled={updateStatus.isPending}
                                      title="Mark sample as collected">
                                      <i className="bi bi-droplet me-1"></i>Collect
                                    </button>
                                  ) : o.orderStatus === 'collected' ? (
                                    <button className="btn btn-outline-secondary btn-sm py-0 px-2 rounded-pill"
                                      style={{ fontSize: '0.6rem', whiteSpace: 'nowrap' }}
                                      onClick={() => updateStatus.mutate({ id: o.id, status: 'processing' })}
                                      disabled={updateStatus.isPending}
                                      title="Move to processing">
                                      <i className="bi bi-cpu me-1"></i>Process
                                    </button>
                                  ) : null}
                                </td>
                              )}
                              <td>
                                {['collected', 'processing', 'completed', 'validated'].includes(o.orderStatus) ? (
                                  <button className="btn btn-outline-primary btn-sm py-0 px-2 rounded-pill"
                                    style={{ fontSize: '0.65rem', whiteSpace: 'nowrap' }}
                                    title="Open the lab result form for this order"
                                    onClick={() => setSelectedOrder(o.id === selectedOrder ? null : o.id)}>
                                    {o.id === selectedOrder
                                      ? 'Hide'
                                      : (o.orderStatus === 'completed' || o.orderStatus === 'validated')
                                        ? 'View Results'
                                        : (isLabTech ? 'Enter Results' : 'View Results')}
                                  </button>
                                ) : (
                                  <small className="text-muted">—</small>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                      );
                    })}
                    {filteredOrders.length === 0 && (
                      <tr><td colSpan={isLabTech ? 9 : 8} className="text-center text-muted py-4">
                        <i className="bi bi-inbox me-1"></i>
                        {statusFilter !== 'all'
                          ? `No ${statusFilter} orders found`
                          : searchPid ? 'No orders match your search' : 'No lab orders yet'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Results Panel - the patient lab result form, inline for this order */}
        {selectedOrder && (() => {
          const sel = allOrders.find((o: any) => o.id === selectedOrder);
          const pid = String(sel?.patientPid ?? sel?.patientId ?? '');
          return (
            <div className="col-12">
              <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                <div className="card-header bg-white d-flex justify-content-between py-3"
                  style={{ borderRadius: '16px 16px 0 0' }}>
                  <h6 className="mb-0 fw-bold">
                    <i className="bi bi-file-earmark-text me-2" style={{ color: '#6f42c1' }}></i>
                    Lab Result Form — Order #{selectedOrder}
                  </h6>
                  <button className="btn btn-outline-secondary btn-sm rounded-pill"
                    onClick={() => setSelectedOrder(null)}>
                    <i className="bi bi-x"></i>
                  </button>
                </div>
                <div className="card-body">
                  <LabResultEntry
                    key={`order-${selectedOrder}`}
                    orderId={selectedOrder}
                    patientPid={pid}
                    panelLabel={sel?.instructions || 'Custom'}
                  />
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
