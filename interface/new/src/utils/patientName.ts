export interface PatientNameLike {
  fname?: string | null;
  mname?: string | null;
  lname?: string | null;
  suffix?: string | null;
}

/** "First [Middle] Last [Suffix]" — e.g. "John Q. Public Jr". */
export function formatPatientName(p: PatientNameLike | null | undefined): string {
  if (!p) return '';
  const first = [p.fname, p.mname].filter(Boolean).join(' ');
  const last = [p.lname, p.suffix].filter(Boolean).join(' ');
  return [first, last].filter(Boolean).join(' ');
}

/** "Last [Suffix], First [Middle]" — e.g. "Public Jr, John Q.". */
export function formatPatientNameLastFirst(p: PatientNameLike | null | undefined): string {
  if (!p) return '';
  const first = [p.fname, p.mname].filter(Boolean).join(' ');
  const last = [p.lname, p.suffix].filter(Boolean).join(' ');
  if (last && first) return `${last}, ${first}`;
  return last || first;
}
