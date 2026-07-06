import { useState, useEffect, useMemo, useRef } from 'react';
import { ROISelector } from './components/ROISelector';
import type { FieldROI } from './components/ROISelector';
import { FieldConfig } from './components/FieldConfig';
import { TelemetryChart } from './components/TelemetryChart';
import type { PollingStatus, TelemetryDataPoint } from './types';
import {
  Play, 
  Video, 
  Download, 
  Settings, 
  AlertTriangle,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';

interface VideoInfo {
  filename: string;
  width: number;
  height: number;
  total_frames: number;
  fps: number;
  duration: number;
}

interface SystemStatus {
  easyocr_detected: boolean;
  gpu_active: boolean;
  gpu_type: string | null;
  platform: string;
  python_version: string;
}

export default function App() {
  // Video and System states
  const [videoPath, setVideoPath] = useState('');
  const [activeVideo, setActiveVideo] = useState<VideoInfo | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [frameIndex, setFrameIndex] = useState(0);
  // Bumped whenever a new video is loaded, to cache-bust the frame image even if frameIndex repeats
  const [frameNonce, setFrameNonce] = useState(0);

  // Debounced frame loading
  const [sliderVal, setSliderVal] = useState(0);

  // Field states
  const [fields, setFields] = useState<FieldROI[]>([
    {
      key: 'speed',
      name: 'Speed (km/h)',
      type: 'integer',
      roi: [50, 100, 120, 50],
      threshold: 0,
      invert: false,
      psm: 7,
      color: '#00f0ff'
    },
    {
      key: 'lap_time',
      name: 'Lap Time',
      type: 'time',
      roi: [50, 200, 180, 50],
      threshold: 0,
      invert: false,
      psm: 7,
      color: '#39ff14'
    }
  ]);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>('speed');

  // Process settings
  const [frameSkip, setFrameSkip] = useState(2);
  const [numThreads] = useState(4);
  const [pollingStatus, setPollingStatus] = useState<PollingStatus | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [allDataPoints, setAllDataPoints] = useState<TelemetryDataPoint[]>([]);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check system details on startup
  useEffect(() => {
    fetch('/api/system-check')
      .then(res => res.json())
      .then(data => setSystemStatus(data))
      .catch(err => console.error("System check failed", err));
  }, []);

  // Derive frame URL from frame index; nonce forces a refetch even if the same index repeats
  const frameUrl = useMemo(
    () => (activeVideo ? `/api/frame/${frameIndex}?t=${frameNonce}` : ''),
    [frameIndex, activeVideo, frameNonce]
  );

  // Debounced slider frame loading
  useEffect(() => {
    if (!activeVideo) return;
    const handler = setTimeout(() => {
      setFrameIndex(sliderVal);
    }, 150); // 150ms debounce
    return () => clearTimeout(handler);
  }, [sliderVal, activeVideo]);

  const selectVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoPath.trim()) return;

    setLoading(true);
    setLoadingMsg(videoPath.startsWith('http') ? 'Downloading YouTube video (this may take a minute)...' : 'Loading local video...');
    
    try {
      const response = await fetch('/api/select-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path_or_url: videoPath })
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Failed to select video');

      // Fetch video info
      const infoResponse = await fetch('/api/video-info');
      const infoData = await infoResponse.json();

      if (!infoResponse.ok) throw new Error(infoData.error || 'Failed to fetch video info');

      setActiveVideo(infoData);
      const midFrame = Math.floor(infoData.total_frames / 2);
      setFrameIndex(midFrame);
      setSliderVal(midFrame);
      setFrameNonce((n) => n + 1);
      setAllDataPoints([]);
      setPollingStatus(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  };

  const startProcessing = async () => {
    if (fields.length === 0) {
      alert('Please add at least one ROI field to extract.');
      return;
    }

    setLoading(true);
    setLoadingMsg('Initializing processing engine...');

    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: fields,
          frame_skip: frameSkip,
          num_threads: numThreads
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to start processing');

      setIsProcessing(true);
      // Start polling
      startPollingStatus();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const startPollingStatus = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    
    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch('/api/status');
        const data = await response.json();
        
        setPollingStatus(data);
        
        if (data.status === 'completed') {
          clearInterval(pollIntervalRef.current ?? undefined);
          setIsProcessing(false);
          fetchFullData();
        } else if (data.status === 'error' || data.status === 'cancelled') {
          clearInterval(pollIntervalRef.current ?? undefined);
          setIsProcessing(false);
        }
      } catch (err) {
        console.error("Error polling status", err);
      }
    }, 1000);
  };

  const cancelProcessing = async () => {
    try {
      await fetch('/api/cancel', { method: 'POST' });
    } catch (err) {
      console.error("Cancel failed", err);
    }
  };

  const fetchFullData = async () => {
    try {
      const res = await fetch('/api/data');
      const data = await res.json();
      setAllDataPoints(data.data_points || []);
    } catch (err) {
      console.error("Failed to load processed data", err);
    }
  };

  const downloadCsv = async () => {
    try {
      setLoading(true);
      setLoadingMsg('Generating CSV file...');
      const response = await fetch('/api/export');
      if (!response.ok) throw new Error('Failed to download CSV');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const contentDisposition = response.headers.get('content-disposition');
      let filename = 'telemetry.csv';
      if (contentDisposition) {
        const matches = /filename="?([^";]+)"?/i.exec(contentDisposition);
        if (matches && matches[1]) {
          filename = matches[1];
        }
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
  };

  const resetAll = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setActiveVideo(null);
    setVideoPath('');
    setPollingStatus(null);
    setAllDataPoints([]);
    setIsProcessing(false);
  };

  // Helper to format seconds to mm:ss
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs === Infinity) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo-container">
          <div style={{ backgroundColor: 'var(--color-primary)', width: 12, height: 24, transform: 'skewX(-15deg)' }} />
          <h1 className="logo-text">VEHICLE DASHCAM ANALYZER</h1>
          <span className="logo-sub">v2.0</span>
        </div>
        
        {/* System OCR Status */}
        {systemStatus && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {systemStatus.easyocr_detected ? (
              <span className="badge badge-green" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={12} /> EasyOCR Engine (Active)
              </span>
            ) : (
              <span className="badge badge-red" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <AlertTriangle size={12} /> EasyOCR Missing
              </span>
            )}
            {systemStatus.gpu_active && (
              <span className="badge badge-cyan" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                GPU Accelerated
              </span>
            )}
          </div>
        )}
      </header>

      {/* EasyOCR missing alert banner */}
      {systemStatus && !systemStatus.easyocr_detected && (
        <div className="glass-card" style={{ borderLeft: '4px solid var(--color-danger)', marginBottom: 20, padding: 15, background: 'rgba(255, 49, 49, 0.05)' }}>
          <h4 style={{ color: 'var(--color-danger)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} /> EasyOCR Dependencies Missing
          </h4>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-main)', lineHeight: 1.4 }}>
            We could not initialize the <code>easyocr</code> library. Please ensure that all dependencies are installed.
            Try running <code>pip install easyocr torch torchvision</code> manually in your environment.
          </p>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(9, 10, 15, 0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          zIndex: 9999, gap: 16
        }}>
          <RefreshCw className="spin" size={40} style={{ color: 'var(--color-primary)' }} />
          <h3 style={{ color: '#fff' }}>{loadingMsg}</h3>
        </div>
      )}

      {/* View 1: Select Video */}
      {!activeVideo && (
        <div style={{ maxWidth: 800, margin: '60px auto' }}>
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <h2 style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Video style={{ color: 'var(--color-primary)' }} />
                <span>Import Dashcam Video</span>
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Provide a local file path of your track day video, or enter a YouTube URL to automatically download it.
              </p>
            </div>

            <form onSubmit={selectVideo} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Video Source Path or URL</label>
                <input
                  type="text"
                  className="form-input"
                  value={videoPath}
                  onChange={(e) => setVideoPath(e.target.value)}
                  placeholder="e.g. input_video.mp4, /Users/path/video.mp4, or https://www.youtube.com/watch?v=..."
                  required
                  style={{ fontSize: '1rem', padding: 12 }}
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ justifyContent: 'center', padding: '12px' }}>
                <Video size={18} /> Load Video Source
              </button>
            </form>
          </div>
        </div>
      )}

      {/* View 2: Dashboard (when video is loaded) */}
      {activeVideo && (
        <div className="dashboard-grid">
          {/* Main Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Video metadata bar */}
            <div className="glass-card" style={{ padding: '12px 20px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Video size={16} style={{ color: 'var(--color-primary)' }} />
                <span style={{ fontWeight: 600 }}>{activeVideo.filename}</span>
              </div>
              <div style={{ display: 'flex', gap: 20, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                <span>Resolution: <strong style={{ color: '#fff' }}>{activeVideo.width}x{activeVideo.height}</strong></span>
                <span>FPS: <strong style={{ color: '#fff' }}>{activeVideo.fps}</strong></span>
                <span>Duration: <strong style={{ color: '#fff' }}>{formatTime(activeVideo.duration)}</strong> ({activeVideo.total_frames} frames)</span>
              </div>
              <button className="btn btn-secondary" onClick={resetAll} style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
                Load Another
              </button>
            </div>

            {/* Frame calibration & canvas selector */}
            {!isProcessing && allDataPoints.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <ROISelector
                  frameUrl={frameUrl}
                  fields={fields}
                  selectedFieldKey={selectedFieldKey}
                  onUpdateFields={setFields}
                  videoWidth={activeVideo.width}
                  videoHeight={activeVideo.height}
                />

                {/* Frame scrubbing timeline */}
                <div className="glass-card" style={{ padding: 15 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.85rem' }}>
                    <span className="form-label" style={{ marginBottom: 0 }}>Scrub Calibration Frame</span>
                    <span>Frame <strong className="mono-val" style={{ color: 'var(--color-primary)' }}>{sliderVal}</strong> of {activeVideo.total_frames - 1}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
                    <input
                      type="range"
                      min="0"
                      max={activeVideo.total_frames - 1}
                      value={sliderVal}
                      onChange={(e) => setSliderVal(parseInt(e.target.value))}
                      style={{ flex: 1, accentColor: 'var(--color-primary)' }}
                    />
                    <input 
                      type="number"
                      className="form-input mono-val"
                      min="0"
                      max={activeVideo.total_frames - 1}
                      value={sliderVal}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v >= 0 && v < activeVideo.total_frames) {
                          setSliderVal(v);
                        }
                      }}
                      style={{ width: 90, padding: '4px 8px', fontSize: '0.85rem', textAlign: 'center' }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Background processing panel */}
            {(isProcessing || (pollingStatus && pollingStatus.status !== 'idle')) && (
              <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <h3 style={{ marginBottom: 4 }}>OCR Telemetry Extraction Run</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Reading frames and parsing numbers using EasyOCR PyTorch engine.
                  </p>
                </div>

                {pollingStatus && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Status Badge */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Status:</span>
                        <span className={`badge ${
                          pollingStatus.status === 'running' ? 'badge-cyan' :
                          pollingStatus.status === 'completed' ? 'badge-green' :
                          'badge-red'
                        }`}>
                          {pollingStatus.status}
                        </span>
                      </div>
                      
                      {pollingStatus.status === 'running' && (
                        <button className="btn btn-danger" onClick={cancelProcessing} style={{ padding: '6px 12px', fontSize: '0.75rem' }}>
                          Cancel Run
                        </button>
                      )}
                    </div>

                    {/* Progress Bar */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                        <span>Progress</span>
                        <span className="mono-val">{pollingStatus.progress}%</span>
                      </div>
                      <div style={{ width: '100%', height: 10, background: 'rgba(255,255,255,0.05)', borderRadius: 5, overflow: 'hidden' }}>
                        <div 
                          style={{ 
                            width: `${pollingStatus.progress}%`, 
                            height: '100%', 
                            background: 'linear-gradient(90deg, var(--color-primary) 0%, var(--color-success) 100%)',
                            boxShadow: '0 0 10px var(--color-primary-glow)',
                            transition: 'width 0.4s ease'
                          }} 
                        />
                      </div>
                    </div>

                    {/* Stats details */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Frame</span>
                        <span className="mono-val" style={{ fontSize: '1rem', fontWeight: 600 }}>{pollingStatus.current_frame} / {pollingStatus.total_frames}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Speed</span>
                        <span className="mono-val" style={{ fontSize: '1rem', fontWeight: 600 }}>{pollingStatus.fps} FPS</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Elapsed</span>
                        <span className="mono-val" style={{ fontSize: '1rem', fontWeight: 600 }}>{pollingStatus.elapsed_time}s</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>ETA</span>
                        <span className="mono-val" style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-primary)' }}>{formatTime(pollingStatus.eta)}</span>
                      </div>
                    </div>

                    {/* Log table */}
                    {pollingStatus.latest_data && pollingStatus.latest_data.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span className="form-label">Real-time Telemetry Log</span>
                        <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6 }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                            <thead>
                              <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                <th style={{ padding: '6px 12px' }}>Timestamp</th>
                                <th style={{ padding: '6px 12px' }}>Frame</th>
                                {fields.map(f => (
                                  <th key={f.key} style={{ padding: '6px 12px' }}>{f.name}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {pollingStatus.latest_data.map((row: TelemetryDataPoint, idx: number) => (
                                <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                  <td className="mono-val" style={{ padding: '6px 12px', color: 'var(--text-muted)' }}>{row.timestamp}s</td>
                                  <td className="mono-val" style={{ padding: '6px 12px', color: 'var(--text-muted)' }}>{row.frame}</td>
                                  {fields.map(f => (
                                    <td key={f.key} className="mono-val" style={{ padding: '6px 12px', color: row[f.key] !== null ? '#fff' : 'var(--color-danger)' }}>
                                      {row[f.key] !== null ? String(row[f.key]) : 'ERR'}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Results graph & CSV downloader */}
            {allDataPoints.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Visualizer Chart */}
                <TelemetryChart fields={fields} dataPoints={allDataPoints} />

                {/* Exporter control */}
                <div className="glass-card" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 15 }}>
                  <div>
                    <h4 style={{ marginBottom: 4 }}>Extraction Complete</h4>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Successfully parsed <strong style={{ color: '#fff' }}>{allDataPoints.length}</strong> data points from the video.
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: 12 }}>
                    <button 
                      onClick={downloadCsv}
                      className="btn btn-success"
                    >
                      <Download size={16} /> Export Telemetry CSV
                    </button>
                    
                    <button 
                      className="btn btn-secondary"
                      onClick={() => {
                        setAllDataPoints([]);
                        setPollingStatus(null);
                        const midFrame = Math.floor(activeVideo.total_frames / 2);
                        setFrameIndex(midFrame);
                        setSliderVal(midFrame);
                      }}
                    >
                      Re-calibrate & Run Again
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar Panel (Calibration Config & Process settings) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Field calibration sidebar */}
            {!isProcessing && allDataPoints.length === 0 && (
              <FieldConfig
                fields={fields}
                selectedFieldKey={selectedFieldKey}
                onSelectField={setSelectedFieldKey}
                onUpdateFields={setFields}
                frameIndex={frameIndex}
              />
            )}

            {/* Run parameters panel */}
            {!isProcessing && allDataPoints.length === 0 && (
              <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Settings size={18} style={{ color: 'var(--color-primary)' }} />
                  <span>Run Settings</span>
                </h3>

                {/* Frame skip selector */}
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Frame Sub-sampling</span>
                    <span style={{ color: 'var(--color-primary)' }}>
                      {frameSkip === 0 ? 'Process every frame' : `Skip ${frameSkip} frames`}
                    </span>
                  </label>
                  <select
                    className="form-input"
                    value={frameSkip}
                    onChange={(e) => setFrameSkip(parseInt(e.target.value))}
                  >
                    <option value="0">Process every frame (100% data density)</option>
                    <option value="1">Process every 2nd frame (50% density)</option>
                    <option value="2">Process every 3rd frame (33% density)</option>
                    <option value="5">Process every 6th frame (17% density)</option>
                    <option value="9">Process every 10th frame (10% density)</option>
                    <option value="29">Process every 30th frame (low density)</option>
                  </select>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                    Higher sub-sampling increases extraction speed but reduces chart resolution.
                  </span>
                </div>

                {/* Hardware Device config */}
                <div className="form-group">
                  <label className="form-label">Hardware Device</label>
                  <div className="mono-val" style={{ 
                    fontSize: '0.9rem', 
                    color: systemStatus?.gpu_active ? 'var(--color-success)' : 'var(--color-warning)',
                    background: 'rgba(0,0,0,0.2)',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}>
                    <span style={{ 
                      width: 8, 
                      height: 8, 
                      borderRadius: '50%', 
                      backgroundColor: systemStatus?.gpu_active ? 'var(--color-success)' : 'var(--color-warning)',
                      display: 'inline-block'
                    }} />
                    {systemStatus?.gpu_active ? `GPU Active: ${systemStatus.gpu_type}` : 'CPU Mode (No GPU detected)'}
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6, display: 'block', lineHeight: 1.3 }}>
                    PyTorch automatically routes processing tasks to utilize your Mac\'s built-in GPU (Apple Silicon Metal) or multi-core CPU.
                  </span>
                </div>

                {/* Start button */}
                <button
                  className="btn btn-success"
                  onClick={startProcessing}
                  style={{ width: '100%', justifyContent: 'center', padding: 12, marginTop: 10 }}
                >
                  <Play size={16} /> Execute Telemetry Extraction
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
