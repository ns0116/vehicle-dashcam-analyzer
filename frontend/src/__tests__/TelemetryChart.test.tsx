import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TelemetryChart } from '../components/TelemetryChart';
import type { FieldROI } from '../components/ROISelector';

// Chart.js requires a canvas implementation; stub it out in jsdom
vi.mock('react-chartjs-2', () => ({
  Line: () => <canvas data-testid="chart-canvas" />,
}));

const mockFields: FieldROI[] = [
  { key: 'speed', name: 'Speed (km/h)', type: 'integer', roi: [0, 0, 100, 50], threshold: 0, invert: false, color: '#00f0ff', min_confidence: 0.3 },
];

describe('TelemetryChart', () => {
  it('renders empty-state message when no data points are provided', () => {
    render(<TelemetryChart fields={mockFields} dataPoints={[]} />);
    expect(screen.getByText(/no telemetry data/i)).toBeInTheDocument();
  });

  it('renders chart when data points are provided', () => {
    const dataPoints = [
      { timestamp: 0, frame: 1, speed: 60 },
      { timestamp: 1, frame: 2, speed: 80 },
    ];
    render(<TelemetryChart fields={mockFields} dataPoints={dataPoints} />);
    expect(screen.getByTestId('chart-canvas')).toBeInTheDocument();
  });
});
