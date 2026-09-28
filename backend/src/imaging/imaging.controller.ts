import {
  Controller,
  Get,
  Post,
  Delete,
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
import { ImagingService } from './imaging.service';
import type { ImagingType } from './imaging.entity';

@Controller('imaging')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImagingController {
  constructor(private readonly imagingService: ImagingService) {}

  @Post('upload')
  @Roles('admin', 'physician', 'nurse', 'lab_tech', 'radiologist')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 500 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: any,
    @Body('type') type: ImagingType,
    @Body('pid') pid: string,
    @Body('eid') eid?: string,
    @Body('description') description?: string,
    @Req() req?: any,
  ) {
    if (!file) throw new BadRequestException('File is required');
    if (!type || !['xray', 'lab'].includes(type)) {
      throw new BadRequestException('Type must be "xray" or "lab"');
    }
    if (!pid) throw new BadRequestException('Patient ID is required');

    const image = await this.imagingService.upload(type, file, {
      pid: parseInt(pid, 10),
      eid: eid ? parseInt(eid, 10) : undefined,
      uploadedBy: req?.user?.displayName || req?.user?.username || 'Unknown',
      description,
    });

    return {
      id: image.id,
      type: image.type,
      originalName: image.originalName,
      pid: image.pid,
      message: 'Image uploaded successfully',
    };
  }

  @Get('patient/:pid')
  @Roles('admin', 'physician', 'nurse', 'lab_tech', 'radiologist')
  async listByPatient(
    @Param('pid') pid: string,
    @Query('type') type?: ImagingType,
  ) {
    return this.imagingService.listByPatient(parseInt(pid, 10), type);
  }

  @Get(':id')
  @Roles('admin', 'physician', 'nurse', 'lab_tech', 'radiologist')
  async getOne(@Param('id') id: string) {
    const image = await this.imagingService.getOne(parseInt(id, 10));
    if (!image) throw new BadRequestException('Image not found');
    return image;
  }

  @Get(':id/download')
  @Roles('admin', 'physician', 'nurse', 'lab_tech', 'radiologist')
  async download(@Param('id') id: string) {
    const url = await this.imagingService.getDownloadUrl(parseInt(id, 10));
    return { downloadUrl: url };
  }

  @Delete(':id')
  @Roles('admin', 'physician')
  async delete(@Param('id') id: string) {
    await this.imagingService.delete(parseInt(id, 10));
    return { message: 'Image deleted' };
  }
}
