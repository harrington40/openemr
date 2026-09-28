import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { AuthController } from './auth.controller';
import { RolesGuard } from './roles.guard';
import { AbacModule } from './abac/abac.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'openrx-secret-key-2024',
      signOptions: { expiresIn: '8h' },
    }),
    AbacModule,
  ],
  controllers: [AuthController],
  providers: [JwtStrategy, RolesGuard],
  exports: [PassportModule, JwtModule, RolesGuard, AbacModule],
})
export class AuthModule {}
