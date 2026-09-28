import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkAreaComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { formatDateTime } from '../../utils/date';

// Tree-shaken registration: only the line chart and the pieces this component
// actually uses are pulled into the bundle.
echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);

/** A single recorded vital set, as returned by GET /patients/:pid/vitals. */
export interface VitalPoint {
  id?: number;
  date?: string;
  bps?: string | number | null;
  bpd?: string | number | null;
  pulse?: string | number | null;
  respiration?: string | number | null;
  oxygen_saturation?: string | number | null;
  temperature?: string | number | null;
  weight?: string | number | null;
  height?: string | number | null;
  BMI?: string | number | null;
  BMI_status?: string | null;
  note?: string | null;
}

export type MetricKey = 'bp' | 'pulse' | 'spo2' | 'resp' | 'temp' | 'weight';

export interface SeriesDef {
  key: keyof VitalPoint;
  name: string;
  color: string;
}

export interface MetricDef {
  label: string;
  short: string;
  icon: string;
  /** Unit for the axis and tooltip. */
  unit: string;
  series: SeriesDef[];
  /** Shaded "normal" band, drawn behind the lines when there is one. */
  band?: [number, number];
}

export const METRICS: Record<MetricKey, MetricDef> = {
  bp: {
    label: 'Blood pressure',
    short: 'BP',
    icon: 'bi-droplet-half',
    unit: 'mmHg',
    series: [
      { key: 'bps', name: 'Systolic', color: '#dc3545' },
      { key: 'bpd', name: 'Diastolic', color: '#0d6efd' },
    ],
    // Normal systolic range, drawn as one band so both lines stay legible.
    band: [90, 120],
  },
  pulse: {
    label: 'Heart rate',
    short: 'HR',
    icon: 'bi-heart-pulse',
    unit: 'bpm',
    series: [{ key: 'pulse', name: 'Pulse', color: '#fd7e14' }],
    band: [60, 100],
  },
  spo2: {
    label: 'Oxygen saturation',
    short: 'SpO\u2082',
    icon: 'bi-lungs',
    unit: '%',
    series: [{ key: 'oxygen_saturation', name: 'SpO\u2082', color: '#0dcaf0' }],
    band: [95, 100],
  },
  resp: {
    label: 'Respiratory rate',
    short: 'RR',
    icon: 'bi-wind',
    unit: '/min',
    series: [{ key: 'respiration', name: 'Respirations', color: '#6f42c1' }],
    band: [12, 20],
  },
  temp: {
    label: 'Temperature',
    short: 'Temp',
    icon: 'bi-thermometer-half',
    unit: '\u00b0C',
    series: [{ key: 'temperature', name: 'Temperature', color: '#e83e8c' }],
    band: [36.1, 37.5],
  },
  weight: {
    label: 'Weight',
    short: 'Weight',
    icon: 'bi-speedometer',
    unit: 'kg',
    series: [{ key: 'weight', name: 'Weight', color: '#198754' }],
  },
};

export const METRIC_ORDER: MetricKey[] = ['bp', 'pulse', 'spo2', 'temp', 'resp', 'weight'];

const toNum = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * MySQL DATETIME strings ("2026-09-22 18:42:37") are not ISO, so normalise them
 * before parsing — otherwise they parse as Invalid Date in some engines.
 */
export const toTime = (v: unknown): number | null => {
  if (!v) return null;
  const t = new Date(String(v).trim().replace(' ', 'T')).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * Temperatures are stored in either °C or °F depending on how the clinic
 * records them; a human body temperature above 45 can only be Fahrenheit.
 * This reports the unit the series should be *displayed* in.
 */
export function isFahrenheit(vitals: VitalPoint[]): boolean {
  return (vitals || []).some((v) => (toNum(v.temperature) ?? 0) > 45);
}

/** Metrics this patient actually has readings for, in display order. */
export function availableMetrics(vitals: VitalPoint[]): MetricKey[] {
  const keys = METRIC_ORDER.filter((k) =>
    (vitals || []).some((v) => METRICS[k].series.some((s) => toNum(v[s.key]) != null)),
  );
  return keys.length ? keys : METRIC_ORDER;
}

export interface TrendSeries {
  name: string;
  color: string;
  data: [number, number][];
}

export interface TrendResult {
  /** Axis / tooltip unit, already accounting for the °C → °F decision. */
  unit: string;
  /** Normal reference band, in display units. */
  band?: [number, number];
  series: TrendSeries[];
  /** Dated readings available for this metric's first series. */
  points: number;
  /** Dated readings overall — drives the "N readings" caption. */
  readings: number;
}

/**
 * Turns raw `form_vitals` rows into one metric's chart series: oldest first,
 * timestamps paired with values, converted to display units. Readings missing
 * the metric or a date are dropped rather than plotted as zero.
 */
export function buildTrend(vitals: VitalPoint[], metric: MetricKey): TrendResult {
  const def = METRICS[metric];
  const fahrenheit = isFahrenheit(vitals);
  const unit = metric === 'temp' ? (fahrenheit ? '\u00b0F' : '\u00b0C') : def.unit;
  const band =
    metric === 'temp' && fahrenheit && def.band
      ? ([97, 99.5] as [number, number])
      : def.band;

  const rows = (vitals || [])
    .map((v) => ({ v, t: toTime(v.date) }))
    .filter((r): r is { v: VitalPoint; t: number } => r.t != null)
    .sort((a, b) => a.t - b.t);

  const series: TrendSeries[] = def.series
    .map((s) => ({
      name: s.name,
      color: s.color,
      data: rows
        .map((r) => {
          let val = toNum(r.v[s.key]);
          if (val == null) return null;
          if (metric === 'temp') {
            // Decide this reading's own unit, then normalise it to the series
            // unit. Values already in the series unit are left untouched, so a
            // plain Celsius series is never mangled into nonsense.
            const readingIsF = val > 45;
            if (fahrenheit && !readingIsF) val = (val * 9) / 5 + 32;
            if (!fahrenheit && readingIsF) val = ((val - 32) * 5) / 9;
          }
          return [r.t, Math.round(val * 100) / 100] as [number, number];
        })
        .filter((p): p is [number, number] => p != null),
    }))
    .filter((s) => s.data.length > 0);

  return {
    unit,
    band,
    series,
    points: series[0]?.data.length ?? 0,
    readings: rows.length,
  };
}

export default function VitalsTrendChart({
  vitals,
  height = 260,
}: {
  vitals: VitalPoint[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [metric, setMetric] = useState<MetricKey>('bp');

  const available = useMemo(() => availableMetrics(vitals), [vitals]);
  const trend = useMemo(() => buildTrend(vitals, metric), [vitals, metric]);

  const option = useMemo<EChartsCoreOption>(() => {
    const { unit, band, series, points } = trend;

    return {
      grid: { left: 8, right: 14, top: series.length > 1 ? 30 : 22, bottom: 6, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        formatter: (params: any) => {
          const ps = Array.isArray(params) ? params : [params];
          if (!ps.length || !ps[0]?.value) return '';
          const when = formatDateTime(new Date(ps[0].value[0]));
          const lines = ps
            .filter((p: any) => p.value?.[1] != null)
            .map((p: any) => `${p.marker} ${p.seriesName}: <b>${p.value[1]}</b> ${unit}`);
          return `<div class="small"><div class="text-muted">${when}</div>${lines.join('<br/>')}</div>`;
        },
      },
      legend:
        series.length > 1
          ? { top: 0, right: 0, itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 11 } }
          : undefined,
      xAxis: {
        type: 'time',
        axisLabel: { fontSize: 10, hideOverlap: true },
        axisLine: { lineStyle: { color: '#dee2e6' } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: unit,
        nameTextStyle: { fontSize: 10, color: '#6c757d' },
        // A tight range, so the movement that matters stays visible — the
        // shaded band supplies the absolute context.
        scale: true,
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { color: '#f0f2f5' } },
      },
      dataZoom:
        points > 12
          ? [
              { type: 'inside', throttle: 50 },
              {
                type: 'slider',
                height: 14,
                bottom: 0,
                borderColor: 'transparent',
                fillerColor: 'rgba(13,110,253,0.12)',
              },
            ]
          : undefined,
      series: series.map((s, i) => ({
        name: s.name,
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: points > 40 ? 4 : 7,
        showSymbol: points <= 60,
        connectNulls: true,
        lineStyle: { width: 2.5, color: s.color },
        itemStyle: { color: s.color },
        emphasis: { focus: 'series' },
        // Shade the normal range behind the first series only.
        markArea:
          i === 0 && band
            ? {
                silent: true,
                itemStyle: { color: 'rgba(25,135,84,0.09)' },
                label: {
                  show: true,
                  position: 'insideTopLeft',
                  fontSize: 9,
                  color: '#198754',
                  formatter: `normal ${band[0]}\u2013${band[1]}`,
                },
                data: [[{ yAxis: band[0] }, { yAxis: band[1] }]],
              }
            : undefined,
        data: s.data,
      })),
    };
  }, [trend]);

  // Create the instance once, keep it sized, and dispose on unmount.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    // ResizeObserver is not present in every test/older environment.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => chart.resize()) : null;
    ro?.observe(containerRef.current);
    return () => {
      ro?.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option as any, true);
  }, [option]);

  // Keep the selection valid if the patient has no data for the chosen metric.
  useEffect(() => {
    if (!available.includes(metric)) setMetric(available[0]);
  }, [available, metric]);

  const { readings, points } = trend;

  return (
    <div>
      <div className="d-flex flex-wrap align-items-center gap-1 mb-2">
        {available.map((k) => {
          const m = METRICS[k];
          return (
            <button
              key={k}
              type="button"
              className={`btn btn-sm rounded-pill ${metric === k ? 'btn-primary' : 'btn-outline-secondary'}`}
              style={{ fontSize: '0.72rem' }}
              onClick={() => setMetric(k)}
              title={m.label}
              aria-pressed={metric === k}
            >
              <i className={`bi ${m.icon} me-1`}></i>
              {m.short}
            </button>
          );
        })}
        <span className="text-muted ms-auto" style={{ fontSize: '0.7rem' }}>
          {points} reading{points === 1 ? '' : 's'} · {readings} dated
        </span>
      </div>

      {points > 0 ? (
        <div ref={containerRef} style={{ width: '100%', height }} data-testid="vitals-trend-canvas" />
      ) : (
        <div className="text-center text-muted small py-5">
          <i className="bi bi-graph-up d-block mb-2" style={{ fontSize: '1.4rem' }}></i>
          No dated vitals recorded yet — a trend needs at least one reading with a date.
        </div>
      )}
    </div>
  );
}
