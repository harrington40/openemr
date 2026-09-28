import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { DocumentsService } from './documents.service';
import type { DocumentStatus } from './document.entity';

@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * Upload a document to Backblaze B2.
   * Returns a 4-digit access code. The code is also stored in plainCode
   * so the uploading user can retrieve it later from their account.
   */
  @Post('upload')
  @Roles('admin', 'physician', 'nurse', 'front_desk')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: any,
    @Body('pid') pid?: string,
    @Body('recipientContact') recipientContact?: string,
    @Body('recipientName') recipientName?: string,
    @Body('category') category?: string,
    @Body('notes') notes?: string,
    @Req() req?: any,
  ) {
    if (!file) throw new BadRequestException('File is required');

    const userId = req?.user?.sub ? parseInt(req.user.sub, 10) : 0;

    const result = await this.documentsService.uploadFile(file, {
      pid: pid ? parseInt(pid, 10) : undefined,
      uploadedBy: req?.user?.displayName || req?.user?.username || 'Unknown',
      uploaderUserId: userId,
      recipientContact,
      recipientName,
      category,
      notes,
    });

    return {
      id: result.document.id,
      originalName: result.document.originalName,
      category: result.document.category,
      status: result.document.status,
      accessCode: result.accessCode,
      message: `Document uploaded. Share this 4-digit code with the recipient: ${result.accessCode}`,
    };
  }

  /** List all documents (admin view, no access codes exposed) */
  @Get()
  @Roles('admin', 'physician', 'nurse', 'front_desk')
  async list(@Query('pid') pid?: string) {
    return this.documentsService.listDocuments(pid ? parseInt(pid, 10) : undefined);
  }

  /**
   * List documents uploaded by the currently logged-in user.
   * Includes access codes and status for the owner.
   */
  @Get('my')
  @Roles('admin', 'physician', 'nurse', 'front_desk')
  async listMy(@Req() req: any, @Query('pid') pid?: string) {
    const userId = req?.user?.sub ? parseInt(req.user.sub, 10) : 0;
    return this.documentsService.listMyDocuments(userId, pid ? parseInt(pid, 10) : undefined);
  }

  /** Get document metadata by ID */
  @Get(':id')
  @Roles('admin', 'physician', 'nurse', 'front_desk')
  async getOne(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.sub ? parseInt(req.user.sub, 10) : undefined;
    const doc = await this.documentsService.getDocument(parseInt(id, 10), userId);
    if (!doc) throw new BadRequestException('Document not found');
    return doc;
  }

  /** Update document status (only the uploader can do this) */
  @Patch(':id/status')
  @Roles('admin', 'physician', 'nurse', 'front_desk')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: DocumentStatus,
    @Req() req: any,
  ) {
    if (!status || !['pending', 'accepted', 'rejected', 'expired'].includes(status)) {
      throw new BadRequestException('Invalid status');
    }
    const userId = req?.user?.sub ? parseInt(req.user.sub, 10) : 0;
    return this.documentsService.updateStatus(parseInt(id, 10), status, userId);
  }

  /**
   * Get a streamable download URL for the document uploader or admin.
   * Used for video playback on the How-To page (no access code needed for owner).
   */
  @Get(':id/stream')
  @Roles('admin', 'physician', 'nurse', 'front_desk')
  async getStreamUrl(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.sub ? parseInt(req.user.sub, 10) : 0;
    const doc = await this.documentsService.getDocument(parseInt(id, 10), userId);
    if (!doc) throw new BadRequestException('Document not found');

    // Only the uploader or admin can get stream URL
    if (userId !== doc.uploaderUserId && req?.user?.role !== 'admin') {
      throw new BadRequestException('Access denied');
    }

    const url = await this.documentsService.getDocumentDownloadUrl(parseInt(id, 10));
    return { streamUrl: url, mimeType: doc.mimeType, originalName: doc.originalName };
  }

  /**
   * Verify a 4-digit access code.
   * If valid, returns a download URL and marks the document as accepted.
   */
  @Post(':id/verify')
  async verifyCode(
    @Param('id') id: string,
    @Body('code') code: string,
  ) {
    if (!code || code.length !== 4 || !/^\d{4}$/.test(code)) {
      throw new BadRequestException('A 4-digit numeric code is required');
    }
    return this.documentsService.verifyDocumentCode(parseInt(id, 10), code);
  }
}
