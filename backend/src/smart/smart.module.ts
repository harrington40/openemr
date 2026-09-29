import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SmartController } from './smart.controller';

@Module({
    imports: [
        JwtModule.register({
            secret: process.env.JWT_SECRET || 'openrx-secret-key-2024',
        }),
    ],
    controllers: [SmartController],
})
export class SmartModule {}
