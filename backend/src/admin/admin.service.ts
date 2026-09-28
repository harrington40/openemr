import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { MENU_ITEMS, MENU_ROLES } from './menu-items';

@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name);

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(
        `CREATE TABLE IF NOT EXISTS role_menu_permissions (
           role VARCHAR(50) NOT NULL,
           menu_key VARCHAR(120) NOT NULL,
           enabled TINYINT(1) NOT NULL DEFAULT 1,
           PRIMARY KEY (role, menu_key)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
    } catch (err) {
      this.logger.warn(`Could not ensure role_menu_permissions table: ${err}`);
    }

    // Special admin privilege: allowed to create/update/deactivate charges.
    try {
      await this.dataSource.query(
        `ALTER TABLE users ADD COLUMN can_edit_charges TINYINT(1) NOT NULL DEFAULT 0`,
      );
      this.logger.log('Added can_edit_charges column to users');
    } catch { /* column already exists */ }
  }

  // --- Users / Providers ---
  async getUsers() {
    return this.dataSource.query(
      `SELECT id, uuid, username, fname, mname, lname, suffix, title,
              specialty, physician_type, npi, upin, taxonomy, federaldrugid,
              facility, facility_id, calendar, cal_ui, calendar_color,
              email, email_direct, phone, fax, phonew1, phonew2, phonecell,
              street, city, state, zip, organization, assistant,
              state_license_number, weno_prov_id, newcrop_user_role, cpoe,
              active, main_menu_role, can_edit_providers, can_view_charts, can_edit_charges,
              date_created, last_updated
       FROM users ORDER BY lname, fname LIMIT 100`,
    );
  }

  async getUser(id: number) {
    const rows = await this.dataSource.query(
      `SELECT id, uuid, username, fname, mname, lname, suffix, title,
              specialty, physician_type, npi, upin, taxonomy, federaldrugid,
              facility, facility_id, calendar, cal_ui, calendar_color,
              email, email_direct, phone, fax, phonew1, phonew2, phonecell,
              street, city, state, zip, organization, assistant,
              state_license_number, weno_prov_id, newcrop_user_role, cpoe,
              active, date_created, last_updated
       FROM users WHERE id = ?`, [id],
    );
    return rows[0] || null;
  }

  async createUser(dto: any) {
    const result = await this.dataSource.query(
      `INSERT INTO users (
        username, fname, mname, lname, suffix, title,
        specialty, physician_type, npi, upin, taxonomy, federaldrugid,
        facility, facility_id, calendar, cal_ui, calendar_color,
        email, email_direct, phone, fax, phonew1, phonew2, phonecell,
        street, city, state, zip, organization, assistant,
        state_license_number, weno_prov_id, newcrop_user_role, cpoe,
        active, password, authorized, main_menu_role
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        1, '', 0, ?
      )`,
      [
        dto.username || '', dto.fname || '', dto.mname || '', dto.lname || '', dto.suffix || '', dto.title || '',
        dto.specialty || '', dto.physician_type || '', dto.npi || '', dto.upin || '', dto.taxonomy || '207Q00000X', dto.federaldrugid || '',
        dto.facility || '', dto.facility_id || 0, dto.calendar || 0, dto.cal_ui || 1, dto.calendar_color || '#0d6efd',
        dto.email || '', dto.email_direct || '', dto.phone || '', dto.fax || '', dto.phonew1 || '', dto.phonew2 || '', dto.phonecell || '',
        dto.street || '', dto.city || '', dto.state || '', dto.zip || '', dto.organization || '', dto.assistant || '',
        dto.state_license_number || '', dto.weno_prov_id || '', dto.newcrop_user_role || '', dto.cpoe || 0,
        dto.main_menu_role || 'standard',
      ],
    );

    // Also create users_secure record with a default hashed password
    const defaultPassword = dto.password || 'password123';
    const hash = bcrypt.hashSync(defaultPassword, 10);
    await this.dataSource.query(
      `INSERT INTO users_secure (id, username, password) VALUES (?, ?, ?)`,
      [result.insertId, dto.username || '', hash],
    );

    return { id: result.insertId, defaultPassword };
  }

  async updateUser(id: number, dto: any) {
    const fields: Record<string, string> = {
      username: 'username', fname: 'fname', mname: 'mname', lname: 'lname',
      suffix: 'suffix', title: 'title',
      specialty: 'specialty', physician_type: 'physician_type',
      npi: 'npi', upin: 'upin', taxonomy: 'taxonomy', federaldrugid: 'federaldrugid',
      facility: 'facility', facility_id: 'facility_id',
      calendar: 'calendar', cal_ui: 'cal_ui', calendar_color: 'calendar_color',
      email: 'email', email_direct: 'email_direct',
      phone: 'phone', fax: 'fax', phonew1: 'phonew1', phonew2: 'phonew2', phonecell: 'phonecell',
      street: 'street', city: 'city', state: 'state', zip: 'zip',
      organization: 'organization', assistant: 'assistant',
      state_license_number: 'state_license_number', weno_prov_id: 'weno_prov_id',
      newcrop_user_role: 'newcrop_user_role', cpoe: 'cpoe',
      active: 'active', can_edit_providers: 'can_edit_providers',
    };

    const sets: string[] = [];
    const vals: any[] = [];

    for (const [dtoKey, colName] of Object.entries(fields)) {
      if (dto[dtoKey] !== undefined) {
        sets.push(`${colName} = ?`);
        vals.push(dto[dtoKey]);
      }
    }

    if (!sets.length) return;
    vals.push(id);
    await this.dataSource.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);
  }

  // --- Specialties (from list_options) ---
  async getSpecialties() {
    // Physician types (SNOMED-CT coded)
    const physicianTypes = await this.dataSource.query(
      `SELECT option_id, title, codes FROM list_options
       WHERE list_id = 'physician_type' AND activity = 1
       ORDER BY seq`,
    );

    // Provider taxonomy codes (US Core)
    const taxonomyCodes = await this.dataSource.query(
      `SELECT option_id, title FROM list_options
       WHERE list_id = 'us-core-provider-role' AND activity = 1
       ORDER BY title`,
    );

    // Also get distinct specialties already in use
    const existing = await this.dataSource.query(
      `SELECT DISTINCT specialty FROM users WHERE specialty IS NOT NULL AND specialty != '' ORDER BY specialty`,
    );

    return { physicianTypes, taxonomyCodes, existing };
  }

  // --- Facilities ---
  async getFacilities() {
    return this.dataSource.query(
      `SELECT id, name, phone, fax, street, city, state, postal_code
      FROM facility ORDER BY name LIMIT 100`,
    );
  }

  async getFacility(id: number) {
    const rows = await this.dataSource.query(
      `SELECT id, name, phone, fax, street, city, state, postal_code FROM facility WHERE id = ?`, [id],
    );
    return rows[0] || null;
  }

  // --- Documents ---
  async getDocuments(pid?: number) {
    let query = `SELECT id, type, url, name, date, foreign_id AS pid FROM documents WHERE deleted = 0`;
    const params: any[] = [];
    if (pid) { query += ' AND foreign_id = ?'; params.push(pid); }
    query += ' ORDER BY date DESC LIMIT 50';
    return this.dataSource.query(query, params);
  }

  // --- Lists ---
  async getLists() {
    return this.dataSource.query(
      `SELECT id, type, title, date FROM lists ORDER BY date DESC LIMIT 100`,
    );
  }

  // --- Messages ---
  async getMessages() {
    // Join patient_data so the UI can open the chart with the canonical patient
    // id instead of guessing between `id` and `pid` (they are not equal on this
    // schema — patient_data.id = pid + 1), and so pid=0 rows can be detected.
    return this.dataSource.query(
      `SELECT p.id, p.date, p.title, p.body, p.pid, p.user, p.groupname,
              p.message_status, p.assigned_to,
              pd.id  AS patientId,
              pd.pid AS patientPid,
              CONCAT(COALESCE(pd.fname,''), ' ', COALESCE(pd.lname,'')) AS patientName
       FROM pnotes p
       LEFT JOIN patient_data pd ON pd.pid = p.pid
       WHERE p.deleted = 0 AND p.groupname IN ('events', 'Default')
       ORDER BY p.date DESC LIMIT 200`,
    );
  }

  async markMessageRead(id: number) {
    await this.dataSource.query(
      `UPDATE pnotes SET message_status = 'Read' WHERE id = ?`,
      [id],
    );
    return { id, message_status: 'Read' };
  }

  async markAllMessagesRead() {
    await this.dataSource.query(
      `UPDATE pnotes SET message_status = 'Read'
       WHERE deleted = 0 AND message_status = 'New' AND groupname IN ('events', 'Default')`,
    );
    return { updated: true };
  }

  async deleteMessage(id: number) {
    await this.dataSource.query(`UPDATE pnotes SET deleted = 1 WHERE id = ?`, [id]);
    return { id, deleted: true };
  }

  async createMessage(dto: any) {
    const result = await this.dataSource.query(
      `INSERT INTO pnotes (date, title, body, pid, user, groupname, message_status, assigned_to)
       VALUES (NOW(), ?, ?, ?, ?, ?, 'New', ?)`,
      [dto.title || '', dto.body || '', dto.pid || 0, dto.user || 'admin', 'Default', dto.assigned_to || ''],
    );
    return { id: result.insertId };
  }

  // --- Pending Registrations ---

  // --- Codes (CPT/ICD-10) ---
  async getCodes(type?: string) {
    let q = 'SELECT code, code_text, code_type, revenue_code, fee FROM codes';
    const p: any[] = [];
    if (type) { q += ' WHERE code_type = ?'; p.push(parseInt(type)); }
    q += ' ORDER BY code LIMIT 200';
    return this.dataSource.query(q, p);
  }

  async createCode(dto: any) {
    await this.dataSource.query(
      `INSERT INTO codes (code, code_text, code_type, revenue_code, fee) VALUES (?, ?, ?, ?, ?)`,
      [dto.code, dto.code_text || '', parseInt(dto.code_type) || 100, dto.revenue_code || '', parseFloat(dto.fees) || 0],
    );
    return { success: true };
  }

  async updateCode(id: string, dto: any) {
    await this.dataSource.query(
      `UPDATE codes SET code_text = ?, revenue_code = ?, fee = ? WHERE code = ? AND code_type = ?`,
      [dto.code_text || '', dto.revenue_code || '', parseFloat(dto.fees) || 0, id, parseInt(dto.code_type) || 100],
    );
    return { success: true };
  }

  async deleteCode(code: string, codeType: string) {
    await this.dataSource.query('DELETE FROM codes WHERE code = ? AND code_type = ?', [code, parseInt(codeType)]);
    return { success: true };
  }

  async getPendingRegistrations() {
    return this.dataSource.query(
      `SELECT id, username, fname, lname, title, specialty, physician_type, npi, email, phone,
              registration_status, date_created,
              DATEDIFF(DATE_ADD(date_created, INTERVAL 30 DAY), NOW()) as days_until_auto_reject
       FROM users
       WHERE registration_status = 'pending'
       ORDER BY date_created DESC`,
    );
  }

  async approveUser(id: number) {
    await this.dataSource.query(
      `UPDATE users SET registration_status = 'approved', active = 1 WHERE id = ?`, [id],
    );
    return { message: 'User approved and activated' };
  }

  async rejectUser(id: number) {
    await this.dataSource.query(
      `UPDATE users SET registration_status = 'rejected', active = 0 WHERE id = ?`, [id],
    );
    return { message: 'User rejected' };
  }

  async setProviderEditPrivilege(userId: number, enabled: boolean) {
    await this.dataSource.query(
      `UPDATE users SET can_edit_providers = ? WHERE id = ?`,
      [enabled ? 1 : 0, userId],
    );
    return { userId, can_edit_providers: enabled };
  }

  async userHasProviderEditPrivilege(userId: number): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT can_edit_providers FROM users WHERE id = ?`,
      [userId],
    );
    return rows.length > 0 && rows[0].can_edit_providers === 1;
  }

  async setChartViewPrivilege(userId: number, enabled: boolean) {
    await this.dataSource.query(
      `UPDATE users SET can_view_charts = ? WHERE id = ?`,
      [enabled ? 1 : 0, userId],
    );
    return { userId, can_view_charts: enabled };
  }

  /** Grant/revoke the special "edit charges" privilege. */
  async setChargeEditPrivilege(userId: number, enabled: boolean) {
    await this.dataSource.query(
      `UPDATE users SET can_edit_charges = ? WHERE id = ?`,
      [enabled ? 1 : 0, userId],
    );
    return { userId, can_edit_charges: enabled };
  }

  async hasChargeEditPrivilege(userId: number): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT can_edit_charges FROM users WHERE id = ?`,
      [userId],
    );
    return rows.length > 0 && rows[0].can_edit_charges === 1;
  }

  // ── Role-based menu access ─────────────────────────────────────────────

  async getMenuPermissions(): Promise<any> {
    const rows = await this.dataSource.query(
      `SELECT role, menu_key, enabled FROM role_menu_permissions`,
    );
    const disabled = new Set<string>();
    for (const r of rows) {
      if (Number(r.enabled) === 0) disabled.add(`${r.role}:${r.menu_key}`);
    }
    const permissions: Record<string, Record<string, boolean>> = {};
    for (const role of MENU_ROLES) {
      permissions[role] = {};
      for (const item of MENU_ITEMS) {
        permissions[role][item.key] = !disabled.has(`${role}:${item.key}`);
      }
    }
    return { roles: MENU_ROLES, menuItems: MENU_ITEMS, permissions };
  }

  async setMenuPermission(role: string, menuKey: string, enabled: boolean): Promise<void> {
    if (!MENU_ROLES.includes(role)) throw new Error(`Unknown role: ${role}`);
    await this.dataSource.query(
      `INSERT INTO role_menu_permissions (role, menu_key, enabled)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
      [role, menuKey, enabled ? 1 : 0],
    );
  }

  async getMenuPermissionsForRole(role: string): Promise<Record<string, boolean>> {
    const rows = await this.dataSource.query(
      `SELECT menu_key, enabled FROM role_menu_permissions WHERE role = ?`,
      [role],
    );
    const result: Record<string, boolean> = {};
    for (const item of MENU_ITEMS) result[item.key] = true;
    for (const r of rows) {
      if (Number(r.enabled) === 0) result[r.menu_key] = false;
    }
    return result;
  }
}
