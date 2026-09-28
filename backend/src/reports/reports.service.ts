import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class ReportsService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async appointmentStats(startDate?: string, endDate?: string) {
    const params: any[] = [];
    let where = '';
    if (startDate) { where += ' AND pc_eventDate >= ?'; params.push(startDate); }
    if (endDate) { where += ' AND pc_eventDate <= ?'; params.push(endDate); }

    const [rows] = await this.dataSource.query(
      `SELECT COUNT(*) as total, COUNT(DISTINCT pc_pid) as uniquePatients
       FROM openemr_postcalendar_events WHERE 1=1${where}`, params,
    );
    const byStatus = await this.dataSource.query(
      `SELECT pc_apptstatus as status, COUNT(*) as count
       FROM openemr_postcalendar_events WHERE 1=1${where}
       GROUP BY pc_apptstatus`, params,
    );
    return { ...rows, byStatus };
  }

  async encounterStats(startDate?: string, endDate?: string) {
    const params: any[] = [];
    let where = '';
    if (startDate) { where += ' AND date >= ?'; params.push(startDate); }
    if (endDate) { where += ' AND date <= ?'; params.push(endDate); }

    const [rows] = await this.dataSource.query(
      `SELECT COUNT(*) as total, COUNT(DISTINCT pid) as uniquePatients
       FROM form_encounter WHERE 1=1${where}`, params,
    );
    const byClass = await this.dataSource.query(
      `SELECT class_code, COUNT(*) as count FROM form_encounter WHERE 1=1${where}
       GROUP BY class_code`, params,
    );
    return { ...rows, byClass };
  }

  /**
   * Patient report: registration totals, demographics, age bands and the most
   * recent registrations (with the canonical patient id for chart links).
   */
  async patientStats(startDate?: string, endDate?: string) {
    const params: any[] = [];
    let where = '';
    if (startDate) {
      where += ' AND pd.regdate >= ?';
      params.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      where += ' AND pd.regdate <= ?';
      params.push(`${endDate} 23:59:59`);
    }

    const [totals] = await this.dataSource.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN pd.status = 'active' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN pd.regdate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS last30,
              SUM(CASE WHEN YEAR(pd.regdate) = YEAR(CURDATE()) THEN 1 ELSE 0 END) AS thisYear
         FROM patient_data pd WHERE 1=1${where}`,
      params,
    );

    const bySex = await this.dataSource.query(
      `SELECT COALESCE(NULLIF(pd.sex, ''), 'Unknown') AS label, COUNT(*) AS count
         FROM patient_data pd WHERE 1=1${where}
        GROUP BY label ORDER BY count DESC`,
      params,
    );

    const byStatus = await this.dataSource.query(
      `SELECT COALESCE(NULLIF(pd.status, ''), 'Unknown') AS label, COUNT(*) AS count
         FROM patient_data pd WHERE 1=1${where}
        GROUP BY label ORDER BY count DESC`,
      params,
    );

    const ageRows = await this.dataSource.query(
      `SELECT CASE
                WHEN pd.DOB IS NULL THEN 'Unknown'
                WHEN TIMESTAMPDIFF(YEAR, pd.DOB, CURDATE()) < 5  THEN '0-4'
                WHEN TIMESTAMPDIFF(YEAR, pd.DOB, CURDATE()) < 18 THEN '5-17'
                WHEN TIMESTAMPDIFF(YEAR, pd.DOB, CURDATE()) < 40 THEN '18-39'
                WHEN TIMESTAMPDIFF(YEAR, pd.DOB, CURDATE()) < 65 THEN '40-64'
                ELSE '65+'
              END AS label, COUNT(*) AS count
         FROM patient_data pd WHERE 1=1${where}
        GROUP BY label`,
      params,
    );
    const bandOrder = ['0-4', '5-17', '18-39', '40-64', '65+', 'Unknown'];
    const ageBands = bandOrder
      .map((label) => ({
        label,
        count: Number((ageRows as any[]).find((r) => r.label === label)?.count) || 0,
      }))
      .filter((b) => b.count > 0);

    const monthlyRows = await this.dataSource.query(
      `SELECT DATE_FORMAT(pd.regdate, '%Y-%m') AS month, COUNT(*) AS count
         FROM patient_data pd
        WHERE pd.regdate IS NOT NULL${where}
        GROUP BY month ORDER BY month DESC LIMIT 6`,
      params,
    );

    const recentRows = await this.dataSource.query(
      `SELECT pd.id, pd.pid, pd.fname, pd.lname, pd.DOB, pd.sex, pd.status, pd.regdate,
              (SELECT COUNT(*) FROM form_encounter fe WHERE fe.pid = pd.pid) AS visits
         FROM patient_data pd
        WHERE 1=1${where}
        ORDER BY pd.regdate DESC, pd.id DESC
        LIMIT 15`,
      params,
    );

    const num = (v: any) => Number(v) || 0;
    return {
      total: num(totals?.total),
      active: num(totals?.active),
      last30: num(totals?.last30),
      thisYear: num(totals?.thisYear),
      bySex: (bySex as any[]).map((r) => ({ label: r.label, count: num(r.count) })),
      byStatus: (byStatus as any[]).map((r) => ({ label: r.label, count: num(r.count) })),
      ageBands,
      monthly: (monthlyRows as any[]).map((r) => ({ month: r.month, count: num(r.count) })).reverse(),
      recent: (recentRows as any[]).map((r) => ({
        patientId: num(r.id),
        pid: num(r.pid),
        name: `${r.fname || ''} ${r.lname || ''}`.trim() || `PID ${r.pid}`,
        DOB: r.DOB || null,
        sex: r.sex || null,
        status: r.status || null,
        regdate: r.regdate || null,
        visits: num(r.visits),
      })),
    };
  }

  async financialStats() {
    const [txn] = await this.dataSource.query(`SELECT COUNT(*) as transactionCount FROM transactions`);
    const [claims] = await this.dataSource.query(`SELECT COUNT(*) as claimCount FROM claims`);
    const [encounters] = await this.dataSource.query(`SELECT COUNT(*) as encounterCount FROM form_encounter`);
    return { ...txn, ...claims, ...encounters };
  }
}
