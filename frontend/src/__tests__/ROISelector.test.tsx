import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ROISelector } from '../components/ROISelector';
import type { FieldROI } from '../components/ROISelector';

const baseField: FieldROI = {
  key: 'speed',
  name: 'Speed',
  type: 'integer',
  roi: [10, 10, 100, 50],
  threshold: 0,
  invert: false,
  color: '#00f0ff',
  min_confidence: 0.3,
};

describe('ROISelector', () => {
  it('renders the calibration heading', () => {
    render(
      <ROISelector
        frameUrl=""
        fields={[baseField]}
        selectedFieldKey="speed"
        onUpdateFields={vi.fn()}
        videoWidth={1280}
        videoHeight={720}
      />
    );
    expect(screen.getByText(/video feed calibration/i)).toBeInTheDocument();
  });

  it('shows drawing mode label when a field is selected', () => {
    render(
      <ROISelector
        frameUrl=""
        fields={[baseField]}
        selectedFieldKey="speed"
        onUpdateFields={vi.fn()}
        videoWidth={1280}
        videoHeight={720}
      />
    );
    expect(screen.getByText(/drawing mode/i)).toBeInTheDocument();
  });

  it('does not show drawing mode label when no field is selected', () => {
    render(
      <ROISelector
        frameUrl=""
        fields={[baseField]}
        selectedFieldKey={null}
        onUpdateFields={vi.fn()}
        videoWidth={1280}
        videoHeight={720}
      />
    );
    expect(screen.queryByText(/drawing mode/i)).not.toBeInTheDocument();
  });
});
