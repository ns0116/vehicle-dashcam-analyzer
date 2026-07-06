import React, { useRef } from 'react';
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
import { RefreshCw } from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  zoomPlugin
);

interface TelemetryChartProps {
  fields: FieldROI[];
  dataPoints: TelemetryDataPoint[];
}

type LinePointData = { x: number; y: string | number | null };

export const TelemetryChart: React.FC<TelemetryChartProps> = ({ fields, dataPoints }) => {
  const chartRef = useRef<ChartJS<'line', LinePointData[]> | null>(null);

  const resetZoom = () => {
    if (chartRef.current) {
      chartRef.current.resetZoom();
    }
  };

  // Convert raw dataPoints list into ChartJS format
  const chartData = {
    labels: dataPoints.map((dp) => dp.timestamp),
    datasets: fields.map((field) => {
      // Is it gear? Let's use the gear axis
      const isGear = field.key === 'gear';
      
      return {
        label: field.name,
        data: dataPoints.map((dp) => ({
          x: dp.timestamp,
          y: dp[field.key]
        })),
        borderColor: field.color,
        backgroundColor: `${field.color}15`,
        borderWidth: 2,
        pointRadius: dataPoints.length > 200 ? 0 : 2, // Hide points if there are too many data points
        pointHoverRadius: 5,
        tension: 0.15,
        spanGaps: true, // Don't break line for OCR failures (None/null)
        yAxisID: isGear ? 'yGear' : 'yDefault'
      };
    })
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          color: '#e2e8f0',
          font: {
            family: 'Outfit',
            size: 12,
            weight: 500
          },
          padding: 20
        }
      },
      tooltip: {
        backgroundColor: 'rgba(9, 10, 15, 0.9)',
        titleColor: '#00f0ff',
        bodyColor: '#e2e8f0',
        borderColor: 'rgba(0, 240, 255, 0.2)',
        borderWidth: 1,
        titleFont: {
          family: 'Outfit',
          weight: 'bold'
        },
        bodyFont: {
          family: 'JetBrains Mono'
        },
        padding: 10,
        callbacks: {
          title: (context: TooltipItem<'line'>[]) => `Time: ${context[0].label}s`
        }
      },
      zoom: {
        zoom: {
          drag: {
            enabled: true,
            backgroundColor: 'rgba(0, 240, 255, 0.1)',
            borderColor: 'rgba(0, 240, 255, 0.4)',
            borderWidth: 1
          },
          mode: 'x',
        },
        pan: {
          enabled: true,
          mode: 'x',
        }
      }
    },
    scales: {
      x: {
        type: 'linear',
        title: {
          display: true,
          text: 'Time (seconds)',
          color: '#64748b',
          font: {
            family: 'Outfit',
            size: 12
          }
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.04)',
        },
        ticks: {
          color: '#64748b',
          font: {
            family: 'JetBrains Mono'
          }
        }
      },
      yDefault: {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: 'Values (Speed, RPM, etc.)',
          color: '#64748b',
          font: {
            family: 'Outfit',
            size: 12
          }
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.04)'
        },
        ticks: {
          color: '#64748b',
          font: {
            family: 'JetBrains Mono'
          }
        }
      },
      yGear: {
        type: 'linear',
        display: fields.some((f) => f.key === 'gear'),
        position: 'right',
        title: {
          display: true,
          text: 'Gear',
          color: '#64748b',
          font: {
            family: 'Outfit',
            size: 12
          }
        },
        grid: {
          drawOnChartArea: false // Only show grid lines for left axis
        },
        ticks: {
          color: '#64748b',
          stepSize: 1,
          font: {
            family: 'JetBrains Mono'
          }
        }
      }
    }
  };

  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Telemetry Timeline</span>
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Drag to zoom. Scroll/pan to explore. Double click or click reset to reset zoom.
          </p>
        </div>
        
        <button 
          className="btn btn-secondary" 
          onClick={resetZoom}
          style={{ padding: '6px 12px', fontSize: '0.75rem' }}
        >
          <RefreshCw size={12} /> Reset Zoom
        </button>
      </div>

      <div style={{ height: 350, position: 'relative' }}>
        {dataPoints.length === 0 ? (
          <div 
            style={{ 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.9rem',
              border: '1px dashed rgba(255,255,255,0.05)',
              borderRadius: 8
            }}
          >
            No telemetry data processed yet.
          </div>
        ) : (
          <Line ref={chartRef} data={chartData} options={options} />
        )}
      </div>
    </div>
  );
};
