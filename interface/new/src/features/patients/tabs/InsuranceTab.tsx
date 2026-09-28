import type { Insurance } from '../../../types/insurance';

interface Props {
  insurance: Insurance[];
}

export default function InsuranceTab({ insurance }: Props) {
  if (insurance.length === 0) {
    return (
      <div className="card">
        <div className="card-body text-center text-muted p-4">
          <i className="bi bi-shield-check" style={{ fontSize: '2rem' }}></i>
          <p className="mt-2 mb-0">No insurance records found for this patient.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h5 className="mb-0">
          <i className="bi bi-shield-check me-2"></i>
          Insurance Information
        </h5>
      </div>
      <div className="card-body p-0">
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead className="table-light">
              <tr>
                <th>Type</th>
                <th>Plan Name</th>
                <th>Policy #</th>
                <th>Group #</th>
                <th>Subscriber</th>
                <th>Copay</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {insurance.map((ins) => (
                <tr key={ins.uuid}>
                  <td>
                    <span className="badge bg-secondary">{ins.type}</span>
                  </td>
                  <td>{ins.plan_name || '—'}</td>
                  <td><code>{ins.policy_number || '—'}</code></td>
                  <td><code>{ins.group_number || '—'}</code></td>
                  <td>
                    {ins.subscriber_fname} {ins.subscriber_lname}
                  </td>
                  <td>{ins.copay || '—'}</td>
                  <td>
                    <span className={`badge ${ins.status === 'active' ? 'bg-success' : 'bg-secondary'}`}>
                      {ins.status || 'unknown'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
