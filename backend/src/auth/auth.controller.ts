import { Controller, Post, Body, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';

@Controller('auth')
export class AuthController {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private jwtService: JwtService,
  ) {}

  /**
   * Public self-registration for staff.
   * Creates a user with pending status — admin must approve within 30 days.
   */
  @Post('register')
  async register(@Body() body: {
    username: string; password: string; fname: string; lname: string;
    title?: string; specialty?: string; email?: string; phone?: string;
    physician_type?: string; npi?: string;
  }) {
    const { username, password, fname, lname } = body;
    if (!username || !password || !fname || !lname) {
      throw new BadRequestException('Username, password, first name, and last name are required');
    }
    if (password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    // Check username uniqueness
    const existing = await this.dataSource.query(
      'SELECT id FROM users WHERE BINARY username = ?', [username],
    );
    if (existing.length) {
      throw new BadRequestException('Username already taken');
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = await this.dataSource.query(
      `INSERT INTO users (username, fname, lname, title, specialty, physician_type, npi, email, phone,
        active, registration_status, main_menu_role, password, authorized)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', 'standard', '', 0)`,
      [username, fname, lname, body.title || '', body.specialty || '', body.physician_type || '',
       body.npi || '', body.email || '', body.phone || ''],
    );

    await this.dataSource.query(
      `INSERT INTO users_secure (id, username, password) VALUES (?, ?, ?)`,
      [result.insertId, username, hash],
    );

    return {
      message: 'Registration submitted. An administrator will review your application within 30 days.',
      id: result.insertId,
    };
  }

  @Post('login')
  async login(@Body() body: { username: string; password: string }) {
    const { username, password } = body;

    if (!username || !password) {
      throw new UnauthorizedException('Username and password required');
    }

    const users = await this.dataSource.query(
      'SELECT id, username, fname, lname, active, registration_status, main_menu_role, patient_menu_role, can_edit_providers, can_view_charts, can_edit_charges FROM users WHERE BINARY username = ?',
      [username],
    );

    if (!users.length) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = users[0];

    // Pending registration — not yet approved
    if (user.registration_status === 'pending') {
      throw new UnauthorizedException(
        'Your account is pending approval. An administrator will review it within 30 days.',
      );
    }

    // Rejected
    if (user.registration_status === 'rejected') {
      throw new UnauthorizedException('Your registration has been rejected. Please contact support.');
    }

    // Inactive but approved — admin deactivated
    if (!user.active) {
      throw new UnauthorizedException('Your account has been deactivated. Please contact your administrator.');
    }

    const secure = await this.dataSource.query(
      'SELECT password FROM users_secure WHERE BINARY username = ?',
      [username],
    );

    if (!secure.length) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = bcrypt.compareSync(password, secure[0].password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const displayName = `${user.fname} ${user.lname}`.trim();
    const role = this.mapRole(user.main_menu_role || 'standard');
    const canEditProviders = user.can_edit_providers === 1;
    const canViewCharts = user.can_view_charts === 1;
    const canEditCharges = user.can_edit_charges === 1;

    const payload = {
      sub: user.id,
      username: user.username,
      displayName,
      role,
      main_menu_role: user.main_menu_role || 'standard',
      can_edit_providers: canEditProviders,
      can_view_charts: canViewCharts,
      can_edit_charges: canEditCharges,
    };
    const accessToken = this.jwtService.sign(payload);

    return {
      token: accessToken,
      user: {
        username: user.username,
        displayName,
        role,
        main_menu_role: user.main_menu_role || 'standard',
        can_edit_providers: canEditProviders,
        can_view_charts: canViewCharts,
        can_edit_charges: canEditCharges,
      },
    };
  }

  private mapRole(mainMenuRole: string): string {
    switch (mainMenuRole) {
      case 'standard': return 'physician';
      case 'admin': return 'admin';
      case 'front_office': return 'front_desk';
      case 'nurse': return 'nurse';
      case 'registered_nurse': return 'nurse';
      case 'billing': return 'billing';
      case 'midwife': return 'midwife';
      case 'lab_tech': return 'lab_tech';
      case 'inventory_manager': return 'inventory_manager';
      case 'pharmacist': return 'pharmacist';
      default: return mainMenuRole || 'physician';
    }
  }
}
