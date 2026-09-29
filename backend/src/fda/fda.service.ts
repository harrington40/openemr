import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { RxNavService } from './rxnav.service';

const FDA_BASE = 'https://api.fda.gov';

/** `openfda` block embedded in an openFDA label result. */
interface FdaOpenFda {
    brand_name?: string[];
    generic_name?: string[];
    manufacturer_name?: string[];
    route?: string[];
}

/** A single `results[]` entry returned by the openFDA APIs this service calls. */
export interface FdaResult {
    openfda?: FdaOpenFda;
    indications_and_usage?: string[];
    warnings?: string[];
    adverse_reactions?: string[];
    dosage_and_administration?: string[];
    [key: string]: unknown;
}

/** Envelope shared by every openFDA JSON endpoint. */
export interface FdaResponse {
    meta?: { results?: { total?: number } };
    results?: FdaResult[];
    error?: { code?: string; message?: string };
}

/** Row returned when listing patients currently on a given drug. */
export interface DrugPatientRow {
    pid: number;
    fname: string;
    lname: string;
    DOB: string;
    sex: string;
    drug: string;
    dosage: string;
    start_date: string;
    active: number;
}

/** Row returned when matching a device name against recorded billing lines. */
export interface DeviceProcedureRow {
    pid: number;
    fname: string;
    lname: string;
    DOB: string;
    code_text: string | null;
    date: string | null;
}

/**
 * RxNorm carries packaging concepts as well as ingredients ("Metforming Pill",
 * "Amoxi-tabs Oral Product"), and openFDA labels include dose-specific combos
 * ("Ibuprofen, Acetaminophen Tablet, Film Coated"). Those are noise in an allergy
 * picker. Injectable/topical forms are deliberately NOT filtered — for some drugs
 * that is the only name there is.
 */
const PRODUCT_FORM_NOISE =
    /\b(pill|pills|tablet|tablets|capsule|capsules|film coated|oral (product|tablet|capsule|solution)|pack|kit|suppositor(y|ies)|ampule|prefilled|\d+\s*(mg|mcg|ml|iu|g))\b/i;

@Injectable()
export class FdaService {
    private readonly logger = new Logger(FdaService.name);

    constructor(
        private readonly http: HttpService,
        @InjectDataSource() private dataSource: DataSource,
        // Second source for drug names openFDA has no label for. Same module, no
        // circular dependency (RxNavService depends only on HttpService).
        private readonly rxnav: RxNavService,
    ) {}

    // ── Drug API ──────────────────────────────────────────────

    async searchDrugs(query: {
        term?: string;
        brand?: string;
        limit?: number;
    }) {
        try {
            const search = query.term || query.brand || 'aspirin';
            const url = `${FDA_BASE}/drug/label.json?search=openfda.brand_name:"${encodeURIComponent(search)}"+OR+openfda.generic_name:"${encodeURIComponent(search)}"&limit=${query.limit || 10}`;
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(url),
            );
            return this.mapDrugResults(data, query.term);
        } catch (err) {
            return this.handleError('FDA drug search', err);
        }
    }

    /**
     * Drug-name suggestions for the allergy picker.
     *
     * openFDA's label search is an EXACT phrase match, so a clinician typing
     * "penic" got nothing back; the tab then fell back to RxNorm's fuzzy endpoint,
     * which answered with *alcohol gel*. A trailing wildcard gives real partial
     * matching, and the generic/brand names openFDA returns are exactly what
     * belongs on an allergy line. RxNorm is kept as a second source for names
     * openFDA has no label for.
     */
    async suggestDrugNames(
        term: string,
        limit = 15,
    ): Promise<{ name: string; source: string; rxcui?: string }[]> {
        const raw = String(term || '').trim();
        if (raw.length < 2) return [];

        const out: { name: string; source: string; rxcui?: string }[] = [];
        const seen = new Set<string>();
        const push = (
            name: string | null | undefined,
            source: string,
            rxcui?: string,
        ) => {
            const clean = this.normaliseDrugName(name);
            if (!clean) return;
            if (PRODUCT_FORM_NOISE.test(clean)) return;
            const key = clean.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            out.push({ name: clean, source, rxcui });
        };

        // 1) openFDA label search with a wildcard on the final token.
        try {
            const token = raw.split(/\s+/).pop() || raw;
            const safe = token.replace(/["\\]/g, '');
            // Space-separated, NOT "+OR+": axios encodes a literal "+" as %2B, which
            // openFDA rejects outright, so the query silently returned nothing.
            const search = `openfda.generic_name:${safe}* OR openfda.brand_name:${safe}*`;
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(`${FDA_BASE}/drug/label.json`, {
                    params: {
                        search,
                        limit: Math.min(Math.max(limit * 3, 20), 100),
                    },
                }),
            );
            for (const row of data?.results || []) {
                const openfda = row?.openfda || {};
                push((openfda.generic_name || [])[0], 'fda-label');
                push((openfda.brand_name || [])[0], 'fda-label');
            }
        } catch {
            /* fall through to RxNorm */
        }

        // 2) RxNorm approximate match — filtered to real, named concepts. Its catalog
        //    is full of packaging concepts ("Metforming Pill", "… Oral Product") that
        //    are useless on an allergy line.
        if (out.length < limit) {
            try {
                const rx = await this.rxnav.approximateSearch(raw);
                for (const d of rx) {
                    if (out.length >= limit * 2) break;
                    const name = String(d?.name || '');
                    if (PRODUCT_FORM_NOISE.test(name)) continue;
                    push(name, 'rxnorm', d?.rxcui);
                }
            } catch {
                /* ignore */
            }
        }

        // Rank: prefix matches first (what a type-ahead is expected to do), then the
        // shortest name, which is normally the ingredient rather than a product.
        const needle = raw.toLowerCase();
        return out
            .filter(
                (d) =>
                    d.name.toLowerCase().includes(needle) || needle.length <= 3,
            )
            .sort((a, b) => {
                const ap = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
                const bp = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
                return ap - bp || a.name.length - b.name.length;
            })
            .slice(0, limit);
    }

    /**
     * FDA labels are usually shouted in caps ("PENICILLIN G BENZATHINE"); an
     * allergy line should read normally, so all-caps names are title-cased while
     * already-mixed-case names are left alone.
     */
    private normaliseDrugName(name: string | null | undefined): string {
        const s = String(name || '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!s || s.length > 80) return '';
        if (s !== s.toUpperCase()) return s;
        return (
            s
                .toLowerCase()
                .replace(/\b([a-z])/g, (m) => m.toUpperCase())
                // keep dosage/salt markers readable: "Hcl" -> "HCl", "Nsaid" -> "NSAID"
                .replace(/\bHcl\b/g, 'HCl')
                .replace(/\bHbr\b/g, 'HBr')
        );
    }

    async getDrugAdverseEvents(drugName: string, limit = 10) {
        try {
            const url = `${FDA_BASE}/drug/event.json?search=patient.drug.medicinalproduct:"${encodeURIComponent(drugName)}"&limit=${limit}`;
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(url),
            );
            return data;
        } catch (err) {
            return this.handleError('FDA drug adverse events', err);
        }
    }

    async getDrugRecalls(drugName?: string, limit = 10) {
        try {
            const search = drugName
                ? `product_description:"${encodeURIComponent(drugName)}"`
                : '_exists_:product_description';
            const url = `${FDA_BASE}/drug/enforcement.json?search=${search}&limit=${limit}`;
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(url),
            );
            return data;
        } catch (err) {
            return this.handleError('FDA drug recalls', err);
        }
    }

    // ── Device API ────────────────────────────────────────────

    async searchDevices(query: { term?: string; limit?: number }) {
        try {
            const search = query.term || 'pacemaker';
            const url = `${FDA_BASE}/device/classification.json?search=device_name:"${encodeURIComponent(search)}"&limit=${query.limit || 10}`;
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(url),
            );
            return data;
        } catch (err) {
            return this.handleError('FDA device search', err);
        }
    }

    async getDeviceRecalls(deviceName?: string, limit = 10) {
        try {
            const search = deviceName
                ? `product_description:"${encodeURIComponent(deviceName)}"`
                : '_exists_:product_description';
            const url = `${FDA_BASE}/device/enforcement.json?search=${search}&limit=${limit}`;
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(url),
            );
            return data;
        } catch (err) {
            return this.handleError('FDA device recalls', err);
        }
    }

    async getDeviceAdverseEvents(deviceName?: string, limit = 10) {
        try {
            const search = deviceName
                ? `device.brand_name:"${encodeURIComponent(deviceName)}"`
                : '_exists_:device.brand_name';
            const url = `${FDA_BASE}/device/event.json?search=${search}&limit=${limit}`;
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(url),
            );
            return data;
        } catch (err) {
            return this.handleError('FDA device adverse events', err);
        }
    }

    // ── Food API ──────────────────────────────────────────────

    async searchFood(query: { term?: string; limit?: number }) {
        try {
            const search = query.term || 'peanut';
            const url = `${FDA_BASE}/food/enforcement.json?search=product_description:"${encodeURIComponent(search)}"&limit=${query.limit || 10}`;
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(url),
            );
            return data;
        } catch (err) {
            return this.handleError('FDA food search', err);
        }
    }

    async getFoodAdverseEvents(foodName?: string, limit = 10) {
        try {
            const search = foodName || 'peanut';
            const url = `${FDA_BASE}/food/event.json?search=products.name_brand:"${encodeURIComponent(search)}"&limit=${limit}`;
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(url, { validateStatus: () => true }),
            );
            return data;
        } catch (err) {
            return this.handleError('FDA food adverse events', err);
        }
    }

    // ── Cosmetic API ──────────────────────────────────────────

    async searchCosmetics(query: { term?: string; limit?: number }) {
        try {
            const search = query.term || 'shampoo';
            const url = `${FDA_BASE}/other/substance.json?search=substance_name:"${encodeURIComponent(search)}"&limit=${query.limit || 10}`;
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(url, { validateStatus: () => true }),
            );
            return data;
        } catch (err) {
            return this.handleError('FDA cosmetic search', err);
        }
    }

    // ── Tobacco API ───────────────────────────────────────────

    async searchTobacco(query: { term?: string; limit?: number }) {
        try {
            const search = query.term || 'cigarette';
            const url = `${FDA_BASE}/tobacco/problem.json?search=product_description:"${encodeURIComponent(search)}"&limit=${query.limit || 10}`;
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(url),
            );
            return data;
        } catch (err) {
            return this.handleError('FDA tobacco search', err);
        }
    }

    // ── Other API ─────────────────────────────────────────────

    async searchOther(query: { term?: string; limit?: number }) {
        try {
            const search = query.term || 'vitamin';
            const url = `${FDA_BASE}/other/substance.json?search=substance_name:"${encodeURIComponent(search)}"&limit=${query.limit || 10}`;
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(url, { validateStatus: () => true }),
            );
            return data;
        } catch (err) {
            return this.handleError('FDA other search', err);
        }
    }

    // ── Transparency API ──────────────────────────────────────

    async searchTransparency(query: {
        type?: string;
        term?: string;
        limit?: number;
    }) {
        try {
            const term = query.term || '';
            let url: string;
            switch (query.type) {
                case 'warning':
                    url = `${FDA_BASE}/other/warningletter.json?search=letter_type:"${encodeURIComponent(term)}"&limit=${query.limit || 10}`;
                    break;
                case 'recall':
                    url = `${FDA_BASE}/food/enforcement.json?search=report_date:[20200101+TO+20261231]&limit=${query.limit || 10}`;
                    break;
                default:
                    url = `${FDA_BASE}/other/inspection.json?search=_exists_:classification&limit=${query.limit || 10}`;
            }
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(url, { validateStatus: () => true }),
            );
            return data;
        } catch (err) {
            return this.handleError('FDA transparency search', err);
        }
    }

    // ── Smart Algorithms ─────────────────────────────────────

    async smartDrugLookup(drugName: string) {
        // FDA drug label
        let fdaData: FdaResponse = { results: [] };
        try {
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(
                    `${FDA_BASE}/drug/label.json?search=openfda.brand_name:"${encodeURIComponent(drugName)}"+OR+openfda.generic_name:"${encodeURIComponent(drugName)}"&limit=3`,
                ),
            );
            fdaData = data;
        } catch {
            /* ignore */
        }

        // Patients on this drug
        let patientsOnDrug: DrugPatientRow[] = [];
        const interactionWarnings: string[] = [];
        const allergyWarnings: string[] = [];
        try {
            patientsOnDrug = await this.dataSource.query<DrugPatientRow[]>(
                `SELECT p.pid, p.fname, p.lname, p.DOB, p.sex, pr.drug, pr.dosage, pr.start_date, pr.active
         FROM prescriptions pr JOIN patient_data p ON pr.patient_id = p.pid
         WHERE pr.drug LIKE ? AND pr.active = 1 ORDER BY p.lname LIMIT 20`,
                [`%${drugName}%`],
            );

            for (const patient of patientsOnDrug) {
                const otherDrugs = await this.dataSource.query<
                    { drug: string }[]
                >(
                    `SELECT drug FROM prescriptions WHERE patient_id = ? AND drug NOT LIKE ? AND active = 1`,
                    [patient.pid, `%${drugName}%`],
                );
                if (otherDrugs.length > 0) {
                    interactionWarnings.push(
                        `${patient.fname} ${patient.lname} (PID ${patient.pid}) also takes: ${otherDrugs.map((d) => d.drug).join(', ')}`,
                    );
                }
            }

            for (const patient of patientsOnDrug) {
                const allergies = await this.dataSource.query<
                    { title: string }[]
                >(
                    `SELECT title FROM lists WHERE pid = ? AND type = 'allergy' AND title LIKE ?`,
                    [patient.pid, `%${drugName}%`],
                );
                if (allergies.length > 0) {
                    allergyWarnings.push(
                        `⚠️ ${patient.fname} ${patient.lname} (PID ${patient.pid}) has an allergy to "${allergies[0].title}"`,
                    );
                }
            }
        } catch {
            /* ignore */
        }

        // FDA adverse events
        let adverseEvents: FdaResponse = { results: [] };
        try {
            const { data: ae } = await firstValueFrom(
                this.http.get<FdaResponse>(
                    `${FDA_BASE}/drug/event.json?search=patient.drug.medicinalproduct:"${encodeURIComponent(drugName)}"&count=patient.reaction.reactionmeddrapt.exact`,
                ),
            );
            adverseEvents = ae;
        } catch {
            /* ignore */
        }

        return {
            drugName,
            fda: fdaData.results?.[0] || null,
            patientsOnDrug,
            patientCount: patientsOnDrug.length,
            interactionWarnings,
            allergyWarnings,
            topAdverseReactions: adverseEvents.results?.slice(0, 10) || [],
        };
    }

    async smartDeviceLookup(deviceName: string) {
        let recalls: FdaResponse = { results: [] };
        try {
            const { data } = await firstValueFrom(
                this.http.get<FdaResponse>(
                    `${FDA_BASE}/device/enforcement.json?search=product_description:"${encodeURIComponent(deviceName)}"&limit=5`,
                ),
            );
            recalls = data;
        } catch {
            /* ignore */
        }

        let matchingProcedures: DeviceProcedureRow[] = [];
        try {
            matchingProcedures = await this.dataSource.query<
                DeviceProcedureRow[]
            >(
                `SELECT pd.pid, pd.fname, pd.lname, pd.DOB, b.code_text, b.date
         FROM billing b JOIN patient_data pd ON b.pid = pd.pid
         WHERE b.code_text LIKE ? ORDER BY b.date DESC LIMIT 20`,
                [`%${deviceName}%`],
            );
        } catch {
            /* ignore */
        }

        return {
            deviceName,
            fdaRecalls: recalls.results || [],
            recallCount: recalls.results?.length || 0,
            matchingProcedures,
            patientCount: matchingProcedures.length,
        };
    }

    // ── Helpers ─────────────────────────────────────────────

    private mapDrugResults(data: FdaResponse, term?: string) {
        const results = (data.results || []).map((r) => ({
            brandName: r.openfda?.brand_name?.[0] || 'Unknown',
            genericName: r.openfda?.generic_name?.[0] || '',
            manufacturer: r.openfda?.manufacturer_name?.[0] || '',
            indications: r.indications_and_usage?.[0] || '',
            warnings: r.warnings?.[0]?.substring(0, 500) || '',
            adverseReactions: r.adverse_reactions?.[0]?.substring(0, 300) || '',
            dosage: r.dosage_and_administration?.[0]?.substring(0, 300) || '',
            route: r.openfda?.route?.[0] || '',
        }));
        return { term, total: data.meta?.results?.total || 0, results };
    }

    private handleError(context: string, err: unknown) {
        const msg =
            err instanceof AxiosError
                ? `HTTP ${err.response?.status} ${err.message}`
                : err instanceof Error
                  ? err.message
                  : (JSON.stringify(err) ?? 'Unknown error');
        this.logger.error(`${context}: ${msg}`);
        return {
            error: `Failed to fetch ${context}`,
            message: msg.substring(0, 200),
            results: [],
        };
    }
}
