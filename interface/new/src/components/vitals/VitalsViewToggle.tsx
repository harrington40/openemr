/**
 * Which of the vitals views to show. Shared so the patient chart and the triage
 * screening modal offer the same three-way toggle instead of drifting apart.
 */
export type VitalsView = 'chart' | 'table' | 'both';

const OPTIONS: { id: VitalsView; icon: string; label: string }[] = [
  { id: 'chart', icon: 'chart-line', label: 'Chart' },
  { id: 'table', icon: 'table', label: 'Table' },
  { id: 'both', icon: 'layout-split', label: 'Both' },
];

export default function VitalsViewToggle({
  view,
  onChange,
}: {
  view: VitalsView;
  onChange: (view: VitalsView) => void;
}) {
  return (
    <div className="btn-group btn-group-sm" role="group" aria-label="Vitals view">
      {OPTIONS.map(({ id, icon, label }) => (
        <button
          key={id}
          type="button"
          className={`btn ${view === id ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => onChange(id)}
          aria-pressed={view === id}
          title={`${label} view`}
        >
          <i className={`bi bi-${icon} me-1`}></i>
          {label}
        </button>
      ))}
    </div>
  );
}
