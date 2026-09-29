import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT authentication guard.
 * Apply with @UseGuards(JwtAuthGuard) to protect routes.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
