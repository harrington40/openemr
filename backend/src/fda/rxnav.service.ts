import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const RXNORM_BASE = 'https://rxnav.nlm.nih.gov/REST';

export interface RxNormDrug {
    rxcui: string;
    name: string;
    tty: string; // Term type: SCD, SBD, IN, BN, etc.
    synonym?: string;
}

export interface RxNormInteraction {
    rxcui1: string;
    name1: string;
    rxcui2: string;
    name2: string;
    severity: string;
    description: string;
}

/** `rxcui` name-search response. */
interface RxNavIdGroupResponse {
    idGroup?: { rxnormId?: string[] };
}

/** Concept entry inside a related/concept group. */
interface RxNavConceptProperties {
    rxcui?: string;
    name?: string;
    tty?: string;
    synonym?: string;
}

/** Term-type group inside an allrelated/related response. */
interface RxNavConceptGroup {
    tty?: string;
    conceptProperties?: RxNavConceptProperties[];
}

/** `allrelated` / `related` response. */
interface RxNavRelatedResponse {
    allRelatedGroup?: { conceptGroup?: RxNavConceptGroup[] };
    relatedGroup?: { conceptGroup?: RxNavConceptGroup[] };
}

/** `approximateTerm` response. */
interface RxNavApproximateResponse {
    approximateGroup?: {
        candidate?: {
            rxcui?: string;
            name?: string;
            score?: string | number;
        }[];
    };
}

/** `properties` response. */
interface RxNavPropertiesResponse {
    properties?: {
        rxcui?: string;
        name?: string;
        synonym?: string;
        tty?: string;
        language?: string;
        suppress?: string;
        umlscui?: string;
    };
}

/** Minimal concept item inside an interaction row. */
interface RxNavMinConceptItem {
    rxcui?: string;
    name?: string;
}

/** One side of an interaction pair. */
interface RxNavInteractionConcept {
    minConceptItem?: RxNavMinConceptItem;
}

/** A drug-drug interaction pair. */
interface RxNavInteractionPair {
    interactionConcept?: RxNavInteractionConcept[];
    severity?: string;
    description?: string;
}

/** A group of interaction pairs. */
interface RxNavInteractionType {
    interactionPair?: RxNavInteractionPair[];
}

/** `interaction` response (single and list forms). */
interface RxNavInteractionResponse {
    interactionTypeGroup?: { interactionType?: RxNavInteractionType[] }[];
    fullInteractionTypeGroup?: {
        fullInteractionType?: { interactionPair?: RxNavInteractionPair[] }[];
    }[];
}

/** `class` response. */
interface RxNavClassResponse {
    rxclassDrugInfoList?: {
        rxclassDrugInfo?: {
            rxclassMinConceptItem?: {
                classId?: string;
                className?: string;
                classType?: string;
            };
            rela?: string;
        }[];
    };
}

@Injectable()
export class RxNavService {
    private readonly logger = new Logger(RxNavService.name);

    constructor(private readonly http: HttpService) {}

    // ── Drug Search ───────────────────────────────────────────

    /**
     * Search RxNorm for drugs matching a name.
     * Returns RxCUI, name, and term type (IN=ingredient, SCD=clinical drug, SBD=branded drug, BN=brand name).
     */
    async searchDrugs(name: string): Promise<RxNormDrug[]> {
        try {
            const { data } = await firstValueFrom(
                this.http.get<RxNavIdGroupResponse>(`${RXNORM_BASE}/rxcui`, {
                    params: { name, search: 2, allsources: 1 },
                }),
            );
            const rxcui = data?.idGroup?.rxnormId?.[0];
            if (!rxcui) return [];

            // Get all related concepts with full names
            const { data: related } = await firstValueFrom(
                this.http.get<RxNavRelatedResponse>(
                    `${RXNORM_BASE}/rxcui/${rxcui}/allrelated`,
                ),
            );

            const results: RxNormDrug[] = [];
            const groups = related?.allRelatedGroup?.conceptGroup || [];
            for (const group of groups) {
                for (const prop of group.conceptProperties || []) {
                    if (prop.rxcui && prop.name) {
                        results.push({
                            rxcui: prop.rxcui,
                            name: prop.name,
                            tty: prop.tty || group.tty || '',
                            synonym: prop.synonym || '',
                        });
                    }
                }
            }
            return results.slice(0, 30);
        } catch (err) {
            this.logger.warn(
                `RxNav search failed for "${name}": ${err instanceof Error ? err.message : 'unknown error'}`,
            );
            return [];
        }
    }

    /**
     * Approximate term search (spell-check style).
     */
    async approximateSearch(
        term: string,
    ): Promise<{ rxcui: string; name: string; score: number }[]> {
        try {
            const { data } = await firstValueFrom(
                this.http.get<RxNavApproximateResponse>(
                    `${RXNORM_BASE}/approximateTerm`,
                    {
                        params: { term, maxEntries: 10 },
                    },
                ),
            );
            return (data?.approximateGroup?.candidate || []).map((c) => ({
                rxcui: c.rxcui || '',
                name: c.name || '',
                score: Number(c.score) || 0,
            }));
        } catch (err) {
            this.logger.warn(
                `RxNav approximate search failed: ${err instanceof Error ? err.message : 'unknown error'}`,
            );
            return [];
        }
    }

    // ── Drug Properties ───────────────────────────────────────

    async getDrugProperties(rxcui: string) {
        try {
            const { data } = await firstValueFrom(
                this.http.get<RxNavPropertiesResponse>(
                    `${RXNORM_BASE}/rxcui/${rxcui}/properties`,
                ),
            );
            return data?.properties || null;
        } catch {
            return null;
        }
    }

    // ── Drug Relationships ────────────────────────────────────

    /**
     * Get related drugs for a given RxCUI.
     * @param rxcui The RxNorm Concept Unique Identifier
     * @param tty Filter by term type: IN (ingredient), SCD (clinical), SBD (branded), BN (brand name)
     */
    async getRelatedDrugs(rxcui: string, tty?: string): Promise<RxNormDrug[]> {
        try {
            const params: Record<string, string> = {};
            if (tty) params.tty = tty;
            const { data } = await firstValueFrom(
                this.http.get<RxNavRelatedResponse>(
                    `${RXNORM_BASE}/rxcui/${rxcui}/related`,
                    {
                        params,
                    },
                ),
            );
            const groups = data?.relatedGroup?.conceptGroup || [];
            const results: RxNormDrug[] = [];
            for (const group of groups) {
                for (const prop of group.conceptProperties || []) {
                    results.push({
                        rxcui: prop.rxcui || '',
                        name: prop.name || '',
                        tty: group.tty || '',
                    });
                }
            }
            return results;
        } catch {
            return [];
        }
    }

    // ── Drug Interactions ─────────────────────────────────────

    /**
     * Check for interactions between two RxCUIs.
     */
    async checkInteraction(
        rxcui1: string,
        rxcui2: string,
    ): Promise<RxNormInteraction | null> {
        try {
            const { data } = await firstValueFrom(
                this.http.get<RxNavInteractionResponse>(
                    `${RXNORM_BASE}/interaction/interaction.json`,
                    {
                        params: { rxcui: rxcui1 },
                    },
                ),
            );

            const interactions =
                data?.interactionTypeGroup?.[0]?.interactionType || [];
            for (const interaction of interactions) {
                for (const pair of interaction.interactionPair || []) {
                    const concept1 = pair.interactionConcept?.[0];
                    const concept2 = pair.interactionConcept?.[1];
                    if (
                        concept1?.minConceptItem?.rxcui === rxcui2 ||
                        concept2?.minConceptItem?.rxcui === rxcui2
                    ) {
                        return {
                            rxcui1: concept1?.minConceptItem?.rxcui || rxcui1,
                            name1: concept1?.minConceptItem?.name || '',
                            rxcui2: concept2?.minConceptItem?.rxcui || rxcui2,
                            name2: concept2?.minConceptItem?.name || '',
                            severity: pair.severity || 'unknown',
                            description: pair.description || '',
                        };
                    }
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    // ── Batch Interaction Check ───────────────────────────────

    /**
     * Check interactions between a drug and a list of other drugs.
     */
    async checkInteractions(
        rxcui: string,
        otherRxcuis: string[],
    ): Promise<RxNormInteraction[]> {
        if (!otherRxcuis.length) return [];

        try {
            const rxcuiList = [rxcui, ...otherRxcuis].join('+');
            const { data } = await firstValueFrom(
                this.http.get<RxNavInteractionResponse>(
                    `${RXNORM_BASE}/interaction/list.json`,
                    {
                        params: { rxcuis: rxcuiList },
                    },
                ),
            );

            const results: RxNormInteraction[] = [];
            const groups = data?.fullInteractionTypeGroup || [];
            for (const group of groups) {
                for (const source of group.fullInteractionType || []) {
                    for (const pair of source.interactionPair || []) {
                        const concept1 = pair.interactionConcept?.[0];
                        const concept2 = pair.interactionConcept?.[1];
                        results.push({
                            rxcui1: concept1?.minConceptItem?.rxcui || '',
                            name1: concept1?.minConceptItem?.name || '',
                            rxcui2: concept2?.minConceptItem?.rxcui || '',
                            name2: concept2?.minConceptItem?.name || '',
                            severity: pair.severity || 'unknown',
                            description: pair.description || '',
                        });
                    }
                }
            }
            return results;
        } catch {
            return [];
        }
    }

    // ── Drug Classes ──────────────────────────────────────────

    async getDrugClasses(rxcui: string) {
        try {
            const { data } = await firstValueFrom(
                this.http.get<RxNavClassResponse>(
                    `${RXNORM_BASE}/rxcui/${rxcui}/class`,
                ),
            );
            const classes = data?.rxclassDrugInfoList?.rxclassDrugInfo || [];
            return classes.map((c) => ({
                classId: c.rxclassMinConceptItem?.classId,
                className: c.rxclassMinConceptItem?.className,
                classType: c.rxclassMinConceptItem?.classType,
                relation: c.rela,
            }));
        } catch {
            return [];
        }
    }

    // ── Smart Lookup (Combined) ────────────────────────────────

    async smartRxNavLookup(drugName: string) {
        const drugs = await this.searchDrugs(drugName);
        if (!drugs.length) {
            return {
                drugName,
                found: false,
                suggestions: await this.approximateSearch(drugName),
            };
        }

        const primary = drugs[0];
        const [properties, ingredients, brandedForms, classes] =
            await Promise.all([
                this.getDrugProperties(primary.rxcui),
                this.getRelatedDrugs(primary.rxcui, 'IN'),
                this.getRelatedDrugs(primary.rxcui, 'SBD+SCD'),
                this.getDrugClasses(primary.rxcui),
            ]);

        return {
            drugName,
            found: true,
            primary: {
                rxcui: primary.rxcui,
                name: primary.name,
                tty: primary.tty,
            },
            properties,
            ingredients: ingredients.slice(0, 5),
            brandedForms: brandedForms.slice(0, 10),
            drugClasses: classes.slice(0, 10),
            allRelated: drugs.slice(0, 20),
        };
    }
}
