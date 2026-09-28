import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { B2StorageService } from '../storage/b2-storage.service';
import { Document, DocumentStatus } from './document.entity';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly b2: B2StorageService,
    private readonly config: ConfigService,
    @InjectRepository(Document)
    private readonly docRepo: Repository<Document>,
  ) {}

  private get bucket() {
    return {
      bucketId: this.config.get<string>('B2_BUCKET_DOCUMENTS_ID') || '',
      bucketName: this.config.get<string>('B2_BUCKET_DOCUMENTS_NAME') || '',
    };
  }

  // ── 4-Digit Code ───────────────────────────────────────────

  generateAccessCode(): string {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  async hashCode(code: string): Promise<string> {
    return bcrypt.hash(code, 8);
  }

  async verifyCode(code: string, hash: string): Promise<boolean> {
    return bcrypt.compare(code, hash);
  }

  // ── Upload ─────────────────────────────────────────────────

  async uploadFile(
    file: any,
    metadata: {
      pid?: number;
      uploadedBy: string;
      uploaderUserId?: number;
      recipientContact?: string;
      recipientName?: string;
      category?: string;
      notes?: string;
    },
  ): Promise<{ document: Document; accessCode: string }> {
    const accessCode = this.generateAccessCode();
    const codeHash = await this.hashCode(accessCode);
    const safeName = this.b2.generateSafeName(file.originalname, 'docs');

    const result = await this.b2.upload(
      this.bucket,
      file.buffer,
      safeName,
      file.mimetype || 'application/octet-stream',
    );

    const doc = this.docRepo.create({
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      b2FileId: result.fileId,
      b2Path: result.fileName,
      accessCodeHash: codeHash,
      plainCode: accessCode,
      pid: metadata.pid || 0,
      uploaderUserId: metadata.uploaderUserId || 0,
      uploadedBy: metadata.uploadedBy,
      recipientContact: metadata.recipientContact || '',
      recipientName: metadata.recipientName || '',
      category: metadata.category || 'general',
      status: 'pending',
      notes: metadata.notes || '',
    });

    const saved = await this.docRepo.save(doc);
    this.logger.log(`Document uploaded to B2: ${saved.id} — code ${accessCode}`);
    return { document: this.sanitizeDocument(saved, true), accessCode };
  }

  // ── List All (admin view, no codes exposed) ────────────────

  async listDocuments(pid?: number): Promise<Document[]> {
    const where: any = {};
    if (pid !== undefined && pid > 0) {
      where.pid = pid;
    }
    const docs = await this.docRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return docs.map((d) => this.sanitizeDocument(d, false));
  }

  // ── My Documents (uploader view, codes exposed) ────────────

  async listMyDocuments(userId: number, pid?: number): Promise<Document[]> {
    const where: any = { uploaderUserId: userId };
    if (pid !== undefined && pid > 0) {
      where.pid = pid;
    }
    const docs = await this.docRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return docs.map((d) => this.sanitizeDocument(d, true));
  }

  // ── Update Status ─────────────────────────────────────────

  async updateStatus(id: number, status: DocumentStatus, userId: number): Promise<Document> {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new BadRequestException('Document not found');
    if (doc.uploaderUserId !== userId) {
      throw new BadRequestException('Only the uploader can update document status');
    }
    doc.status = status;
    const saved = await this.docRepo.save(doc);
    return this.sanitizeDocument(saved, true);
  }

  // ── Verify Code ────────────────────────────────────────────

  async verifyDocumentCode(id: number, code: string): Promise<{ valid: boolean; downloadUrl?: string }> {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) {
      throw new BadRequestException('Document not found');
    }

    const valid = await this.verifyCode(code, doc.accessCodeHash);
    if (!valid) {
      return { valid: false };
    }

    doc.accessCount += 1;
    doc.lastAccessedAt = new Date();
    if (doc.status === 'pending') {
      doc.status = 'accepted';
    }
    await this.docRepo.save(doc);

    const url = await this.b2.getDownloadUrl(this.bucket, doc.b2Path, 300);
    return { valid: true, downloadUrl: url };
  }

  // ── Get Single Document ────────────────────────────────────

  async getDocument(id: number, userId?: number): Promise<Document | null> {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) return null;
    const isOwner = userId !== undefined && doc.uploaderUserId === userId;
    return this.sanitizeDocument(doc, isOwner);
  }

  // ── Get Download URL ───────────────────────────────────────

  async getDocumentDownloadUrl(id: number): Promise<string> {
    const doc = await this.docRepo.findOne({ where: { id } });
    if (!doc) throw new BadRequestException('Document not found');
    return this.b2.getDownloadUrl(this.bucket, doc.b2Path, 300);
  }

  // ── Sanitize ───────────────────────────────────────────────

  private sanitizeDocument(doc: Document, includeCode: boolean): Document {
    const sanitized = { ...doc };
    delete (sanitized as any).accessCodeHash;
    if (!includeCode) {
      delete (sanitized as any).plainCode;
    }
    return sanitized;
  }
}
