import { useState, useCallback } from 'react';
import type { TelemetryDataPoint } from '../types';

interface UseTelemetryDataReturn {
  allDataPoints: TelemetryDataPoint[];
  loading: boolean;
  loadingMsg: string;
  fetchFullData: () => Promise<void>;
  downloadCsv: () => Promise<void>;
  clearData: () => void;
}

export function useTelemetryData(sessionId: string | null): UseTelemetryDataReturn {
  const [allDataPoints, setAllDataPoints] = useState<TelemetryDataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');

  const fetchFullData = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/data?session_id=${sessionId}`);
      const data = await res.json();
      setAllDataPoints(data.data_points || []);
    } catch (err) {
      console.error('Failed to load processed data', err);
    }
  }, [sessionId]);

  const downloadCsv = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setLoadingMsg('Generating CSV file…');
    try {
      const res = await fetch(`/api/export?session_id=${sessionId}`);
      if (!res.ok) throw new Error('Failed to download CSV');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const cd = res.headers.get('content-disposition');
      let filename = 'telemetry.csv';
      if (cd) {
        const m = /filename="?([^";]+)"?/i.exec(cd);
        if (m?.[1]) filename = m[1];
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  }, [sessionId]);

  const clearData = useCallback(() => setAllDataPoints([]), []);

  return { allDataPoints, loading, loadingMsg, fetchFullData, downloadCsv, clearData };
}
