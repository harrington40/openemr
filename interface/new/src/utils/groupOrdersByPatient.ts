export interface PatientOrderGroup {
  key: string;
  patientId: number | string;
  patientPid: number | string | null;
  patientName: string;
  orders: any[];
  count: number;
  hasStat: boolean;
  statCount: number;
  pendingCount: number;
  completedCount: number;
  criticalCount: number;
  latestDate: string | null;
}

/**
 * Smart patient grouping for orders (lab orders, procedures, etc.).
 *
 * Collapses many order rows into a single group per patient so a patient's
 * name is shown once, with all of their orders listed beneath it.
 *
 * The sorting algorithm surfaces the most urgent work first:
 *   1. Patients with a STAT order (any critical priority)
 *   2. Patients with the most pending work
 *   3. Most recently ordered first
 */
export function groupOrdersByPatient(orders: any[]): PatientOrderGroup[] {
  const map = new Map<string, PatientOrderGroup>();

  for (const o of orders || []) {
    if (!o) continue;
    const patientId =
      o.patientId ?? o.patient_id ?? o.patientPid ?? o.patient_pid ?? o.pid;
    const key = String(patientId ?? o.id ?? 'unknown');

    let g = map.get(key);
    if (!g) {
      g = {
        key,
        patientId: patientId ?? key,
        patientPid: o.patientPid ?? o.patient_pid ?? o.patientId ?? patientId ?? null,
        patientName:
          o.patientName ||
          (o.fname && o.lname ? `${o.fname} ${o.lname}` : `Patient ${patientId ?? key}`),
        orders: [],
        count: 0,
        hasStat: false,
        statCount: 0,
        pendingCount: 0,
        completedCount: 0,
        criticalCount: 0,
        latestDate: null,
      };
      map.set(key, g);
    }

    g.orders.push(o);
    g.count++;

    const isStat =
      (o.orderPriority || o.priority || '').toLowerCase() === 'stat' ||
      (o.flag === 'critical');

    const isDone =
      o.hasResults === true ||
      ['completed', 'validated'].includes(o.orderStatus || o.status || '') ||
      ['final', 'reviewed'].includes(o.report_status || '');

    if (isStat) {
      g.hasStat = true;
      g.statCount++;
    }
    if (isDone) {
      g.completedCount++;
    } else {
      g.pendingCount++;
    }
    if (o.flag === 'critical' || isStat) {
      g.criticalCount++;
    }

    const d = o.dateOrdered || o.date_ordered || o.date || null;
    if (d && (!g.latestDate || new Date(d) > new Date(g.latestDate))) {
      g.latestDate = d;
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.hasStat !== b.hasStat) return a.hasStat ? -1 : 1;
    if (a.pendingCount !== b.pendingCount) return b.pendingCount - a.pendingCount;
    return String(b.latestDate || '').localeCompare(String(a.latestDate || ''));
  });
}
