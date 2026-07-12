import React, { useRef, useState, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import type { ChartOptions, TooltipItem } from 'chart.js';
import { Line } from 'react-chartjs-2';
import zoomPlugin from 'chartjs-plugin-zoom';
import type { FieldROI } from './ROISelector';
import type { TelemetryDataPoint } from '../types';
import { RefreshCw, TrendingUp } from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  zoomPlugin,
);

interface TelemetryChartProps {
  fields: FieldROI[];
  dataPoints: TelemetryDataPoint[];
}

type LinePointData = { x: number; y: string | number | null };

/**
 * Removes statistical outliers (values > stdThreshold * rolling σ from the rolling mean)
 * then applies a moving-average smoothing pass on the cleaned values.
 */
function computeSmoothed(
  values: (number | null)[],
  window: number,
  stdThreshold: number,
): (number | null)[] {
  const n = values.length;
  const half = Math.floor(window / 2);

  // Pass 1: outlier removal using rolling mean/std
  const filtered: (number | null)[] = values.map((v, i) => {
    if (v === null) return null;
    const start = Math.max(0, i - half);
    const end = Math.min(n, i + half + 1);
    const win = (values.slice(start, end).filter(x => x !== null)) as number[];
    if (win.length < 2) return v;
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    const std = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length);
    if (std > 0 && Math.abs(v - mean) > stdThreshold * std) return null;
    return v;
  });

  // Pass 2: moving average on filtered values
  return filtered.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(n, i + half + 1);
    const win = (filtered.slice(start, end).filter(x => x !== null)) as number[];
    return win.length > 0 ? win.reduce((a, b) => a + b, 0) / win.length : null;
  });
}

export const TelemetryChart: React.FC<TelemetryChartProps> = ({ fields, dataPoints }) => {
  const chartRef = useRef<ChartJS<'line', LinePointData[]> | null>(null);
  const [smoothEnabled, setSmoothEnabled] = useState(false);
  const [smoothWindow, setSmoothWindow] = useState(7);
  const [stdThreshold, setStdThreshold] = useState(3);

  const resetZoom = () => chartRef.current?.resetZoom();

  // Precompute smoothed values for each numeric field when smoothing is enabled
  const smoothedMap = useMemo(() => {
    if (!smoothEnabled) return null;
    const map: Record<string, (number | null)[]> = {};
    for (const field of fields) {
      if (field.type === 'string') continue;
      const raw = dataPoints.map(dp => {
        const v = dp[field.key];
        return typeof v === 'number' ? v : null;
      });
      map[field.key] = computeSmoothed(raw, smoothWindow, stdThreshold);
    }
    return map;
  }, [smoothEnabled, smoothWindow, stdThreshold, fields, dataPoints]);

  const chartData = {
    labels: dataPoints.map((dp) => dp.timestamp),
    datasets: fields.flatMap((field) => {
      const isGear = field.key === 'gear';
      const yAxisID = isGear ? 'yGear' : 'yDefault';

      const rawDataset = {
        label: smoothEnabled ? `${field.name} (raw)` : field.name,
        data: dataPoints.map((dp) => ({ x: dp.timestamp, y: dp[field.key] })),
        borderColor: smoothEnabled ? `${field.color}55` : field.color,
        backgroundColor: `${field.color}10`,
        borderWidth: smoothEnabled ? 1 : 2,
        borderDash: smoothEnabled ? [4, 4] : [],
        pointRadius: dataPoints.length > 200 ? 0 : 2,
        pointHoverRadius: 4,
        tension: 0.15,
        spanGaps: true,
        yAxisID,
      };

      if (!smoothEnabled || !smoothedMap || field.type === 'string') {
        return [rawDataset];
      }

      const smoothedVals = smoothedMap[field.key] ?? [];
      const smoothedDataset = {
        label: `${field.name} (smoothed)`,
        data: dataPoints.map((dp, i) => ({ x: dp.timestamp, y: smoothedVals[i] ?? null })),
        borderColor: field.color,
        backgroundColor: `${field.color}20`,
        borderWidth: 2,
        borderDash: [],
        pointRadius: 0,
        pointHoverRadius: 5,
        tension: 0.3,
        spanGaps: true,
        yAxisID,
      };

      return [rawDataset, smoothedDataset];
    }),
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          color: '#e2e8f0',
          font: { family: 'Outfit', size: 12, weight: 500 },
          padding: 20,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(9, 10, 15, 0.9)',
        titleColor: '#00f0ff',
        bodyColor: '#e2e8f0',
        borderColor: 'rgba(0, 240, 255, 0.2)',
        borderWidth: 1,
        titleFont: { family: 'Outfit', weight: 'bold' },
        bodyFont: { family: 'JetBrains Mono' },
        padding: 10,
        callbacks: {
          title: (context: TooltipItem<'line'>[]) => `Time: ${context[0].label}s`,
        },
      },
      zoom: {
        zoom: {
          drag: {
            enabled: true,
            backgroundColor: 'rgba(0, 240, 255, 0.1)',
            borderColor: 'rgba(0, 240, 255, 0.4)',
            borderWidth: 1,
          },
          mode: 'x',
        },
        pan: { enabled: true, mode: 'x' },
      },
    },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'Time (seconds)', color: '#64748b', font: { family: 'Outfit', size: 12 } },
        grid: { color: 'rgba(255, 255, 255, 0.04)' },
        ticks: { color: '#64748b', font: { family: 'JetBrains Mono' } },
      },
      yDefault: {
        type: 'linear',
        display: true,
        position: 'left',
        title: { display: true, text: 'Values (Speed, RPM, etc.)', color: '#64748b', font: { family: 'Outfit', size: 12 } },
        grid: { color: 'rgba(255, 255, 255, 0.04)' },
        ticks: { color: '#64748b', font: { family: 'JetBrains Mono' } },
      },
      yGear: {
        type: 'linear',
        display: fields.some((f) => f.key === 'gear'),
        position: 'right',
        title: { display: true, text: 'Gear', color: '#64748b', font: { family: 'Outfit', size: 12 } },
        grid: { drawOnChartArea: false },
        ticks: { color: '#64748b', stepSize: 1, font: { family: 'JetBrains Mono' } },
      },
    },
  };

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Telemetry Timeline</span>
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Drag to zoom. Scroll/pan to explore. Double click or click reset to reset zoom.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Smoothing toggle */}
          <button
            className={`btn ${smoothEnabled ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSmoothEnabled(v => !v)}
            style={{ padding: '6px 12px', fontSize: '0.75rem' }}
            title="Toggle outlier removal and moving-average smoothing"
          >
            <TrendingUp size={12} /> {smoothEnabled ? 'Smooth: ON' : 'Smooth: OFF'}
          </button>

          <button
            className="btn btn-secondary"
            onClick={resetZoom}
            style={{ padding: '6px 12px', fontSize: '0.75rem' }}
          >
            <RefreshCw size={12} /> Reset Zoom
          </button>
        </div>
      </div>

      {/* Smoothing controls */}
      {smoothEnabled && (
        <div style={{
          display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center',
          padding: '10px 14px', borderRadius: 8,
          background: 'rgba(0, 240, 255, 0.05)',
          border: '1px solid rgba(0, 240, 255, 0.15)',
          fontSize: '0.8rem',
        }}>
          <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Smoothing Settings</span>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
            Window
            <input
              type="range" min="3" max="31" step="2"
              value={smoothWindow}
              onChange={(e) => setSmoothWindow(parseInt(e.target.value))}
              style={{ accentColor: 'var(--color-primary)', width: 80 }}
            />
            <span className="mono-val" style={{ color: '#fff', minWidth: 20 }}>{smoothWindow}</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
            Outlier σ
            <input
              type="range" min="1" max="6" step="0.5"
              value={stdThreshold}
              onChange={(e) => setStdThreshold(parseFloat(e.target.value))}
              style={{ accentColor: 'var(--color-primary)', width: 80 }}
            />
            <span className="mono-val" style={{ color: '#fff', minWidth: 30 }}>{stdThreshold}σ</span>
          </label>

          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            Dashed = raw data &nbsp;|&nbsp; Solid = smoothed
          </span>
        </div>
      )}

      <div style={{ height: 350, position: 'relative' }}>
        {dataPoints.length === 0 ? (
          <div style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', fontSize: '0.9rem',
            border: '1px dashed rgba(255,255,255,0.05)', borderRadius: 8,
          }}>
            No telemetry data processed yet.
          </div>
        ) : (
          <Line ref={chartRef} data={chartData} options={options} />
        )}
      </div>
    </div>
  );
};
