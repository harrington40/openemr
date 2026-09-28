import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FdaService } from './fda.service';
import { RxNavService } from './rxnav.service';

@Controller('fda')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'physician', 'nurse', 'pharmacist')
export class FdaController {
  constructor(
    private readonly fda: FdaService,
    private readonly rxnav: RxNavService,
  ) {}

  // ── Drug ──
  @Get('drugs')
  searchDrugs(@Query('term') term?: string, @Query('brand') brand?: string, @Query('limit') limit?: number) {
    return this.fda.searchDrugs({ term, brand, limit });
  }

  /**
   * Drug-name suggestions for the allergy picker: openFDA label names (partial
   * match via a trailing wildcard) merged with RxNorm, deduped and ranked.
   */
  @Get('drugs/suggest')
  suggestDrugs(@Query('term') term: string, @Query('limit') limit?: number) {
    return this.fda
      .suggestDrugNames(term || '', limit ? Number(limit) : 15)
      .then((results) => ({ results }));
  }

  @Get('drugs/adverse-events')
  getDrugAdverseEvents(@Query('drug') drug: string, @Query('limit') limit?: number) {
    return this.fda.getDrugAdverseEvents(drug, limit);
  }

  @Get('drugs/recalls')
  getDrugRecalls(@Query('drug') drug?: string, @Query('limit') limit?: number) {
    return this.fda.getDrugRecalls(drug, limit);
  }

  // ── Device ──
  @Get('devices')
  searchDevices(@Query('term') term?: string, @Query('limit') limit?: number) {
    return this.fda.searchDevices({ term, limit });
  }

  @Get('devices/recalls')
  getDeviceRecalls(@Query('device') device?: string, @Query('limit') limit?: number) {
    return this.fda.getDeviceRecalls(device, limit);
  }

  @Get('devices/adverse-events')
  getDeviceAdverseEvents(@Query('device') device?: string, @Query('limit') limit?: number) {
    return this.fda.getDeviceAdverseEvents(device, limit);
  }

  // ── Food ──
  @Get('food')
  searchFood(@Query('term') term?: string, @Query('limit') limit?: number) {
    return this.fda.searchFood({ term, limit });
  }

  @Get('food/adverse-events')
  getFoodAdverseEvents(@Query('food') food?: string, @Query('limit') limit?: number) {
    return this.fda.getFoodAdverseEvents(food, limit);
  }

  // ── Cosmetic ──
  @Get('cosmetics')
  searchCosmetics(@Query('term') term?: string, @Query('limit') limit?: number) {
    return this.fda.searchCosmetics({ term, limit });
  }

  // ── Tobacco ──
  @Get('tobacco')
  searchTobacco(@Query('term') term?: string, @Query('limit') limit?: number) {
    return this.fda.searchTobacco({ term, limit });
  }

  // ── Other ──
  @Get('other')
  searchOther(@Query('term') term?: string, @Query('limit') limit?: number) {
    return this.fda.searchOther({ term, limit });
  }

  // ── Transparency ──
  @Get('transparency')
  searchTransparency(@Query('type') type?: string, @Query('term') term?: string, @Query('limit') limit?: number) {
    return this.fda.searchTransparency({ type, term, limit });
  }

  // ── Smart Lookups ──
  @Get('smart/drug')
  async smartDrugLookup(@Query('drug') drug: string) {
    if (!drug) return { error: 'drug query param required' };
    return this.fda.smartDrugLookup(drug);
  }

  @Get('smart/device')
  async smartDeviceLookup(@Query('device') device: string) {
    if (!device) return { error: 'device query param required' };
    return this.fda.smartDeviceLookup(device);
  }

  // ── RxNav / RxNorm (NIH) ──────────────────────────────────

  @Get('rxnav/search')
  async rxnavSearch(@Query('name') name: string) {
    if (!name) return { results: [] };
    return { results: await this.rxnav.searchDrugs(name) };
  }

  @Get('rxnav/approximate')
  async rxnavApproximate(@Query('term') term: string) {
    if (!term) return { results: [] };
    return { results: await this.rxnav.approximateSearch(term) };
  }

  @Get('rxnav/lookup/:drugName')
  async rxnavSmartLookup(@Param('drugName') drugName: string) {
    if (!drugName) return { error: 'drug name required' };
    return this.rxnav.smartRxNavLookup(drugName);
  }

  @Get('rxnav/:rxcui/related')
  async rxnavRelated(
    @Param('rxcui') rxcui: string,
    @Query('tty') tty?: string,
  ) {
    return { results: await this.rxnav.getRelatedDrugs(rxcui, tty) };
  }

  @Get('rxnav/:rxcui/interactions')
  async rxnavInteractions(
    @Param('rxcui') rxcui: string,
    @Query('with') withRxcuis: string,
  ) {
    const others = withRxcuis ? withRxcuis.split(',') : [];
    return { results: await this.rxnav.checkInteractions(rxcui, others) };
  }

  @Get('rxnav/:rxcui/classes')
  async rxnavClasses(@Param('rxcui') rxcui: string) {
    return { results: await this.rxnav.getDrugClasses(rxcui) };
  }
}
