export interface TelemetryDataPoint {
  timestamp: number;
  frame: number;
  [fieldKey: string]: number | string | null;
}

export interface PollingStatus {
  status: 'idle' | 'running' | 'completed' | 'error' | 'cancelled' | 'cancelling';
  progress: number;
  current_frame: number;
  total_frames: number;
  fps: number;
  elapsed_time: number;
  eta: number;
  device: string;
  error_message: string | null;
  data_points_count: number;
  latest_data: TelemetryDataPoint[];
}
