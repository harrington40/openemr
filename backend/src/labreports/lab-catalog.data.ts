/**
 * MJ-MC / MA JUAH MEMORIAL CLINIC — LABORATORY REQUEST FORM catalog.
 *
 * This file is the single source of truth for the laboratory request/result
 * form. The order below is EXACTLY the order on the paper form:
 *  - Sections are not reordered, renamed, merged, or alphabetised.
 *  - Tests keep the exact wording and category they appear under on the form.
 *  - `displayOrder` is a single global sequence so the UI and print/PDF
 *    always reproduce the same order (database sorting must never change it).
 *
 * Fields with blanks on the paper form are modelled as result fields; values
 * shown in parentheses on the form are stored as the reference text.
 *
 * The `t(...)` arguments are `(name, category, resultType, unit?, refText?,
 * refMin?, refMax?)`. Supplying numeric `refMin`/`refMax` — not just `refText` —
 * is what lets the result form flag a value LOW/HIGH; `refText` alone only
 * controls what the "Normal Value" column prints.
 *
 * The RESULT sheets (Blood Biochemistry, Complete Hemogram, serology, Urine
 * Chemistry) carry extra measurements that never appeared on the request form;
 * they are appended in the RESULT-SHEET PANELS block at the bottom.
 */

export interface CatalogSeed {
    code: string;
    name: string;
    category: string;
    unit?: string;
    refMin?: number | null;
    refMax?: number | null;
    refText?: string;
    resultType:
        | 'NUMERIC'
        | 'TEXT'
        | 'POSITIVE_NEGATIVE'
        | 'SELECT'
        | 'BLOOD_GROUP';
    options?: string;
    displayOrder: number;
    /**
     * Comma-separated RESULT sheets this test is printed on (see RESULT_SHEETS).
     *
     * The catalog serves two jobs: the ordering menu (grouped by `category`, the
     * request form) and the patient result form (grouped by sheet, the four
     * printed result sheets). Only rows with a `sheet` appear on the result form,
     * so the ordering-only sections — fertility panels, tumour markers, thyroid,
     * the nutritional and coagulation panels — no longer show up there. A test
     * printed on two sheets lists both and is shown in each folder. Assigned from
     * SHEET_MEMBERS at the bottom of this file.
     */
    sheet?: string;
}

/**
 * The four printed RESULT sheets, in the order they appear on paper. The result
 * form renders one folder per sheet, in this order.
 */
export const RESULT_SHEETS = [
    'RESULTS BLOOD BIOCHEMISTRY',
    'BIO-MEDICAL ANALYSIS LABORATORY',
    'COMPLETE HEMOGRAM',
    'URINE CHEMISTRY LAB RESULT-FORM',
] as const;

export type ResultSheet = (typeof RESULT_SHEETS)[number];

let seq = 0;
const t = (
    name: string,
    category: string,
    resultType: CatalogSeed['resultType'] = 'TEXT',
    unit?: string,
    refText?: string,
    refMin?: number | null,
    refMax?: number | null,
): CatalogSeed => ({
    code: `MJ-${String(++seq).padStart(3, '0')}`,
    name,
    category,
    resultType,
    unit,
    refText,
    refMin: refMin ?? null,
    refMax: refMax ?? null,
    displayOrder: seq,
});

// Section header names — exact wording from the paper form.
const HAEMATOLOGY = 'HAEMATOLOGY/ IMMUNO-HAEMATOLOGY';
const IMMUNOLOGY = 'IMMUNOLOGY & SEROLOGY';
const BIO = 'BIOCHEMISTRY';
const BIO_GLUCOSE = `${BIO} — GLUCOSE METABOLISM/DIABETES`;
const BIO_LIPID = `${BIO} — LIPID METABOLISM PANEL`;
const BIO_HEART = `${BIO} — HEART DISEASE PANEL`;
const BIO_LIVER = `${BIO} — LIVER FUNCTION TESTS`;
const BIO_KIDNEY = `${BIO} — KIDNEY FUNCTION TEST`;
const BIO_ELECTRO = `${BIO} — ELECTROLYTES PANEL`;
const BIO_PANCREAS = `${BIO} — PANCREATIC FUNCTION PANEL`;
const BIO_THYROID = `${BIO} — THYROID FUNCTION TESTS`;
const BIO_TUMOR = `${BIO} — TUMAR MARKERS`;
const NUTRITIONAL = 'NUTRITIONAL PANEL';
const COAG = 'COAGULATION ACTIVITIES';
const INF_FEMALE = 'INFERTILITY FEMALE';
const INF_MALE = 'INFERTILITY MALE';
const EARLY_PREG = 'EARLY PREGNANCY CHECK UP';
const COLORECTAL = 'COLORECTAL OCCUTE BLOOD TEST';
const URINE_MACRO = 'URINALYSIS — MACROSCOPIC EXAMINATION';
const URINE_CHEM = 'URINALYSIS — CHEMISTRY EXAMINATION';
const URINE_MICRO = 'URINALYSIS — MICROSCOPIC EXAMINATION';
const STOOL_MACRO = 'PARASITOLOGY STOOL (WET MOUNT) — MACROSCOPIC EXAMINATION';
const STOOL_MICRO = 'PARASITOLOGY STOOL (WET MOUNT) — MICROSCOPIC EXAMINATION';

export const LAB_CATALOG_SEED: CatalogSeed[] = [
    // ============================================================
    // HAEMATOLOGY/ IMMUNO-HAEMATOLOGY
    // ============================================================
    t('HB Hemoglobin', HAEMATOLOGY, 'NUMERIC', 'g/dl', '12.0 – 18.0', 12, 18),
    t('CBC Complete blood count', HAEMATOLOGY, 'TEXT'),
    t(
        'WBC white Blood Cells',
        HAEMATOLOGY,
        'NUMERIC',
        'x10^9/l',
        '4.0 – 10',
        4,
        10,
    ),
    t('Malaria Smear', HAEMATOLOGY, 'TEXT', undefined, 'Negative'),
    t(
        'Sickle Cells Identification (rapid)',
        HAEMATOLOGY,
        'TEXT',
        undefined,
        'Negative',
    ),
    t('ABO& Rh) Blood Group', HAEMATOLOGY, 'BLOOD_GROUP'),
    t('ESR', HAEMATOLOGY, 'NUMERIC', 'mm/hr'),
    t('Malaria RDT', HAEMATOLOGY, 'POSITIVE_NEGATIVE', undefined, 'Negative'),

    // ============================================================
    // IMMUNOLOGY & SEROLOGY
    // ============================================================
    t('Widal panel', IMMUNOLOGY, 'TEXT'),
    t('Salmonella typhi O Ag', IMMUNOLOGY, 'TEXT', undefined, '1/100 Negative'),
    t('Salmonella typhi H Ag', IMMUNOLOGY, 'TEXT', undefined, '1/100 Negative'),
    t('Salmonella typhi AO Ag', IMMUNOLOGY, 'TEXT'),
    t('Salmonella typhi BO Ag', IMMUNOLOGY, 'TEXT'),
    t('Salmonella typhi CH Ag', IMMUNOLOGY, 'TEXT'),
    t('Salmonella typhi AH Ag', IMMUNOLOGY, 'TEXT'),
    t('Syphilis', IMMUNOLOGY, 'POSITIVE_NEGATIVE', undefined, 'Negative'),
    t('Chlamydia (Ag) Swab', IMMUNOLOGY, 'TEXT'),
    t('Filariasis (IgG+IgM)', IMMUNOLOGY, 'TEXT'),
    t(
        'Helicobacter pylori (IgG+IgM)',
        IMMUNOLOGY,
        'TEXT',
        undefined,
        'Negative',
    ),
    t(
        'Hepatitis B Virus (screening)',
        IMMUNOLOGY,
        'TEXT',
        undefined,
        'Negative',
    ),
    t('HBsAg', IMMUNOLOGY, 'TEXT'),
    t('HBsAb', IMMUNOLOGY, 'TEXT'),
    t('HBcAb', IMMUNOLOGY, 'TEXT'),
    t('HBeAb', IMMUNOLOGY, 'TEXT'),
    t('HBeAg', IMMUNOLOGY, 'TEXT'),
    t('Hepatitis C Virus (IgM+IgG)', IMMUNOLOGY, 'TEXT', undefined, 'Negative'),
    t('Human Immunodeficiency Virus (HIV1+2)', IMMUNOLOGY, 'TEXT'),
    t('Determine', IMMUNOLOGY, 'TEXT'),
    t('SD Bioline', IMMUNOLOGY, 'TEXT'),
    t('Uni-Gold', IMMUNOLOGY, 'TEXT'),

    // ============================================================
    // BIOCHEMISTRY — GLUCOSE METABOLISM/DIABETES
    // ============================================================
    t(
        'Fasting Blood Glucose',
        BIO_GLUCOSE,
        'NUMERIC',
        'mg/dl',
        '70 – 110',
        70,
        110,
    ),
    t(
        'Random Blood Glucose',
        BIO_GLUCOSE,
        'NUMERIC',
        'mg/dl',
        '70 – 140',
        70,
        140,
    ),
    t('HbA1c', BIO_GLUCOSE, 'TEXT'),
    t('OGTT', BIO_GLUCOSE, 'TEXT'),
    t('LH', BIO_GLUCOSE, 'TEXT'),

    // BIOCHEMISTRY — LIPID METABOLISM PANEL
    t('Cholesterol', BIO_LIPID, 'NUMERIC', 'mg/dl', '130 – 200', 130, 200),
    t('Triglycerides', BIO_LIPID, 'NUMERIC', 'mg/dl', '60 – 170', 60, 170),
    t('HDL Cholesterol', BIO_LIPID, 'NUMERIC', 'mg/dl', '40 – 60', 40, 60),
    // The form prints a bare "100mg/dl"; read as a ceiling so a high LDL flags.
    t('LDL Cholesterol', BIO_LIPID, 'NUMERIC', 'mg/dl', '≤ 100', null, 100),

    // BIOCHEMISTRY — HEART DISEASE PANEL
    t('CK & CK-MB', BIO_HEART, 'TEXT'),
    t('Myoglobin', BIO_HEART, 'TEXT'),
    t('Pro-BNP', BIO_HEART, 'TEXT'),
    t('CTNI', BIO_HEART, 'TEXT'),
    t('CTnT', BIO_HEART, 'TEXT'),

    // BIOCHEMISTRY — LIVER FUNCTION TESTS
    t('SGOT/AST', BIO_LIVER, 'NUMERIC', 'IU/L', '0 – 37', 0, 37),
    t('SGPT/ALT', BIO_LIVER, 'NUMERIC', 'IU/L', '0 – 49', 0, 49),
    t('ALP', BIO_LIVER, 'NUMERIC'),
    t('Bilirubin (Total & Direct)', BIO_LIVER, 'TEXT'),
    t('Calcium', BIO_LIVER, 'NUMERIC', 'mg/dl', '8.4 – 11.5', 8.4, 11.5),
    // The form prints 600 – 800mg/dl; conventional total protein is 6.0–8.3 g/dL
    // (= 6000–8300 mg/dl), so the printed figure looks 10x low. Kept as printed for
    // display, and left non-numeric so it cannot mis-flag.
    t('Total Serum protein/Albumin', BIO_LIVER, 'TEXT', 'mg/dl', '600 – 800'),

    // BIOCHEMISTRY — KIDNEY FUNCTION TEST
    t('Creatinine – Creatinine Kinase', BIO_KIDNEY, 'TEXT'),
    t('Urea', BIO_KIDNEY, 'NUMERIC', 'mg/dl', '7 – 20', 7, 20),
    t('BUN', BIO_KIDNEY, 'NUMERIC'),
    t('Uric Acid', BIO_KIDNEY, 'NUMERIC', 'mg/dl', '3.4 – 5.7', 3.4, 5.7),

    // BIOCHEMISTRY — ELECTROLYTES PANEL
    // Sodium is printed as 230 – 240mg/dl. Serum sodium is ~135–145 mmol/L
    // (~310–330 mg/dL), so the printed figure is on the wrong scale; a normal
    // result of 140 would flag LOW on every patient. Displayed verbatim, no bounds.
    t('Sodium Na+', BIO_ELECTRO, 'NUMERIC', 'mg/dl', '230 – 240'),
    // Potassium/Chloride are labelled mg/dl on the form but the printed numbers are
    // the correct mmol/L values, so the bounds are safe to flag against.
    t('Potassium K+', BIO_ELECTRO, 'NUMERIC', 'mmol/L', '3.5 – 5.0', 3.5, 5.0),
    t('Chloride Cl-', BIO_ELECTRO, 'NUMERIC', 'mmol/L', '98 – 106', 98, 106),
    t('Calcium Ca++', BIO_ELECTRO, 'NUMERIC', 'mg/dl', '8.4 – 11.5', 8.4, 11.5),

    // BIOCHEMISTRY — PANCREATIC FUNCTION PANEL
    t('Lipase', BIO_PANCREAS, 'NUMERIC'),
    t('Amylase', BIO_PANCREAS, 'NUMERIC'),
    t(
        'Bilirubin Total',
        BIO_PANCREAS,
        'NUMERIC',
        'mg/dl',
        '0.2 – 1.3',
        0.2,
        1.3,
    ),
    t('Bilirubin Direct', BIO_PANCREAS, 'NUMERIC'),

    // BIOCHEMISTRY — THYROID FUNCTION TESTS
    t('TSH (screening)', BIO_THYROID, 'NUMERIC'),
    t('T4 total', BIO_THYROID, 'NUMERIC'),
    t('T4 free', BIO_THYROID, 'NUMERIC'),
    t('TB Total', BIO_THYROID, 'NUMERIC'),

    // BIOCHEMISTRY — TUMAR MARKERS
    t('PSA, total', BIO_TUMOR, 'NUMERIC'),
    t('PSA free', BIO_TUMOR, 'NUMERIC'),
    t('CEA', BIO_TUMOR, 'NUMERIC'),
    t('AFP', BIO_TUMOR, 'NUMERIC', 'ng/ml', '< 10', null, 10),

    // ============================================================
    // PAGE 2
    // ============================================================

    // NUTRITIONAL PANEL
    t('CBC', NUTRITIONAL, 'TEXT'),
    t('Iron', NUTRITIONAL, 'NUMERIC'),
    t('Folic Acid', NUTRITIONAL, 'NUMERIC'),
    t('Electrolyte panel', NUTRITIONAL, 'TEXT'),
    t('Platelet counts', NUTRITIONAL, 'NUMERIC'),

    // COAGULATION ACTIVITIES
    t('PT', COAG, 'TEXT'),
    t('APTT', COAG, 'TEXT'),
    t('Bleeding Time', COAG, 'TEXT'),
    t('D-Dimer', COAG, 'TEXT'),

    // INFERTILITY FEMALE
    t('FSH', INF_FEMALE, 'NUMERIC'),
    t('LH', INF_FEMALE, 'NUMERIC'),
    t('Prolactin', INF_FEMALE, 'NUMERIC'),
    t('Progesterone', INF_FEMALE, 'NUMERIC'),
    t('Testosterone', INF_FEMALE, 'NUMERIC'),
    t('TSH', INF_FEMALE, 'NUMERIC'),

    // INFERTILITY MALE
    t('Semen Analysis', INF_MALE, 'TEXT'),
    t('FSH', INF_MALE, 'NUMERIC'),
    t('LH', INF_MALE, 'NUMERIC'),
    t('Prolactin', INF_MALE, 'NUMERIC'),
    t('Testosterone', INF_MALE, 'NUMERIC'),

    // EARLY PREGNANCY CHECK UP
    t('CBC & Blood Group', EARLY_PREG, 'TEXT'),
    t('Glucose Random', EARLY_PREG, 'NUMERIC'),
    t('VDRL (non-treponemic)', EARLY_PREG, 'TEXT'),
    t('HIV 1+2 Ag', EARLY_PREG, 'TEXT'),
    t('HBsAg', EARLY_PREG, 'TEXT'),
    t('HCV (IgG+IgM)', EARLY_PREG, 'TEXT'),
    t('Malaria RDT & WIDAL', EARLY_PREG, 'TEXT'),
    t('Urinalysis and HCG', EARLY_PREG, 'TEXT'),
    t('B-HCG', EARLY_PREG, 'NUMERIC'),

    // COLORECTAL OCCUTE BLOOD TEST
    t('Fecal Occult Blood test', COLORECTAL, 'TEXT'),

    // ============================================================
    // URINALYSIS
    // ============================================================
    // MACROSCOPIC EXAMINATION
    t('Color', URINE_MACRO, 'TEXT'),
    t('Character', URINE_MACRO, 'TEXT'),

    // CHEMISTRY EXAMINATION
    t('Urobilinogen', URINE_CHEM, 'TEXT', undefined, '<0.1'),
    t('Bilirubin', URINE_CHEM, 'TEXT', undefined, 'Neg'),
    t('Ketone', URINE_CHEM, 'TEXT', undefined, '=100'),
    t('Glucose', URINE_CHEM, 'TEXT', undefined, 'Neg'),
    t('Protein', URINE_CHEM, 'TEXT', undefined, 'Neg'),
    t('Blood', URINE_CHEM, 'TEXT', undefined, 'Neg'),
    t('Nitrite', URINE_CHEM, 'TEXT', undefined, 'Neg'),
    t('pH', URINE_CHEM, 'TEXT', undefined, '5.0-8.0'),
    t('S.G.', URINE_CHEM, 'TEXT', undefined, '1.005-1.030'),
    t('Leukocytes', URINE_CHEM, 'TEXT', undefined, 'Neg'),

    // MICROSCOPIC EXAMINATION
    t('WBC', URINE_MICRO, 'TEXT', '/HPF'),
    t('RBC', URINE_MICRO, 'TEXT', '/HPF'),
    t('Ep. Cells', URINE_MICRO, 'TEXT', '/LPF'),
    t('Casts', URINE_MICRO, 'TEXT'),
    t('Crystals', URINE_MICRO, 'TEXT'),
    t('Parasite', URINE_MICRO, 'TEXT'),
    t('Yeasts', URINE_MICRO, 'TEXT'),
    t('Bacteria', URINE_MICRO, 'TEXT'),
    t('Others', URINE_MICRO, 'TEXT'),

    // ============================================================
    // PARASITOLOGY STOOL (WET MOUNT)
    // ============================================================
    // MACROSCOPIC EXAMINATION
    t('Color', STOOL_MACRO, 'TEXT'),
    t('Consistency', STOOL_MACRO, 'TEXT'),
    t('Mucoid', STOOL_MACRO, 'TEXT'),

    // MICROSCOPIC EXAMINATION
    t('WBC', STOOL_MICRO, 'TEXT', '/HPF'),
    t('RBC', STOOL_MICRO, 'TEXT', '/HPF'),
    t('Parasite (O/P)', STOOL_MICRO, 'TEXT'),

    // ============================================================
    // RESULT-SHEET PANELS
    // ------------------------------------------------------------
    // The panels below appear on the printed RESULT sheets (Blood
    // Biochemistry / Complete Hemogram / serology / Urine Chemistry) but
    // were never on the request form, so they had no catalog rows and no
    // reference ranges at all. Appended at the end so the request form's
    // display order is left untouched.
    // ============================================================

    // BLOOD BIOCHEMISTRY — measurements on the result sheet that had no row.
    // Added here rather than mid-list: `code` is positional (MJ-nnn), so inserting
    // above would renumber every later test and change what an existing MJ code
    // refers to.
    t('Creatinine', BIO_KIDNEY, 'NUMERIC', 'mg/dl', '0.6 – 1.5', 0.6, 1.5),
    t('Magnesium', BIO_ELECTRO, 'NUMERIC', 'mg/dl', '1.7 – 2.2', 1.7, 2.2),
    t('Phosphorus', BIO_ELECTRO, 'NUMERIC', 'mg/dl', '3.0 – 4.5', 3.0, 4.5),

    // COMPLETE HEMOGRAM
    // `WBC Count (giga/1)` 4 – 10 is covered by 'WBC white Blood Cells' above.
    t('LYM (%)', HAEMATOLOGY, 'NUMERIC', '%', '20 – 40', 20, 40),
    t('Mid (%)', HAEMATOLOGY, 'NUMERIC', '%', '0 – 8', 0, 8),
    t('GR (%)', HAEMATOLOGY, 'NUMERIC', '%', '50 – 70', 50, 70),
    t('Lym (#)', HAEMATOLOGY, 'NUMERIC', 'x10^9/l', '0.8 – 4', 0.8, 4),
    t('Mid (#)', HAEMATOLOGY, 'NUMERIC', 'x10^9/l', '0 – 0.8', 0, 0.8),
    t('GR (#)', HAEMATOLOGY, 'NUMERIC', 'x10^9/l', '1.8 – 6.3', 1.8, 6.3),
    t('RBC Count', HAEMATOLOGY, 'NUMERIC', 'x10^12/l', '3.5 – 5.5', 3.5, 5.5),
    // The hemogram prints HGB 11 – 16 while the serology sheet prints 12.0 – 18.0
    // on 'HB Hemoglobin' above; both sheets are reproduced rather than merged.
    t('HGB', HAEMATOLOGY, 'NUMERIC', 'g/dl', '11 – 16', 11, 16),
    t('HCT (%)', HAEMATOLOGY, 'NUMERIC', '%', '33 – 48', 33, 48),
    t('M.C.V (fl)', HAEMATOLOGY, 'NUMERIC', 'fl', '80 – 100', 80, 100),
    t('M.C.H. (pg)', HAEMATOLOGY, 'NUMERIC', 'pg', '27 – 34', 27, 34),
    t('M.C.H.C (g/dl)', HAEMATOLOGY, 'NUMERIC', 'g/dl', '32 – 36', 32, 36),
    // A minimum of 0 is meaningless (effectively a ceiling), kept as printed.
    t('RDW-CV (%)', HAEMATOLOGY, 'NUMERIC', '%', '0 – 16', 0, 16),
    t('RDW-SD (fl)', HAEMATOLOGY, 'NUMERIC', 'fl', '37 – 55', 37, 55),
    t('MPV (fl)', HAEMATOLOGY, 'NUMERIC', 'fl', '7 – 12', 7, 12),
    t('PCT (%)', HAEMATOLOGY, 'NUMERIC', '%', '0.1 – 0.282', 0.1, 0.282),
    t('PDW (%)', HAEMATOLOGY, 'NUMERIC', '%', '8 – 18', 8, 18),
    t('PLCR (%)', HAEMATOLOGY, 'NUMERIC', '%', '13 – 43', 13, 43),
    t('PLCC (L)', HAEMATOLOGY, 'NUMERIC', 'x10^9/l', '10 – 100', 10, 100),

    // BIO-MEDICAL ANALYSIS LABORATORY (serology sheet) — extras
    t('Spot Test', IMMUNOLOGY, 'POSITIVE_NEGATIVE', undefined, 'Negative'),
    t('Cold Test', IMMUNOLOGY, 'POSITIVE_NEGATIVE', undefined, 'Negative'),
    t('Skin Test', IMMUNOLOGY, 'POSITIVE_NEGATIVE', undefined, 'Negative'),
    t('Stool Test', IMMUNOLOGY, 'POSITIVE_NEGATIVE', undefined, 'Negative'),
    t('MTT', IMMUNOLOGY, 'POSITIVE_NEGATIVE', undefined, 'Negative'),

    // URINE CHEMISTRY — the form lists SEDIMENT under VISUAL ANALYSIS
    t('Sediment', URINE_MACRO, 'TEXT'),
];

export const BLOOD_GROUP_OPTIONS = [
    'A+',
    'A-',
    'B+',
    'B-',
    'AB+',
    'AB-',
    'O+',
    'O-',
];

// ============================================================
// RESULT-SHEET MEMBERSHIP
// ------------------------------------------------------------
// Which of the four printed result sheets each test belongs to, in the exact
// order the rows appear on that sheet. Keyed by `code` (not name) so a rename
// cannot silently drop a test from the result form; every code is checked below
// and anything that does not resolve is reported at boot instead of vanishing.
//
// A test printed on two sheets is listed under both and appears in each folder
// on the form, but it stays a single catalog row — the value entered is shared,
// so the biochemistry FBS and the serology FBS can never disagree.
// ============================================================
const SHEET_MEMBERS: Record<ResultSheet, string[]> = {
    // RESULTS BLOOD BIOCHEMISTRY
    'RESULTS BLOOD BIOCHEMISTRY': [
        'MJ-031', // FBS
        'MJ-032', // RBS
        'MJ-052', // Urea
        'MJ-128', // Creatinine
        'MJ-049', // Calcium
        'MJ-129', // Magnesium
        'MJ-054', // Uric Acid
        'MJ-050', // Total Protein
        'MJ-037', // Triglyceride
        'MJ-036', // Cholesterol Total
        'MJ-038', // HDL
        'MJ-039', // LDL
        'MJ-057', // Chlorine
        'MJ-130', // Phosphorus
        'MJ-056', // Potassium
        'MJ-055', // Sodium
        'MJ-046', // Transa ALT(GPT)
        'MJ-045', // Transa AST(GOT)
        'MJ-061', // Total Bilirubin
        'MJ-070', // AFP
    ],
    // BIO-MEDICAL ANALYSIS LABORATORY
    'BIO-MEDICAL ANALYSIS LABORATORY': [
        'MJ-016', // Syphilis
        'MJ-010', // Widal TO
        'MJ-011', // Widal TH
        'MJ-020', // Hepatitis B
        'MJ-026', // Hepatitis C
        'MJ-150', // Spot Test
        'MJ-151', // Cold Test
        'MJ-019', // H. Pylori
        'MJ-001', // HGB
        'MJ-031', // FBS  (also on Blood Biochemistry)
        'MJ-032', // RBS  (also on Blood Biochemistry)
        'MJ-004', // M/S
        'MJ-006', // Blood / Group
        'MJ-005', // Sickle Cell
        'MJ-152', // Skin Test
        'MJ-153', // Stool Test
        'MJ-036', // Total Cholesterol (also on Blood Biochemistry)
        'MJ-008', // RDT
        'MJ-154', // MTT
        'MJ-003', // Count WBC (also on Complete Hemogram)
    ],
    // COMPLETE HEMOGRAM
    'COMPLETE HEMOGRAM': [
        'MJ-003', // WBC Count
        'MJ-131', // LYM (%)
        'MJ-132', // Mid (%)
        'MJ-133', // GR (%)
        'MJ-134', // Lym (#)
        'MJ-135', // Mid (#)
        'MJ-136', // GR (#)
        'MJ-137', // RBC Count
        'MJ-138', // HGB
        'MJ-139', // HCT (%)
        'MJ-140', // M.C.V (fl)
        'MJ-141', // M.C.H. (pg)
        'MJ-142', // M.C.H.C (g/dl)
        'MJ-143', // RDW-CV (%)
        'MJ-144', // RDW-SD (fl)
        'MJ-145', // MPV (fl)
        'MJ-146', // PCT (%)
        'MJ-147', // PDW (%)
        'MJ-148', // PLCR (%)
        'MJ-149', // PLCC (L)
    ],
    // URINE CHEMISTRY LAB RESULT-FORM
    'URINE CHEMISTRY LAB RESULT-FORM': [
        'MJ-110', // PH
        'MJ-111', // S/G
        'MJ-104', // BILIRUBIN
        'MJ-103', // UROBILLIOGEN
        'MJ-108', // BLOOD
        'MJ-105', // KETONE
        'MJ-109', // NITRITE
        'MJ-107', // PROTEIN
        'MJ-112', // LEUKOCYTES
        'MJ-106', // GLUCOSE
        'MJ-101', // COLOR
        'MJ-102', // CHARACTER
        'MJ-155', // SEDIMENT
        'MJ-113', // WBC
        'MJ-114', // RBC
        'MJ-115', // EPITHELIA CELLS
        'MJ-116', // CASTS
        'MJ-117', // CRYSTAL
        'MJ-118', // PARASITES
        'MJ-119', // YEASTS
        'MJ-120', // BACTERIA
        'MJ-121', // OTHERS
    ],
};

/**
 * Codes listed in SHEET_MEMBERS that do not exist in the seed. Empty is the
 * healthy state; the service logs anything here on boot so a bad code shows up
 * immediately instead of quietly dropping a row off the result form.
 */
export const UNMATCHED_SHEET_CODES: string[] = [];

for (const [sheet, codes] of Object.entries(SHEET_MEMBERS) as [
    ResultSheet,
    string[],
][]) {
    for (const code of codes) {
        const row = LAB_CATALOG_SEED.find((t) => t.code === code);
        if (!row) {
            UNMATCHED_SHEET_CODES.push(code);
            continue;
        }
        row.sheet = row.sheet ? `${row.sheet},${sheet}` : sheet;
    }
}
