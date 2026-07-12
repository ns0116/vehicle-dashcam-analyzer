import { useState, useCallback, useRef, useEffect } from 'react';

export interface VideoInfo {
  filename: string;
  width: number;
  height: number;
  total_frames: number;
  fps: number;
  duration: number;
}

interface UseVideoSelectorReturn {
  videoPath: string;
  setVideoPath: (path: string) => void;
  activeVideo: VideoInfo | null;
  sessionId: string | null;
  loading: boolean;
  loadingMsg: string;
  downloadProgress: number | null;
  selectVideo: (e: React.FormEvent) => Promise<void>;
  resetAll: () => void;
}

/**
 * Manages video selection, session creation, and background YouTube download.
 * @param onVideoLoaded  Optional callback invoked from inside the selectVideo event handler
 *                       after a video is successfully loaded. Safe to call setState from here.
 */
export function useVideoSelector(
  onVideoLoaded?: (video: VideoInfo) => void,
): UseVideoSelectorReturn {
  const [videoPath, setVideoPath] = useState('');
  const [activeVideo, setActiveVideo] = useState<VideoInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const abortRef = useRef(false);

  // Keep the callback ref up-to-date without triggering during render.
  const onVideoLoadedRef = useRef(onVideoLoaded);
  useEffect(() => {
    onVideoLoadedRef.current = onVideoLoaded;
  });

  const pollDownloadStatus = useCallback(
    (downloadId: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const poll = async () => {
          if (abortRef.current) { reject(new Error('aborted')); return; }
          try {
            const res = await fetch(`/api/download-status/${downloadId}`);
            const data = await res.json();
            if (data.status === 'downloading') {
              setDownloadProgress(data.progress);
              setLoadingMsg(`Downloading video… ${data.progress.toFixed(1)}%`);
              setTimeout(poll, 1000);
            } else if (data.status === 'completed') {
              setDownloadProgress(100);
              resolve();
            } else {
              reject(new Error(data.error || 'Download failed'));
            }
          } catch (err) {
            reject(err);
          }
        };
        poll();
      }),
    [],
  );

  const selectVideo = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!videoPath.trim()) return;

      abortRef.current = false;
      setLoading(true);
      setDownloadProgress(null);
      setLoadingMsg(videoPath.startsWith('http') ? 'Starting download…' : 'Loading video…');

      try {
        const res = await fetch('/api/select-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path_or_url: videoPath, session_id: sessionId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to select video');

        const sid: string = data.session_id;
        setSessionId(sid);

        if (data.type === 'download') {
          await pollDownloadStatus(data.download_id);
          if (abortRef.current) return;
          setLoadingMsg('Download complete. Loading video info…');
        }

        const infoRes = await fetch(`/api/video-info?session_id=${sid}`);
        const infoData = await infoRes.json();
        if (!infoRes.ok) throw new Error(infoData.error || 'Failed to fetch video info');

        // Update active video, then fire the callback (still inside event handler, so
        // any setState calls inside onVideoLoaded are safe — not inside an effect).
        setActiveVideo(infoData);
        onVideoLoadedRef.current?.(infoData);
      } catch (err) {
        if ((err as Error).message !== 'aborted') {
          alert(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setLoading(false);
        setLoadingMsg('');
        setDownloadProgress(null);
      }
    },
    [videoPath, sessionId, pollDownloadStatus],
  );

  const resetAll = useCallback(() => {
    abortRef.current = true;
    setActiveVideo(null);
    setVideoPath('');
    setSessionId(null);
    setDownloadProgress(null);
  }, []);

  return {
    videoPath, setVideoPath,
    activeVideo, sessionId,
    loading, loadingMsg, downloadProgress,
    selectVideo, resetAll,
  };
}
