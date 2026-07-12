import { useState, useRef, useCallback, useEffect } from 'react';
import type { PollingStatus } from '../types';
import type { FieldROI } from '../components/ROISelector';

interface UseProcessingStatusReturn {
  pollingStatus: PollingStatus | null;
  isProcessing: boolean;
  loading: boolean;
  startProcessing: (fields: FieldROI[], frameSkip: number) => Promise<void>;
  cancelProcessing: () => Promise<void>;
  resetStatus: () => void;
}

export function useProcessingStatus(
  sessionId: string | null,
  onComplete: () => void,
): UseProcessingStatusReturn {
  const [pollingStatus, setPollingStatus] = useState<PollingStatus | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loading, setLoading] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef(onComplete);
  // Keep ref current without assigning during render (react-hooks/refs).
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollIntervalRef.current = setInterval(async () => {
      if (!sessionId) return;
      try {
        const res = await fetch(`/api/status?session_id=${sessionId}`);
        const data = await res.json();
        setPollingStatus(data);

        if (data.status === 'completed') {
          stopPolling();
          setIsProcessing(false);
          onCompleteRef.current();
        } else if (data.status === 'error' || data.status === 'cancelled') {
          stopPolling();
          setIsProcessing(false);
        }
      } catch (err) {
        console.error('Error polling status', err);
      }
    }, 1000);
  }, [sessionId, stopPolling]);

  const startProcessing = useCallback(
    async (fields: FieldROI[], frameSkip: number) => {
      if (!sessionId) return;
      if (fields.length === 0) {
        alert('Please add at least one ROI field to extract.');
        return;
      }

      setLoading(true);
      try {
        const res = await fetch('/api/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, fields, frame_skip: frameSkip }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to start processing');

        setIsProcessing(true);
        startPolling();
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [sessionId, startPolling],
  );

  const cancelProcessing = useCallback(async () => {
    if (!sessionId) return;
    try {
      await fetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
    } catch (err) {
      console.error('Cancel failed', err);
    }
  }, [sessionId]);

  const resetStatus = useCallback(() => {
    stopPolling();
    setPollingStatus(null);
    setIsProcessing(false);
  }, [stopPolling]);

  return { pollingStatus, isProcessing, loading, startProcessing, cancelProcessing, resetStatus };
}
