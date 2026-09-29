import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';

@Controller()
export class SmartController {
    constructor(private jwtService: JwtService) {}

    @Get('smart/launch')
    launch(@Query('iss') iss: string, @Query('launch') launch: string) {
        // SMART on FHIR EHR Launch — return launch context
        return {
            launch,
            iss,
            capabilities: [
                'launch-ehr',
                'permission-patient',
                'permission-user',
            ],
            fhirVersion: '4.0.0',
            authorizeUrl: '/api/smart/authorize',
            tokenUrl: '/api/auth/login',
        };
    }

    @Post('smart/authorize')
    @UseGuards(JwtAuthGuard)
    authorize(
        @Body() body: { client_id: string; scope: string; launch: string },
    ) {
        // Generate a SMART launch token with scoped access
        const payload = {
            client_id: body.client_id,
            scope: body.scope || 'openid fhirUser patient/*.read',
            launch: body.launch,
            smart_style: 'EHR Launch',
        };
        const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: payload.scope,
            patient: '1', // default to first patient for demo
        };
    }

    @Get('.well-known/smart-configuration')
    getConfig() {
        return {
            authorization_endpoint: '/api/smart/authorize',
            token_endpoint: '/api/auth/login',
            introspection_endpoint: '/api/smart/introspect',
            capabilities: [
                'launch-ehr',
                'client-public',
                'client-confidential-symmetric',
                'permission-patient',
                'permission-user',
            ],
            scopes_supported: [
                'openid',
                'fhirUser',
                'launch',
                'patient/*.read',
                'patient/*.write',
                'offline_access',
            ],
            response_types_supported: ['code', 'token'],
        };
    }
}
