import { useQuery } from '@tanstack/react-query';
import nestClient from '../../../api/nest-client';

interface Assessment {
  id: number;
  kind: string;
  summary: string;
  score: number | null;
  level: string | null;
  apgar_1_total: number | null;
  apgar_5_total: number | null;
  detail: any;
  author_name: string | null;
  recorded_at: string;
}

interface Props {
  /** OpenEMR patient pid — assessments are filed against it. */
  pid: string | number;
}

const LEVEL_STYLE = (level?: string | null) => {
  if (level === 'high' || level === 'Severely Depressed') return 'danger';
  if (level === 'moderate' || level === 'Moderately Depressed') return 'warning';
  if (level === 'low' || level === 'Normal') return 'success';
  return 'secondary';
};

export default function MaternityTab({ pid }: Props) {
  const { data: assessments = [], isLoading } = useQuery({
    queryKey: ['midwife-assessments', String(pid)],
    queryFn: async () => {
      const r = await nestClient.get(`/midwife/patients/${pid}/assessments`);
      return r.data as Assessment[];
    },
    enabled: !!pid,
  });

  const kindLabel: Record<string, string> = {
    risk: 'Pregnancy risk',
    edd: 'EDD / dating',
    apgar: 'APGAR',
  };

  return (
    <div className="card">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0">
          <i className="bi bi-clipboard-heart me-2" style={{ color: '#d63384' }}></i>
          Maternity Record
        </h5>
        <span className="badge bg-secondary rounded-pill">{assessments.length}</span>
      </div>
      <div className="card-body p-0">
        {isLoading ? (
          <div className="text-center py-4"><div className="spinner-border spinner-border-sm text-primary"></div></div>
        ) : assessments.length === 0 ? (
          <div className="text-center text-muted p-4">
            <i className="bi bi-clipboard-heart" style={{ fontSize: '2rem' }}></i>
            <p className="mt-2 mb-0 small">
              No maternity assessments recorded. Risk scores, EDDs and APGARs are filed
              here from the Midwife Dashboard.
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.8rem' }}>
              <thead className="table-light">
                <tr><th>When</th><th>Type</th><th>Result</th><th>Detail</th><th>By</th></tr>
              </thead>
              <tbody>
                {assessments.map((a) => {
                  const d = typeof a.detail === 'string' ? safeParse(a.detail) : a.detail;
                  return (
                    <tr key={a.id}>
                      <td className="text-muted">
                        {a.recorded_at ? new Date(a.recorded_at).toLocaleString() : '—'}
                      </td>
                      <td><span className="badge bg-light text-dark border">{kindLabel[a.kind] || a.kind}</span></td>
                      <td>
                        <span className={`text-${LEVEL_STYLE(a.level)} fw-semibold`}>{a.summary}</span>
                      </td>
                      <td className="text-muted" style={{ maxWidth: '320px' }}>
                        {a.kind === 'apgar'
                          ? `1 min ${a.apgar_1_total ?? '—'} · 5 min ${a.apgar_5_total ?? '—'}`
                          : a.kind === 'edd' && d
                            ? `LMP ${d.lmp || '—'} · ${d.gestationWeeks ?? '—'}w ${d.gestationDays ?? '—'}d`
                            : d?.inputs
                              ? `Age ${d.inputs.age} · parity ${d.inputs.parity} · BP ${d.inputs.bpSystolic}/${d.inputs.bpDiastolic} · Hb ${d.inputs.hemoglobin}`
                              : '—'}
                      </td>
                      <td className="text-muted">{a.author_name || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** `detail` is stored as JSON; tolerate either a string or an object. */
function safeParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
