import { Module } from '@nestjs/common';
import { FhirController } from './fhir.controller';
import { FhirService } from './fhir.service';

@Module({ controllers: [FhirController], providers: [FhirService] })
export class FhirModule {}
