import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeSvgProps {
  value: string;
  height?: number;
  width?: number;
  displayValue?: boolean;
  fontSize?: number;
  className?: string;
  margin?: number;
}

/**
 * Renders a real, scannable Code-128 barcode as SVG using JsBarcode.
 */
export default function BarcodeSvg({
  value,
  height = 40,
  width = 1.6,
  displayValue = true,
  fontSize = 12,
  className,
  margin = 0,
}: BarcodeSvgProps) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        height,
        width,
        displayValue,
        fontSize,
        margin,
        background: '#ffffff',
        lineColor: '#1e293b',
        valid: () => {
          /* encodable */
        },
      });
    } catch {
      // Ignore un-encodable values; keep the previous/empty SVG.
    }
  }, [value, height, width, displayValue, fontSize, margin]);

  return <svg ref={ref} className={className} style={{ maxWidth: '100%' }} />;
}
