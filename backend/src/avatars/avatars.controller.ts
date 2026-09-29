import {
    Controller,
    Get,
    Post,
    Delete,
    Param,
    Body,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    Req,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AvatarsService } from './avatars.service';
import type { UploadedAvatarFile } from './avatars.service';

/** Authenticated principal used by the avatar endpoints. */
interface AvatarsUser {
    sub?: number | string;
    id?: number | string;
    role?: string;
    can_edit_providers?: number | boolean;
}

/** Authenticated request used by the avatar endpoints. */
interface AvatarsRequest {
    user?: AvatarsUser;
}

@Controller('avatars')
@UseGuards(JwtAuthGuard)
export class AvatarsController {
    constructor(private readonly avatarsService: AvatarsService) {}

    @Post('upload')
    @UseInterceptors(
        FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
    )
    async upload(
        @UploadedFile() file: UploadedAvatarFile | undefined,
        @Req() req: AvatarsRequest,
        @Body('userId') requestedUserId?: string,
    ) {
        if (!file) throw new BadRequestException('File is required');

        const me = Number(req.user?.sub || req.user?.id || 0);
        // Defaults to your own avatar; an explicit userId targets someone else and
        // is only honoured for roles allowed to manage other people's profiles.
        const target =
            requestedUserId !== undefined && requestedUserId !== ''
                ? Number(requestedUserId)
                : me;

        if (!Number.isFinite(target) || target <= 0) {
            throw new BadRequestException('Invalid user id');
        }
        if (target !== me) {
            this.assertMayManageOthers(req.user);
        }

        const avatar = await this.avatarsService.uploadAvatar(target, file);
        return {
            id: avatar.id,
            userId: target,
            originalName: avatar.originalName,
            b2Path: avatar.b2Path,
        };
    }

    /**
     * Who may change someone else's photo. Mirrors the provider-edit rule used by
     * the admin user endpoints: an administrator always, front desk only with the
     * explicit privilege.
     */
    private assertMayManageOthers(user: AvatarsUser | undefined): void {
        if (!user) throw new ForbiddenException('Not authenticated');
        if (user.role === 'admin') return;
        if (user.role === 'front_desk' && user.can_edit_providers) return;
        throw new ForbiddenException(
            'You can only change your own photo. Ask an administrator to change this one.',
        );
    }

    /**
     * The caller's own avatar.
     *
     * Avatars belong to users, and the SPA is not told its own user id at login —
     * so the profile page asks for "me" rather than guessing. MUST stay above the
     * `:userId` route or "me" would be parsed as an id.
     */
    @Get('me')
    async getMine(@Req() req: AvatarsRequest) {
        const userId = Number(req.user?.sub || req.user?.id || 0);
        const result = await this.avatarsService.getAvatar(userId);
        return {
            ...result,
            userId,
            // Lets the profile page decide whether it may offer the upload control for
            // someone else's photo, instead of the UI re-deriving the rule.
            canManageOthers: this.mayManageOthers(req.user),
        };
    }

    private mayManageOthers(user: AvatarsUser | undefined): boolean {
        if (!user) return false;
        if (user.role === 'admin') return true;
        return user.role === 'front_desk' && !!user.can_edit_providers;
    }

    @Get(':userId')
    async get(@Param('userId') userId: string) {
        return this.avatarsService.getAvatar(parseInt(userId, 10));
    }

    @Delete(':userId')
    async delete(@Param('userId') userId: string, @Req() req: AvatarsRequest) {
        const target = parseInt(userId, 10);
        if (!Number.isFinite(target) || target <= 0) {
            throw new BadRequestException('Invalid user id');
        }
        // Same rule as uploading: your own photo, or someone else's only with the
        // privilege to manage other profiles. This route previously carried no check
        // at all, so any signed-in user could delete anyone's photo.
        const me = Number(req.user?.sub || req.user?.id || 0);
        if (target !== me) {
            this.assertMayManageOthers(req.user);
        }
        await this.avatarsService.deleteAvatar(target);
        return { message: 'Avatar deleted', userId: target };
    }
}
