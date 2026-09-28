import { Suspense, lazy } from 'react';
import type { VitalPoint } from './VitalsTrendChart';

/**
 * Lazy entry point for the vitals trend chart.
 *
 * ECharts is ~180 kB gzipped, and the chart only appears on the patient chart
 * vitals tab, the triage screening modal and the rounds page — so it is loaded
 * on demand instead of in the main bundle every page pays for.
 *
 * The implementation (and its pure helpers) live in VitalsTrendChart.tsx.
 */
const Chart = lazy(() => import('./VitalsTrendChart'));

function Placeholder({ height }: { height: number }) {
  // Same height as the chart, so resolving the chunk does not shift the page.
  return (
    <div
      className="d-flex align-items-center justify-content-center text-muted small"
      style={{ height }}
      role="status"
      aria-live="polite"
    >
      <span className="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
      Loading trend chart…
    </div>
  );
}

export default function VitalsTrend({
  vitals,
  height = 260,
}: {
  vitals: VitalPoint[];
  height?: number;
}) {
  return (
    <Suspense fallback={<Placeholder height={height} />}>
      <Chart vitals={vitals} height={height} />
    </Suspense>
  );
}
