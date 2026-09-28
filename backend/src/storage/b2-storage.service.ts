import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

export interface B2Auth {
  apiUrl: string;
  downloadUrl: string;
  authorizationToken: string;
  accountId: string;
}

export interface B2UploadResult {
  fileId: string;
  fileName: string;
  uploadTimestamp: number;
}

export interface BucketConfig {
  bucketId: string;
  bucketName: string;
}

/**
 * Shared Backblaze B2 storage service.
 * Provides auth, upload, download URL generation, and file deletion
 * for any B2 bucket. Individual domain services (Documents, Avatars,
 * Imaging) inject this service with their specific bucket config.
 */
@Injectable()
export class B2StorageService {
  private readonly logger = new Logger(B2StorageService.name);
  private auth: B2Auth | null = null;
  private authExpires = 0;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  // ── Authentication ──────────────────────────────────────────

  async getAuth(): Promise<B2Auth> {
    if (this.auth && Date.now() < this.authExpires) {
      return this.auth;
    }

    const keyId = this.config.get<string>('B2_KEY_ID');
    const appKey = this.config.get<string>('B2_APP_KEY');

    if (!keyId || !appKey) {
      throw new Error('B2_KEY_ID and B2_APP_KEY must be configured');
    }

    const authHeader = Buffer.from(`${keyId}:${appKey}`).toString('base64');
    const { data } = await firstValueFrom(
      this.http.get(
        'https://api.backblazeb2.com/b2api/v2/b2_authorize_account',
        { headers: { Authorization: `Basic ${authHeader}` } },
      ),
    );

    this.auth = {
      apiUrl: data.apiUrl,
      downloadUrl: data.downloadUrl,
      authorizationToken: data.authorizationToken,
      accountId: data.accountId,
    };
    this.authExpires = Date.now() + 23 * 60 * 60 * 1000; // 23h
    this.logger.log('Backblaze B2 authenticated');
    return this.auth;
  }

  // ── Upload ──────────────────────────────────────────────────

  /**
   * Upload a file buffer to a B2 bucket.
   * @param bucket - bucketId and bucketName
   * @param fileBuffer - raw file bytes
   * @param fileName - safe filename to store in B2
   * @param mimeType - content-type for the file
   */
  async upload(
    bucket: BucketConfig,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<B2UploadResult> {
    const auth = await this.getAuth();

    // Step 1: Get upload URL
    const { data: uploadUrlData } = await firstValueFrom(
      this.http.get(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
        headers: { Authorization: auth.authorizationToken },
        params: { bucketId: bucket.bucketId },
      }),
    );

    // Step 2: Upload file
    const sha1 = crypto.createHash('sha1').update(fileBuffer).digest('hex');
    const { data: uploadData } = await firstValueFrom(
      this.http.post(uploadUrlData.uploadUrl, fileBuffer, {
        headers: {
          Authorization: uploadUrlData.authorizationToken,
          'X-Bz-File-Name': fileName,
          'Content-Type': mimeType || 'application/octet-stream',
          'X-Bz-Content-Sha1': sha1,
        },
      }),
    );

    this.logger.log(`Uploaded to B2: ${fileName} → ${uploadData.fileId}`);
    return {
      fileId: uploadData.fileId,
      fileName: uploadData.fileName,
      uploadTimestamp: uploadData.uploadTimestamp,
    };
  }

  // ── Download URL ────────────────────────────────────────────

  /**
   * Generate a time-limited download authorization URL for a file.
   * @param bucket - bucketId and bucketName
   * @param filePath - full path/filename in B2
   * @param validSeconds - how long the URL is valid (default 300 = 5 min)
   */
  async getDownloadUrl(
    bucket: BucketConfig,
    filePath: string,
    validSeconds: number = 300,
  ): Promise<string> {
    const auth = await this.getAuth();

    const { data } = await firstValueFrom(
      this.http.get(`${auth.apiUrl}/b2api/v2/b2_get_download_authorization`, {
        headers: { Authorization: auth.authorizationToken },
        params: {
          bucketId: bucket.bucketId,
          fileNamePrefix: filePath,
          validDurationInSeconds: validSeconds,
        },
      }),
    );

    return `${auth.downloadUrl}/file/${bucket.bucketName}/${filePath}?Authorization=${data.authorizationToken}`;
  }

  // ── Delete ──────────────────────────────────────────────────

  /**
   * Delete a file from B2.
   */
  async deleteFile(fileId: string, fileName: string): Promise<void> {
    const auth = await this.getAuth();

    await firstValueFrom(
      // The Authorization header is required — without it B2 answers 401
      // "bad_auth_token: Authorization header is missing" and every delete
      // failed, which is why removing an avatar returned a 500.
      this.http.post(
        `${auth.apiUrl}/b2api/v2/b2_delete_file_version`,
        { fileId, fileName },
        { headers: { Authorization: auth.authorizationToken } },
      ),
    );

    this.logger.log(`Deleted from B2: ${fileName}`);
  }

  // ── Generate safe filename ──────────────────────────────────

  generateSafeName(originalName: string, prefix?: string): string {
    const sanitized = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const random = crypto.randomBytes(4).toString('hex');
    const ts = Date.now();
    return prefix
      ? `${prefix}/${ts}-${random}-${sanitized}`
      : `${ts}-${random}-${sanitized}`;
  }
}
