import { levelMeta } from '../../../utils/triage';

/**
 * The triage level chip. One component so the colour, the wording and the
 * priority band can never drift apart between the board, the chart and a print
 * view — the colour is the part people read from across the room.
 */
export function LevelBadge({
  level,
  showLabel = true,
  size = 'md',
  title,
}: {
  level: number;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
}) {
  const meta = levelMeta(level);
  const fontSize = size === 'lg' ? '1rem' : size === 'sm' ? '0.65rem' : '0.75rem';
  const pad = size === 'lg' ? '0.5rem 0.9rem' : size === 'sm' ? '0.15rem 0.45rem' : '0.3rem 0.65rem';

  return (
    <span
      className="badge rounded-pill d-inline-flex align-items-center gap-1"
      style={{ backgroundColor: meta.color, fontSize, padding: pad, color: level === 3 || level === 4 ? '#1b1b1b' : '#fff' }}
      title={title || `${meta.label} — ${meta.meaning} (target ${meta.targetMinutes === 0 ? 'immediate' : `${meta.targetMinutes} min`})`}
    >
      <i className={`bi ${meta.icon}`}></i>
      {showLabel && <>L{meta.level} {meta.label}</>}
    </span>
  );
}

/** The five-colour legend, so the key is never a matter of memory. */
export function TriageLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div className="d-flex flex-wrap align-items-center gap-2">
      {[1, 2, 3, 4, 5].map((level) => {
        const meta = levelMeta(level);
        return (
          <span key={level} className="d-inline-flex align-items-center gap-1 small text-muted">
            <span className="rounded-circle d-inline-block" style={{ width: 10, height: 10, backgroundColor: meta.color }}></span>
            <span style={{ fontWeight: 600 }}>{meta.label}</span>
            {!compact && <span>· {meta.targetMinutes === 0 ? 'immediate' : `${meta.targetMinutes}m`}</span>}
          </span>
        );
      })}
    </div>
  );
}

export default LevelBadge;
