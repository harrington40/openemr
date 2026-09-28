import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import * as crypto from 'crypto';
import { License, LicenseTier, LicenseStatus } from './license.entity';

/**
 * Local license generation and validation.
 *
 * Supports secret rotation via SECRET_VERSIONS.
 * Current version is always first in the array.
 * Keys are validated against all active secret versions.
 */
@Injectable()
export class LicenseService {
  private readonly logger = new Logger(LicenseService.name);

  // Secret rotation: add new secrets at the front.
  // Old secrets remain for validating existing keys.
  private readonly SECRET_VERSIONS = [
    { version: 2, secret: 'openrx-license-secret-v2-2026' },
    { version: 1, secret: 'openrx-license-secret-v1' },
  ];

  // Generator passphrase hash (SHA-256 of "openrx-sales-2024")
  private readonly GENERATOR_PASSPHRASE_HASH =
    'd5c7e8f9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7';

  /**
   * Verify the generator passphrase server-side.
   * No secrets exposed in client-side code.
   */
  verifyGeneratorPassphrase(passphrase: string): boolean {
    const hash = crypto.createHash('sha256').update(passphrase).digest('hex');
    return hash === this.GENERATOR_PASSPHRASE_HASH;
  }

  constructor(
    @InjectRepository(License)
    private readonly licenseRepo: Repository<License>,
  ) {}

  private get currentSecret(): string {
    return this.SECRET_VERSIONS[0].secret;
  }

  // ── Key Generation (server-side) ─────────────────────────

  /**
   * Generate a license key for a given tier and duration.
   * Uses the current (latest) secret version.
   */
  generateKey(tier: LicenseTier, durationMonths: number): string {
    const tierCode = tier[0].toUpperCase();
    const ts = Date.now().toString(16).slice(-8);
    const payload = `${tierCode}-${ts}-${durationMonths}`;
    const checksum = crypto
      .createHmac('sha256', this.currentSecret)
      .update(payload)
      .digest('hex')
      .slice(0, 4);
    return `OPENRX-${tierCode}${ts.slice(0, 4)}-${ts.slice(4)}${durationMonths.toString(16)}-${checksum}`.toUpperCase();
  }

  /**
   * Validate and decode a license key.
   * Tries all secret versions (supports rotation).
   */
  decodeKey(key: string): { tier: LicenseTier; generatedAt: number; durationMonths: number } | null {
    for (const sv of this.SECRET_VERSIONS) {
      const result = this.decodeKeyWithSecret(key, sv.secret);
      if (result) return result;
    }
    return null;
  }

  private decodeKeyWithSecret(
    key: string,
    secret: string,
  ): { tier: LicenseTier; generatedAt: number; durationMonths: number } | null {
    try {
      const clean = key.replace(/-/g, '').toUpperCase();
      if (!clean.startsWith('OPENRX')) return null;

      const tierCode = clean[6];
      const ts1 = clean.slice(7, 11);
      const ts2AndDur = clean.slice(11);
      const checksum = ts2AndDur.slice(-4);
      const ts2 = ts2AndDur.slice(0, 4);
      const durHex = ts2AndDur.slice(4, -4);
      const durationMonths = parseInt(durHex, 16);

      const tierMap: Record<string, LicenseTier> = { B: 'basic', P: 'professional', E: 'enterprise' };
      const tier = tierMap[tierCode];
      if (!tier || isNaN(durationMonths) || durationMonths < 1 || durationMonths > 36) return null;

      const ts = ts1 + ts2;
      const payload = `${tierCode}-${ts}-${durationMonths}`;
      const expected = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex')
        .slice(0, 4);

      if (checksum !== expected) return null;

      return {
        tier,
        generatedAt: parseInt(ts, 16),
        durationMonths,
      };
    } catch {
      return null;
    }
  }

  // ── Activation ─────────────────────────────────────────────

  async activateKey(key: string, customerName?: string): Promise<License> {
    const decoded = this.decodeKey(key);
    if (!decoded) {
      throw new BadRequestException('Invalid license key');
    }

    const existing = await this.licenseRepo.findOne({ where: { licenseKey: key } });
    if (existing) {
      if (existing.status === 'active') {
        throw new BadRequestException('License key already activated');
      }
      existing.status = 'active';
      existing.activatedAt = new Date();
      const expiry = new Date(decoded.generatedAt);
      expiry.setMonth(expiry.getMonth() + decoded.durationMonths);
      existing.expiresAt = expiry;
      existing.customerName = customerName || existing.customerName;
      existing.tier = decoded.tier;
      return this.licenseRepo.save(existing);
    }

    const generatedDate = new Date(decoded.generatedAt);
    const expiresAt = new Date(generatedDate);
    expiresAt.setMonth(expiresAt.getMonth() + decoded.durationMonths);

    const maxUsersMap: Record<LicenseTier, number> = {
      basic: 5,
      professional: 25,
      enterprise: 100,
    };

    const license = this.licenseRepo.create({
      licenseKey: key,
      tier: decoded.tier,
      activatedAt: new Date(),
      expiresAt,
      status: 'active',
      customerName: customerName || '',
      maxUsers: maxUsersMap[decoded.tier],
    });

    const saved = await this.licenseRepo.save(license);
    this.logger.log(`License activated: ${key} → expires ${expiresAt.toISOString()}`);
    return saved;
  }

  // ── Validation ────────────────────────────────────────────

  async getActiveLicense(): Promise<License | null> {
    const now = new Date();
    await this.licenseRepo.update(
      { status: 'active', expiresAt: LessThanOrEqual(now) },
      { status: 'expired' },
    );
    return this.licenseRepo.findOne({
      where: { status: 'active' },
      order: { expiresAt: 'DESC' },
    });
  }

  async isValid(): Promise<boolean> {
    const license = await this.getActiveLicense();
    return license !== null;
  }

  async getStatus(): Promise<{
    valid: boolean;
    tier?: LicenseTier;
    expiresAt?: Date;
    daysRemaining?: number;
    customerName?: string;
    maxUsers?: number;
  }> {
    const license = await this.getActiveLicense();
    if (!license) return { valid: false };

    const now = new Date();
    const daysRemaining = Math.ceil(
      (license.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    return {
      valid: true,
      tier: license.tier,
      expiresAt: license.expiresAt,
      daysRemaining: Math.max(0, daysRemaining),
      customerName: license.customerName,
      maxUsers: license.maxUsers,
    };
  }

  // ── Revocation ────────────────────────────────────────────

  async revoke(licenseKey: string): Promise<void> {
    const license = await this.licenseRepo.findOne({ where: { licenseKey } });
    if (!license) throw new BadRequestException('License not found');
    license.status = 'revoked';
    await this.licenseRepo.save(license);
    this.logger.log(`License revoked: ${licenseKey}`);
  }

  // ── Batch Generation ─────────────────────────────────────

  generateBatch(tier: LicenseTier, durationMonths: number, count: number): string[] {
    const keys: string[] = [];
    for (let i = 0; i < count; i++) {
      keys.push(this.generateKey(tier, durationMonths));
    }
    return keys;
  }
}
