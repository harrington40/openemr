import type { ReactNode } from 'react';
import { formatDateTime } from '../../utils/date';

/**
 * A normalized notification: whatever the source (clinic message, pharmacy
 * alert, patient-flow entry), every surface renders it through the same card +
 * detail-modal pair so the "open the card to see every specific" behaviour is
 * identical everywhere.
 */
export interface FeedItem {
  id: number | string;
  /** Bold first line, e.g. the subject or the patient name. */
  title: string;
  /** Muted second line, e.g. "Room 3 · Checked In". */
  subtitle?: string;
  /** Short muted line shown under the title in the card list. */
  summary?: string;
  at?: string | Date | null;
  by?: string;
  /** Bootstrap icon class, e.g. "bi-envelope". */
  icon: string;
  /** Accent colour used for the icon circle and the modal header. */
  tone: string;
  status?: string;
  unread?: boolean;
  /** Route to open the underlying record, surfaced as a footer button. */
  link?: string;
  linkLabel?: string;
  alerts?: { level: 'danger' | 'warning' | 'info' | 'success'; title: string; lines: string[] }[];
  metrics?: { label: string; value: string | number; color?: string }[];
  fields?: [string, any][];
  lists?: { title: string; lines: string[] }[];
  /** Extra modal body, rendered after the generic sections. */
  extra?: ReactNode;
}

const ALERT_CLASS: Record<string, string> = {
  danger: 'alert-danger',
  warning: 'alert-warning',
  info: 'alert-info',
  success: 'alert-success',
};

const ALERT_ICON: Record<string, string> = {
  danger: 'bi-exclamation-octagon',
  warning: 'bi-exclamation-triangle',
  info: 'bi-info-circle',
  success: 'bi-check-circle',
};

/** Drop empty/absent detail rows so the modal never shows a blank field. */
const presentFields = (fields?: [string, any][]) =>
  (fields || []).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');

/**
 * Compact notification list used at the top of each source page. Clicking a row
 * opens the detail modal; the caller decides what "acknowledge" means.
 */
export function NotificationFeedCard({
  title,
  icon,
  tone,
  items,
  emptyText,
  onOpen,
  onSeeAll,
  max = 4,
}: {
  title: string;
  icon: string;
  tone: string;
  items: FeedItem[];
  emptyText?: string;
  onOpen: (item: FeedItem) => void;
  onSeeAll?: () => void;
  max?: number;
}) {
  const unread = items.filter((i) => i.unread).length;
  const shown = items.slice(0, max);

  return (
    <div className="card shadow-sm mb-3" style={{ borderRadius: '16px', overflow: 'hidden' }}>
      <div className="card-header bg-white d-flex justify-content-between align-items-center py-2">
        <h6 className="mb-0 fw-bold">
          <i className={`bi ${icon} me-2`} style={{ color: tone }}></i>
          {title}
          {unread > 0 && <span className="badge rounded-pill ms-2" style={{ backgroundColor: tone }}>{unread} new</span>}
        </h6>
        {onSeeAll && shown.length > 0 && (
          <button className="btn btn-sm btn-link p-0 text-decoration-none" style={{ fontSize: '0.7rem' }} onClick={onSeeAll}>
            view all <i className="bi bi-arrow-right-short"></i>
          </button>
        )}
      </div>
      <div className="card-body p-0">
        {shown.length === 0 ? (
          <div className="text-muted small text-center py-3">
            <i className="bi bi-check2-circle me-1"></i>
            {emptyText || 'Nothing needing attention'}
          </div>
        ) : (
          shown.map((item) => (
            <div
              key={item.id}
              className="d-flex align-items-center gap-2 px-3 py-2 border-bottom"
              role="button"
              style={{ cursor: 'pointer', background: item.unread ? `${item.tone}0a` : 'transparent' }}
              onClick={() => onOpen(item)}
            >
              <div
                className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                style={{ width: '30px', height: '30px', backgroundColor: item.unread ? `${item.tone}20` : '#6c757d20' }}
              >
                <i className={`bi ${item.icon}`} style={{ color: item.unread ? item.tone : '#6c757d' }}></i>
              </div>
              <div className="flex-grow-1 min-w-0">
                <div className={`small text-truncate ${item.unread ? 'fw-bold' : 'text-muted'}`}>{item.title}</div>
                {item.summary && (
                  <small className="text-muted d-block text-truncate" style={{ fontSize: '0.65rem' }}>{item.summary}</small>
                )}
              </div>
              <small className="text-muted flex-shrink-0" style={{ fontSize: '0.6rem' }}>{formatDateTime(item.at)}</small>
              <i className="bi bi-chevron-right text-muted small"></i>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Full detail view for one notification. Renders the generic sections (alerts,
 * metrics, fields, lists) plus any caller-supplied `extra` block, so a message
 * modal and a pharmacy-hold modal share all of their chrome.
 */
export function NotificationFeedModal({
  item,
  onClose,
  onAck,
  ackPending,
  ackLabel = 'Mark read',
  onNavigate,
}: {
  item: FeedItem | null;
  onClose: () => void;
  onAck?: (item: FeedItem) => void;
  ackPending?: boolean;
  ackLabel?: string;
  onNavigate?: (link: string) => void;
}) {
  if (!item) return null;
  const fields = presentFields(item.fields);
  const lists = (item.lists || []).filter((l) => (l.lines || []).length > 0);

  return (
    <div
      className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
      style={{ background: 'rgba(10,37,64,0.45)', zIndex: 1080, padding: '16px' }}
      onClick={onClose}
    >
      <div
        className="card border-0 shadow-lg"
        style={{ maxWidth: '720px', width: '100%', maxHeight: '88vh', overflow: 'auto', borderRadius: '20px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="card-header text-white d-flex justify-content-between align-items-center py-3"
          style={{ background: `linear-gradient(135deg, ${item.tone}, #0d6efd)`, borderRadius: '20px 20px 0 0' }}
        >
          <div className="min-w-0">
            <h6 className="mb-0 fw-bold text-truncate"><i className={`bi ${item.icon} me-2`}></i>{item.title}</h6>
            <small className="text-white text-opacity-75">
              {[item.subtitle, formatDateTime(item.at), item.by ? `by ${item.by}` : ''].filter(Boolean).join(' · ')}
            </small>
          </div>
          <button className="btn btn-sm btn-outline-light rounded-circle flex-shrink-0" style={{ width: '32px', height: '32px' }} onClick={onClose}>
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <div className="card-body">
          {(item.alerts || []).map((a, i) => (
            <div key={i} className={`alert ${ALERT_CLASS[a.level] || 'alert-info'} py-2 small mb-3`}>
              <strong><i className={`bi ${ALERT_ICON[a.level] || 'bi-info-circle'} me-1`}></i>{a.title}</strong>
              {a.lines.map((l, j) => <div key={j}>• {l}</div>)}
            </div>
          ))}

          {(item.metrics || []).length > 0 && (
            <div className="row g-2 mb-3">
              {(item.metrics || []).map((m) => {
                const c = m.color || '#0d6efd';
                return (
                  <div className="col-6 col-md-4" key={m.label}>
                    <div className="p-2 rounded-3 text-center h-100" style={{ backgroundColor: `${c}12` }}>
                      <div className="fw-bold" style={{ color: c }}>{m.value}</div>
                      <small className="text-muted" style={{ fontSize: '0.6rem' }}>{m.label}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {fields.length > 0 && (
            <ul className="list-unstyled small mb-3">
              {fields.map(([k, v]) => (
                <li key={String(k)} className="mb-1">
                  <span className="text-muted">{k}:</span> <strong>{String(v)}</strong>
                </li>
              ))}
            </ul>
          )}

          {lists.map((l) => (
            <div key={l.title} className="mb-3">
              <h6 className="small fw-bold text-muted text-uppercase">{l.title}</h6>
              <div className="small" style={{ maxHeight: '200px', overflow: 'auto' }}>
                {l.lines.map((line, i) => <div key={i} className="text-muted">• {line}</div>)}
              </div>
            </div>
          ))}

          {item.extra}
        </div>

        <div className="card-footer bg-white d-flex justify-content-end gap-2" style={{ borderRadius: '0 0 20px 20px' }}>
          {item.link && onNavigate && (
            <button className="btn btn-outline-primary btn-sm rounded-pill" onClick={() => onNavigate(item.link as string)}>
              <i className="bi bi-box-arrow-up-right me-1"></i>
              {item.linkLabel || 'Open record'}
            </button>
          )}
          {onAck && item.unread && (
            <button className="btn btn-outline-secondary btn-sm rounded-pill" disabled={ackPending} onClick={() => onAck(item)}>
              <i className="bi bi-check2 me-1"></i>{ackLabel}
            </button>
          )}
          <button className="btn btn-primary btn-sm rounded-pill" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
