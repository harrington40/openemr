import { describe, it, expect } from 'vitest';
import {
  appointmentDayKey,
  calendarDayKey,
  groupAppointmentsByDay,
} from '../features/appointments/AppointmentCalendarPage';
import type { Appointment } from '../types/appointment';

/**
 * The calendar's day keys.
 *
 * Two faults hid here behind each other. `formatDate` used
 * `toISOString().split('T')[0]`, so a cell for the 28th was keyed `2026-09-27` in
 * any browser east of UTC; and appointments were grouped by the raw
 * `pc_eventDate` — which crosses the wire as a JS Date, e.g. a 2026-09-17
 * appointment as `"2026-09-16T22:00:00.000Z"` — while cells looked up by
 * `YYYY-MM-DD`. The two key spaces never intersected, so the week grid rendered
 * no appointments at all.
 *
 * The assertions below hold in every timezone, so the test does not depend on the
 * machine's TZ (a UTC-only test passed while UTC+2 was broken).
 */
const apt = (over: Partial<Appointment> = {}): Appointment => ({
  pc_eid: 44,
  pc_eventDate: '2026-09-16T22:00:00.000Z',
  eventDateStr: '2026-09-17',
  pc_startTime: '08:00:00',
  pc_title: 'Patient Intake',
  ...over,
});

describe('calendarDayKey', () => {
  it('names the local day, at both ends of the day', () => {
    // Local 00:30 and 23:30 on the 28th are both the 28th. `toISOString` broke one
    // of these in every timezone that is not UTC.
    expect(calendarDayKey(new Date(2026, 8, 28, 0, 30))).toBe('2026-09-28');
    expect(calendarDayKey(new Date(2026, 8, 28, 23, 30))).toBe('2026-09-28');
  });

  it('pads single-digit months and days', () => {
    expect(calendarDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('appointmentDayKey', () => {
  it("uses the API's date-only value, not the shifted timestamp", () => {
    expect(appointmentDayKey(apt())).toBe('2026-09-17');
  });

  it('falls back to the timestamp for endpoints without eventDateStr', () => {
    expect(appointmentDayKey({ pc_eventDate: '2026-09-17' } as Appointment)).toBe('2026-09-17');
  });
});

describe('groupAppointmentsByDay', () => {
  it('files an appointment under the key its cell looks up by', () => {
    // The contract that was broken: group with one key, look up with the other.
    const grouped = groupAppointmentsByDay([apt()]);
    const cellForThe17th = calendarDayKey(new Date(2026, 8, 17));

    expect(cellForThe17th).toBe('2026-09-17');
    expect(grouped[cellForThe17th]).toHaveLength(1);
    expect(grouped[cellForThe17th][0].pc_title).toBe('Patient Intake');
  });

  it('keeps several appointments on one day together, in order', () => {
    const grouped = groupAppointmentsByDay([
      apt({ pc_eid: 1, pc_startTime: '08:00:00' }),
      apt({ pc_eid: 2, pc_startTime: '09:00:00' }),
      apt({ pc_eid: 3, eventDateStr: '2026-09-18', pc_eventDate: '2026-09-17T22:00:00.000Z' }),
    ]);

    expect(grouped['2026-09-17'].map((a) => a.pc_eid)).toEqual([1, 2]);
    expect(grouped['2026-09-18'].map((a) => a.pc_eid)).toEqual([3]);
  });

  it('skips an appointment with no usable date instead of keying it "undefined"', () => {
    const grouped = groupAppointmentsByDay([
      apt({ eventDateStr: undefined, pc_eventDate: '' }),
    ]);
    expect(Object.keys(grouped)).toEqual([]);
  });
});
