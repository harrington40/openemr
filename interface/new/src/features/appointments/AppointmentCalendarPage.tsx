import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAppointments, deleteAppointment } from '../../api/endpoints/appointments';
import type { Appointment } from '../../types/appointment';
import { APPOINTMENT_STATUS_COLORS } from '../../types/appointment';
import AppointmentCreateModal from './AppointmentCreateModal';
import { formatPatientNameLastFirst } from '../../utils/patientName';
import { formatDateOnly, toDateInput } from '../../utils/date';

function getWeekDates(date: Date): Date[] {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay()); // Start from Sunday
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
}

/**
 * The `YYYY-MM-DD` key for a calendar cell — the *local* day the cell shows.
 *
 * This used `d.toISOString().split('T')[0]`, which converts to UTC first: for a
 * browser at UTC+2 the cell for the 28th produced the key `2026-09-27`, so every
 * column was labelled with the previous day's key.
 */
export function calendarDayKey(d: Date): string {
  return toDateInput(d);
}

/**
 * The `YYYY-MM-DD` key an appointment belongs under.
 *
 * Prefer the API's `eventDateStr` (a `DATE_FORMAT(pc_eventDate, '%Y-%m-%d')`,
 * so already the calendar day the appointment was filed on). `pc_eventDate`
 * crosses the wire as a JS Date, e.g. a 2026-09-17 appointment arriving as
 * `"2026-09-16T22:00:00.000Z"` — slicing that gives the wrong day, which is why
 * it is only a fallback for endpoints that do not send `eventDateStr`.
 */
export function appointmentDayKey(apt: Pick<Appointment, 'eventDateStr' | 'pc_eventDate'>): string {
  const fromApi = (apt.eventDateStr || '').trim();
  if (fromApi) return fromApi.slice(0, 10);
  const raw = (apt.pc_eventDate || '').trim();
  if (!raw) return '';
  return formatDateOnly(raw);
}

/**
 * Group appointments under `appointmentDayKey`.
 *
 * Grouping on the raw `pc_eventDate` while looking up by a `YYYY-MM-DD` cell key
 * meant the two never matched and the week grid rendered no appointments at all.
 */
export function groupAppointmentsByDay(
  appointments: Appointment[],
): Record<string, Appointment[]> {
  const byDay: Record<string, Appointment[]> = {};
  for (const apt of appointments) {
    const key = appointmentDayKey(apt);
    if (!key) continue;
    (byDay[key] ||= []).push(apt);
  }
  return byDay;
}

function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function isToday(d: Date): boolean {
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

function getStatusBadge(status: string | undefined): string {
  return APPOINTMENT_STATUS_COLORS[status ?? ''] ?? 'bg-secondary';
}

const CATEGORY_COLORS: Record<number, { bg: string; text: string }> = {
  5: { bg: '#cfe2ff', text: '#084298' },  // Office Visit - light blue
  4: { bg: '#d1e7dd', text: '#0a3622' },  // green
  3: { bg: '#fff3cd', text: '#664d03' },  // yellow
  2: { bg: '#f8d7da', text: '#58151c' },  // red
  1: { bg: '#e2d9f3', text: '#3a1d6e' },  // purple
};

function getCategoryStyle(catid?: number) {
  const c = CATEGORY_COLORS[catid || 5] || CATEGORY_COLORS[5];
  return { backgroundColor: c.bg, color: c.text, borderLeft: `4px solid ${c.text}` };
}

const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 7 AM to 7 PM

export default function AppointmentCalendarPage() {
  const queryClient = useQueryClient();
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    return start;
  });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>('');

  const weekDates = useMemo(() => getWeekDates(currentWeekStart), [currentWeekStart]);
  const startDate = calendarDayKey(weekDates[0]);
  const endDate = calendarDayKey(weekDates[6]);

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ['appointments', startDate, endDate],
    queryFn: () => getAppointments({ startDate, endDate }),
  });

  // Grouped by local calendar day, via the same key the cells look up by.
  const appointmentsByDate = useMemo(() => groupAppointmentsByDay(appointments), [appointments]);

  const deleteMutation = useMutation({
    mutationFn: ({ pid, eid }: { pid: string; eid: number }) =>
      deleteAppointment(pid, eid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });

  const navigateWeek = (direction: -1 | 1) => {
    setCurrentWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + direction * 7);
      return next;
    });
  };

  const goToToday = () => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    setCurrentWeekStart(start);
  };

  const handleSlotClick = (date: string) => {
    setSelectedDate(date);
    setShowCreateModal(true);
  };

  return (
    <div className="glass-page position-relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #dbeafe 0%, #f5faff 45%, #d1fae5 100%)', borderRadius: '20px', minHeight: '100vh', padding: '16px' }}>
      <div className="position-absolute rounded-circle" style={{ width: '340px', height: '340px', top: '-80px', right: '-60px', background: 'radial-gradient(circle, rgba(13,110,253,0.30), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <div className="position-absolute rounded-circle" style={{ width: '400px', height: '400px', bottom: '8%', left: '-120px', background: 'radial-gradient(circle, rgba(0,201,167,0.30), transparent 70%)', filter: 'blur(20px)', zIndex: 0 }}></div>
      <style>{`
        .glass-page .card {
          position: relative;
          z-index: 1;
          background: rgba(255,255,255,0.60) !important;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.9) !important;
          box-shadow: 0 22px 45px rgba(10,37,64,0.20), 0 6px 14px rgba(10,37,64,0.10) !important;
          transition: transform .25s ease, box-shadow .25s ease, background .25s ease;
        }
        .glass-page .card:hover {
          transform: translateY(-5px);
          background: rgba(255,255,255,0.70) !important;
          box-shadow: 0 30px 60px rgba(10,37,64,0.28), 0 10px 20px rgba(10,37,64,0.14) !important;
        }
        .glass-page .card .card-header,
        .glass-page .card-header {
          background: rgba(255,255,255,0.35) !important;
          border-bottom: 1px solid rgba(255,255,255,0.6) !important;
        }
        .glass-page .table thead.table-light {
          background: rgba(255,255,255,0.35) !important;
        }
      `}</style>
      {/* Header */}
      <div className="rounded-4 p-4 mb-4 text-white" style={{background:'linear-gradient(135deg, #0d6efd 0%, #0dcaf0 50%, #6610f2 100%)'}}>
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <h2 className="mb-1 fw-bold"><i className="bi bi-calendar-event me-2"></i>Appointments</h2>
            <p className="mb-0 text-white text-opacity-75 small">
              {formatDisplayDate(weekDates[0])} — {formatDisplayDate(weekDates[6])} · {appointments.length} appointments
            </p>
          </div>
          <div className="d-flex gap-2">
            <button className="btn btn-light btn-sm rounded-pill" onClick={goToToday}>Today</button>
            <button className="btn btn-outline-light btn-sm rounded-pill" onClick={() => navigateWeek(-1)}><i className="bi bi-chevron-left"></i></button>
            <button className="btn btn-outline-light btn-sm rounded-pill" onClick={() => navigateWeek(1)}><i className="bi bi-chevron-right"></i></button>
            <button className="btn btn-light btn-sm rounded-pill" onClick={() => { setSelectedDate(calendarDayKey(new Date())); setShowCreateModal(true); }}>
              <i className="bi bi-plus-lg me-1"></i>New
            </button>
          </div>
        </div>
      </div>

      {/* Week header */}
      <div className="mb-3">
        <strong>
          {formatDisplayDate(weekDates[0])} — {formatDisplayDate(weekDates[6])}
        </strong>
      </div>

      {/* Calendar grid */}
      {isLoading ? (
        <div className="text-center p-5">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-bordered mb-0">
                <thead className="table-light">
                  <tr>
                    <th style={{ width: '80px' }}>Time</th>
                    {weekDates.map((date) => (
                      <th
                        key={date.toISOString()}
                        className={isToday(date) ? 'table-primary' : ''}
                      >
                        <div>{date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                        <div className={isToday(date) ? 'fw-bold' : ''}>
                          {date.getDate()}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {HOURS.map((hour) => (
                    <tr key={hour}>
                      <td className="text-muted small align-top" style={{ whiteSpace: 'nowrap' }}>
                        {hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`}
                      </td>
                      {weekDates.map((date) => {
                        const dateStr = calendarDayKey(date);
                        const dayAppts = (appointmentsByDate[dateStr] || []).filter((a) => {
                          const startHour = parseInt(a.pc_startTime?.split(':')[0] || '0', 10);
                          return startHour === hour;
                        });

                        return (
                          <td
                            key={dateStr}
                            className={isToday(date) ? 'table-primary' : ''}
                            style={{ minHeight: '60px', cursor: 'pointer' }}
                            onClick={() => handleSlotClick(dateStr)}
                          >
                            {dayAppts.map((apt) => (
                              <div
                                key={apt.pc_eid}
                                className="card card-body py-1 px-2 mb-1"
                                style={{ cursor: 'pointer' }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="d-flex justify-content-between align-items-start" style={getCategoryStyle(apt.pc_catid)}>
                                  <div className="small p-1 rounded">
                                    <strong>
                                      {apt.fname ? formatPatientNameLastFirst(apt) : `Pt #${apt.pc_pid}`}
                                    </strong>
                                    <br />
                                    <span>{apt.pc_title || 'Appointment'}</span>
                                    {apt.patient_public_id && <><br /><small className="text-muted">{apt.patient_public_id}</small></>}
                                    <br />
                                    <small>
                                      {apt.pc_startTime?.substring(0, 5)}
                                      {apt.pc_endTime ? ` - ${apt.pc_endTime.substring(0, 5)}` : ''}
                                    </small>
                                  </div>
                                  <div className="d-flex flex-column align-items-end gap-1">
                                    <span className={`badge ${getStatusBadge(apt.pc_apptstatus)}`}>
                                      {apt.pc_apptstatus || 'Scheduled'}
                                    </span>
                                    {apt.pc_pid && (
                                      <button
                                        className="btn btn-outline-danger btn-sm py-0 px-1"
                                        title="Delete"
                                        onClick={() => {
                                          if (confirm('Delete this appointment?')) {
                                            deleteMutation.mutate({
                                              pid: String(apt.pc_pid),
                                              eid: apt.pc_eid,
                                            });
                                          }
                                        }}
                                      >
                                        <i className="bi bi-trash"></i>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreateModal && (
        <AppointmentCreateModal
          selectedDate={selectedDate}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
