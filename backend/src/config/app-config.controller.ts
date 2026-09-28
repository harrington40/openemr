import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller('config')
export class AppConfigController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  getConfig() {
    return {
      language: this.config.get<string>('LANGUAGE') || 'en',
      appName: 'OpenRx',
      version: '1.0.0',
    };
  }
}
