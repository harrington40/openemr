import { Module } from '@nestjs/common';
import { PatientPortalService } from './patient-portal.service';

/**
 * Patient portal credentials: issuing, verifying and changing passwords.
 *
 * Kept as its own module rather than folded into PatientsModule so the password
 * handling sits in one reviewable place and can be injected wherever it is
 * needed — currently the public portal controller, and the registrar desk when
 * a password has to be reissued.
 */
@Module({
    providers: [PatientPortalService],
    exports: [PatientPortalService],
})
export class PatientPortalModule {}
