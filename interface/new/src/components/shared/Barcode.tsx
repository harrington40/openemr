import { useMemo } from 'react';

/**
 * Deterministic barcode-like SVG rendered from a seed string.
 * Used on pharmacy labels, lab result forms, and lab order lists so a
 * printed/scanned identifier is available without a real barcode font.
 */
export default function Barcode({ seed, width = 110, height = 34 }: { seed: string; width?: number; height?: number }) {
  const bars = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const out: number[] = [];
    let x = h >>> 0;
    for (let i = 0; i < 48; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      out.push((x >> 16) % 3 === 0 ? 1 : 2); // 1 = thin, 2 = thick
    }
    return out;
  }, [seed]);

  return (
    <svg width={width} height={height} viewBox="0 0 140 40" className="d-block" role="img" aria-label={`Barcode ${seed}`}>
      {bars.map((w, i) => (
        <rect key={i} x={i * 2.9} y={0} width={w === 2 ? 2.4 : 1.2} height="34" fill="#1e293b" rx="0.4" />
      ))}
    </svg>
  );
}
