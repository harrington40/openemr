import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PatientsService } from './patients.service';
import { PatientPortalService } from '../patient-portal/patient-portal.service';

/**
 * Public patient portal endpoints (no staff JWT required).
 *
 * Registration creates the patient record and issues a portal password, shown
 * once for the desk to hand over. Login exchanges the Patient ID and that
 * password for a short-lived portal token, which is then used to fetch the
 * patient's own records.
 *
 * The password took the place of date of birth as the credential. DOB was the
 * only check before, and patient IDs are sequential (RX-2608-00001), so knowing
 * or guessing an ID was enough to read a chart. DOB is still verified when it is
 * supplied, but it is no longer the thing standing in the way.
 */
@Controller('portal')
export class PortalController {
  constructor(
    private readonly patients: PatientsService,
    private readonly portal: PatientPortalService,
    private readonly jwtService: JwtService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Post('register')
  async register(@Body() dto: any) {
    const fname = String(dto.fname || '').trim();
    const lname = String(dto.lname || '').trim();
    if (!fname || !lname) {
      throw new BadRequestException('First and last name are required');
    }

    // Security measure: reject duplicate registrations before creating a new
    // record. A strong match (same name + DOB, or same phone) is blocked so a
    // patient cannot create multiple portal records for the same identity.
    const existing = await this.patients.findDuplicates(
      fname,
      lname,
      dto.DOB || '',
      dto.phone_contact || '',
    );
    const strongMatch = (existing || []).filter((p: any) => {
      const dobMatch = dto.DOB && p.DOB ? String(p.DOB).slice(0, 10) === dto.DOB : false;
      const nameMatch = `${p.fname} ${p.lname}`.toLowerCase().includes(fname.toLowerCase()) ||
        `${p.fname} ${p.lname}`.toLowerCase().includes(lname.toLowerCase());
      const phoneMatch = (dto.phone_contact || '').replace(/\D/g, '').length >= 6 &&
        String(p.phone_contact || '').replace(/\D/g, '') === (dto.phone_contact || '').replace(/\D/g, '');
      return (dobMatch && nameMatch) || phoneMatch;
    });
    if (strongMatch.length) {
      throw new ConflictException(
        'A patient record with these details already exists. Please sign in to the portal with your Patient ID, or contact the hospital for help.',
      );
    }

    const created = await this.patients.create(dto, 'Patient Portal');

    // Issue the portal password. This response is the only place the plaintext
    // exists — only a bcrypt hash is kept, so it cannot be looked up later.
    // `firstLogin` tells the portal to force a change before showing records.
    const credentials = await this.portal.issuePassword(created.pid);

    return {
      publicId: created.publicId,
      pid: created.pid,
      name: `${fname} ${lname}`,
      password: credentials.password,
      firstLogin: true,
      note: 'Write this password down now — it cannot be shown again. You will be asked to change it when you first sign in.',
    };
  }

  @Post('login')
  async login(@Body() body: { publicId?: string; password?: string; dob?: string }) {
    const publicId = String(body.publicId || '').trim();
    const password = String(body.password || '');

    if (!publicId || !password) {
      throw new BadRequestException('Patient ID and password are required');
    }

    const rows = await this.patients.findByPublicId(publicId);

    // One message for every failure below — unknown Patient ID, no portal
    // account, wrong password, locked account. Distinguishing them would let an
    // anonymous caller confirm which Patient IDs exist, and IDs are sequential.
    const invalid = new UnauthorizedException('Patient ID or password is incorrect.');

    if (!rows.length) throw invalid;
    const p = rows[0];

    if (!(await this.portal.verify(p.pid, password))) throw invalid;

    // DOB is checked after the password, so it adds a second factor for a
    // legitimate patient without being the only thing protecting the record.
    const toDateOnly = (d: any): string => {
      if (!d) return '';
      const dt = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(dt.getTime())) return '';
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const patientDob = toDateOnly(p.DOB);
    if (body.dob && patientDob !== body.dob) {
      throw new UnauthorizedException('Date of birth does not match our records.');
    }

    // Read from the database rather than trusting a claim in the request, so a
    // password changed mid-session is reflected immediately.
    const mustChangePassword = await this.portal.mustChangePassword(p.pid);

    const token = this.jwtService.sign({
      sub: p.pid,
      role: 'patient',
      publicId: p.public_id,
      name: `${p.fname} ${p.lname}`,
      dob: patientDob,
      must_change_password: mustChangePassword,
    });

    return {
      token,
      pid: p.pid,
      publicId: p.public_id,
      name: `${p.fname} ${p.lname}`,
      dob: patientDob,
      mustChangePassword,
    };
  }

  /**
   * Replaces the portal password.
   *
   * The current password is required even though the caller already holds a
   * valid token — a token left on an unlocked workstation must not be enough to
   * take the account over.
   */
  @Post('change-password')
  async changePassword(@Req() req: any, @Body() body: { currentPassword?: string; newPassword?: string }) {
    const pid = this.verifyPortalToken(req);
    await this.portal.changePassword(pid, String(body.currentPassword || ''), String(body.newPassword || ''));
    return {
      message: 'Password updated. Sign in with your new password next time.',
      mustChangePassword: false,
    };
  }

  @Get('records')
  async records(@Req() req: any) {
    const pid = this.verifyPortalToken(req);

    // A password issued at the desk is a one-login credential. Until it is
    // replaced this session can change the password but cannot read the chart —
    // otherwise a password someone else has seen would keep working.
    if (await this.portal.mustChangePassword(pid)) {
      throw new ForbiddenException('Change your password before viewing your records.');
    }

    const [appointments, medications, vitals, allergies, conditions, procedures] =
      await Promise.all([
        this.dataSource.query(
          `SELECT pc_eid, pc_eventDate, pc_startTime, pc_endTime, pc_title, pc_apptstatus
           FROM openemr_postcalendar_events WHERE pc_pid = ? ORDER BY pc_eventDate DESC LIMIT 50`,
          [pid],
        ),
        this.dataSource.query(
          `SELECT id, drug, dosage, quantity, route, refills, start_date, end_date, active, note
           FROM prescriptions WHERE patient_id = ? AND active = 1 ORDER BY start_date DESC LIMIT 50`,
          [pid],
        ),
        this.dataSource.query(
          `SELECT id, date, bps, bpd, pulse, respiration, temperature, oxygen_saturation, weight, height, bmi
           FROM form_vitals WHERE pid = ? ORDER BY date DESC LIMIT 50`,
          [pid],
        ),
        this.dataSource.query(
          `SELECT id, title AS allergen, comments AS reaction, date
           FROM lists WHERE pid = ? AND type = 'allergy' AND activity = 1 ORDER BY date DESC LIMIT 50`,
          [pid],
        ),
        this.dataSource.query(
          `SELECT id, title AS diagnosis, comments AS note, date
           FROM lists WHERE pid = ? AND type = 'medical_problem' ORDER BY date DESC LIMIT 50`,
          [pid],
        ),
        this.dataSource.query(
          `SELECT procedure_order_id AS id, date_ordered, order_status, patient_instructions
           FROM procedure_order WHERE patient_id = ? ORDER BY date_ordered DESC LIMIT 50`,
          [pid],
        ),
      ]);

    return {
      appointments,
      medications,
      vitals,
      allergies,
      conditions,
      procedures,
    };
  }

  private verifyPortalToken(req: any): number {
    const auth = String(req.headers?.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) throw new UnauthorizedException('Not authenticated');
    try {
      const payload = this.jwtService.verify(token);
      if (payload?.role !== 'patient' || !payload?.sub) {
        throw new Error('Not a patient session');
      }
      return Number(payload.sub);
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }
}
