import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VitalsTrendChart, {
  buildTrend,
  availableMetrics,
  isFahrenheit,
  toTime,
  type VitalPoint,
} from '../components/vitals/VitalsTrendChart';
import VitalsTab from '../features/patients/tabs/VitalsTab';
import VitalsViewToggle from '../components/vitals/VitalsViewToggle';

// jsdom has no canvas, so stub the ECharts runtime and assert on setOption.
const { initMock, setOptionMock, disposeMock } = vi.hoisted(() => {
  const setOptionMock = vi.fn();
  const disposeMock = vi.fn();
  const initMock = vi.fn(() => ({ setOption: setOptionMock, resize: vi.fn(), dispose: disposeMock }));
  return { initMock, setOptionMock, disposeMock };
});

vi.mock('echarts/core', () => ({ use: vi.fn(), init: initMock }));
vi.mock('echarts/charts', () => ({ LineChart: {} }));
vi.mock('echarts/components', () => ({
  GridComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
  DataZoomComponent: {},
  MarkAreaComponent: {},
}));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

/** Shaped like GET /patients/:pid/vitals — newest first, numerics as strings. */
const VITALS: VitalPoint[] = [
  { id: 3, date: '2026-09-20 09:15:00', bps: '128', bpd: '82', pulse: 78, respiration: 16, oxygen_saturation: 97, temperature: 36.9, weight: 72 },
  { id: 2, date: '2026-09-10 08:05:00', bps: '134', bpd: '86', pulse: 84, respiration: 18, oxygen_saturation: 96, temperature: 37.2, weight: 73 },
  { id: 1, date: '2026-09-01 07:45:00', bps: '142', bpd: '91', pulse: 92, respiration: 20, oxygen_saturation: 95, temperature: 37.8, weight: 74 },
];

describe('toTime', () => {
  it('parses MySQL DATETIME strings that are not ISO', () => {
    expect(toTime('2026-09-20 09:15:00')).toBe(new Date('2026-09-20T09:15:00').getTime());
  });

  it('returns null for missing or unparseable values', () => {
    expect(toTime(null)).toBeNull();
    expect(toTime('')).toBeNull();
    expect(toTime(undefined)).toBeNull();
    expect(toTime('not-a-date')).toBeNull();
  });
});

describe('isFahrenheit', () => {
  it('treats body temperatures above 45 as Fahrenheit', () => {
    expect(isFahrenheit([{ temperature: 98.6 }])).toBe(true);
  });

  it('treats plausible Celsius values as Celsius', () => {
    expect(isFahrenheit([{ temperature: 36.8 }, { temperature: 38.2 }])).toBe(false);
  });

  it('is false when no temperature was recorded', () => {
    expect(isFahrenheit([{ pulse: 80 }])).toBe(false);
    expect(isFahrenheit([])).toBe(false);
  });
});

describe('availableMetrics', () => {
  it('offers only the metrics the patient has readings for, in display order', () => {
    expect(availableMetrics([{ bps: 120, bpd: 80, pulse: 70 }])).toEqual(['bp', 'pulse']);
  });

  it('ignores zero and blank readings', () => {
    expect(availableMetrics([{ pulse: 0, respiration: '', bps: '130', bpd: '85' }])).toEqual(['bp']);
  });

  it('falls back to every metric when the patient has no usable data', () => {
    expect(availableMetrics([])).toEqual(['bp', 'pulse', 'spo2', 'temp', 'resp', 'weight']);
  });
});

describe('buildTrend', () => {
  it('plots blood pressure as two series, oldest reading first', () => {
    const t = buildTrend(VITALS, 'bp');
    expect(t.series.map((s) => s.name)).toEqual(['Systolic', 'Diastolic']);
    expect(t.unit).toBe('mmHg');
    expect(t.band).toEqual([90, 120]);
    // Input arrived newest-first; the chart must run left-to-right in time.
    expect(t.series[0].data.map((d) => d[1])).toEqual([142, 134, 128]);
    expect(t.series[1].data.map((d) => d[1])).toEqual([91, 86, 82]);
    expect(t.series[0].data[0][0]).toBeLessThan(t.series[0].data[2][0]);
  });

  it('plots a single series for the other vitals', () => {
    expect(buildTrend(VITALS, 'pulse').series).toHaveLength(1);
    expect(buildTrend(VITALS, 'pulse').series[0].data.map((d) => d[1])).toEqual([92, 84, 78]);
    expect(buildTrend(VITALS, 'spo2').unit).toBe('%');
    expect(buildTrend(VITALS, 'resp').unit).toBe('/min');
    expect(buildTrend(VITALS, 'weight').series[0].data.map((d) => d[1])).toEqual([74, 73, 72]);
  });

  it('drops readings that have no date instead of plotting them at zero', () => {
    const withUndated = [...VITALS, { id: 9, bps: '118', bpd: '76' }];
    const t = buildTrend(withUndated, 'bp');
    expect(t.series[0].data).toHaveLength(3);
    expect(t.readings).toBe(3);
    expect(t.points).toBe(3);
  });

  it('drops readings missing the chosen metric', () => {
    const t = buildTrend([{ date: '2026-09-01 10:00:00', bps: '120', bpd: '80' }], 'pulse');
    expect(t.series).toHaveLength(0);
    expect(t.points).toBe(0);
    expect(t.readings).toBe(1);
  });

  it('keeps temperatures in Celsius when they were recorded in Celsius', () => {
    const t = buildTrend(VITALS, 'temp');
    expect(t.unit).toBe('\u00b0C');
    expect(t.band).toEqual([36.1, 37.5]);
    expect(t.series[0].data.map((d) => d[1])).toEqual([37.8, 37.2, 36.9]);
  });

  it('converts Fahrenheit temperatures and widens the band to match', () => {
    const t = buildTrend([{ date: '2026-09-01 10:00:00', temperature: 100.4 }], 'temp');
    expect(t.unit).toBe('\u00b0F');
    expect(t.band).toEqual([97, 99.5]);
    // Already Fahrenheit — it must NOT be converted a second time.
    expect(t.series[0].data[0][1]).toBe(100.4);
  });

  it('normalises a mixed Celsius/Fahrenheit series to one unit', () => {
    const t = buildTrend(
      [
        { date: '2026-09-01 10:00:00', temperature: 37 },
        { date: '2026-09-02 10:00:00', temperature: 100.4 },
      ],
      'temp',
    );
    expect(t.unit).toBe('\u00b0F');
    expect(t.series[0].data.map((d) => d[1])).toEqual([98.6, 100.4]);
  });

  it('rounds plotted values to two decimals', () => {
    const t = buildTrend([{ date: '2026-09-01 10:00:00', weight: 72.456 }], 'weight');
    expect(t.series[0].data[0][1]).toBe(72.46);
  });

  it('returns an empty trend for no readings rather than throwing', () => {
    const t = buildTrend([], 'bp');
    expect(t.series).toEqual([]);
    expect(t.points).toBe(0);
    expect(t.readings).toBe(0);
  });
});

describe('VitalsTrendChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers a toggle for every metric the patient has, with BP selected first', () => {
    render(<VitalsTrendChart vitals={VITALS} />);

    for (const label of ['Blood pressure', 'Heart rate', 'Oxygen saturation', 'Temperature', 'Respiratory rate', 'Weight']) {
      expect(screen.getByTitle(label)).toBeInTheDocument();
    }
    expect(screen.getByTitle('Blood pressure')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('Heart rate')).toHaveAttribute('aria-pressed', 'false');
  });

  it('only offers metrics that have readings', () => {
    render(<VitalsTrendChart vitals={[{ date: '2026-09-01 10:00:00', bps: 120, bpd: 80 }]} />);

    expect(screen.getByTitle('Blood pressure')).toBeInTheDocument();
    expect(screen.queryByTitle('Temperature')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Weight')).not.toBeInTheDocument();
  });

  it('switches the plotted metric when a toggle is clicked', () => {
    render(<VitalsTrendChart vitals={VITALS} />);
    const before = setOptionMock.mock.calls.length;

    fireEvent.click(screen.getByTitle('Heart rate'));

    expect(screen.getByTitle('Heart rate')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('Blood pressure')).toHaveAttribute('aria-pressed', 'false');
    expect(setOptionMock.mock.calls.length).toBeGreaterThan(before);

    // The last option handed to ECharts is the pulse series, not blood pressure.
    const lastOption: any = setOptionMock.mock.calls[setOptionMock.mock.calls.length - 1][0];
    expect(lastOption.series).toHaveLength(1);
    expect(lastOption.series[0].name).toBe('Pulse');
    expect(lastOption.yAxis.name).toBe('bpm');
  });

  it('draws the normal reference band on the chart', () => {
    render(<VitalsTrendChart vitals={VITALS} />);

    const option: any = setOptionMock.mock.calls[setOptionMock.mock.calls.length - 1][0];
    expect(option.series[0].markArea.data).toEqual([[{ yAxis: 90 }, { yAxis: 120 }]]);
  });

  it('inits the chart once and disposes it on unmount', () => {
    const { unmount } = render(<VitalsTrendChart vitals={VITALS} />);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(disposeMock).not.toHaveBeenCalled();

    unmount();
    expect(disposeMock).toHaveBeenCalledTimes(1);
  });

  it('explains itself instead of drawing an empty chart when there is no data', () => {
    render(<VitalsTrendChart vitals={[]} />);

    expect(screen.queryByTestId('vitals-trend-canvas')).not.toBeInTheDocument();
    expect(screen.getByText(/No dated vitals recorded yet/)).toBeInTheDocument();
    expect(initMock).not.toHaveBeenCalled();
  });

  it('hides readings with no date from the chart but counts them', () => {
    render(<VitalsTrendChart vitals={[...VITALS, { id: 9, bps: '118', bpd: '76' }]} />);

    expect(screen.getByTestId('vitals-trend-canvas')).toBeInTheDocument();
    expect(screen.getByText('3 readings · 3 dated')).toBeInTheDocument();
  });
});

describe('VitalsTab view toggle', () => {
  const renderTab = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <VitalsTab vitals={VITALS} patientId="1" />
      </QueryClientProvider>,
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens on the chart', async () => {
    renderTab();
    expect(await screen.findByTestId('vitals-trend-canvas')).toBeInTheDocument();
    expect(screen.queryByText('History')).not.toBeInTheDocument();
  });

  it('switches to the table and back — the toggle must survive the switch', async () => {
    renderTab();
    await screen.findByTestId('vitals-trend-canvas');

    fireEvent.click(screen.getByTitle('Table view'));
    expect(screen.queryByTestId('vitals-trend-canvas')).not.toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();

    // The toggle sits outside the card it hides, so Chart stays reachable.
    fireEvent.click(screen.getByTitle('Chart view'));
    expect(await screen.findByTestId('vitals-trend-canvas')).toBeInTheDocument();
  });

  it('shows the chart and the table together when asked', async () => {
    renderTab();
    await screen.findByTestId('vitals-trend-canvas');

    fireEvent.click(screen.getByTitle('Both view'));

    expect(await screen.findByTestId('vitals-trend-canvas')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
  });

  it('still lets a reading be recorded when there is no history yet', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <VitalsTab vitals={[]} patientId="1" />
      </QueryClientProvider>,
    );

    expect(screen.getByText('No vital signs recorded yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('vitals-trend-canvas')).not.toBeInTheDocument();
  });
});

describe('VitalsViewToggle', () => {
  it('offers the same three views everywhere it is used', () => {
    render(<VitalsViewToggle view="chart" onChange={vi.fn()} />);

    for (const label of ['Chart', 'Table', 'Both']) {
      expect(screen.getByTitle(`${label} view`)).toBeInTheDocument();
    }
  });

  it('marks the active view', () => {
    render(<VitalsViewToggle view="both" onChange={vi.fn()} />);

    expect(screen.getByTitle('Both view')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTitle('Chart view')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTitle('Table view')).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the chosen view', () => {
    const onChange = vi.fn();
    render(<VitalsViewToggle view="chart" onChange={onChange} />);

    fireEvent.click(screen.getByTitle('Table view'));
    expect(onChange).toHaveBeenCalledWith('table');
  });
});
