import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ROISelector } from './components/ROISelector';
import type { FieldROI } from './components/ROISelector';
import { FieldConfig } from './components/FieldConfig';
import { TelemetryChart } from './components/TelemetryChart';
import { useVideoSelector } from './hooks/useVideoSelector';
import type { VideoInfo } from './hooks/useVideoSelector';
import { useProcessingStatus } from './hooks/useProcessingStatus';
import { useTelemetryData } from './hooks/useTelemetryData';
import {
  Play,
  Video,
  Download,
  Settings,
  AlertTriangle,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';

interface SystemStatus {
  easyocr_detected: boolean;
  gpu_active: boolean;
  gpu_type: string | null;
  platform: string;
  python_version: string;
}

const DEFAULT_FIELDS: FieldROI[] = [
  {
    key: 'speed', name: 'Speed (km/h)', type: 'integer',
    roi: [50, 100, 120, 50], threshold: 0, invert: false,
    color: '#00f0ff', min_confidence: 0.3,
  },
  {
    key: 'lap_time', name: 'Lap Time', type: 'time',
    roi: [50, 200, 180, 50], threshold: 0, invert: false,
    color: '#39ff14', min_confidence: 0.3,
  },
];

export default function App() {
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [fields, setFields] = useState<FieldROI[]>(DEFAULT_FIELDS);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>('speed');
  const [frameSkip, setFrameSkip] = useState(2);
  const [frameIndex, setFrameIndex] = useState(0);
  const [frameNonce, setFrameNonce] = useState(0);
  const [sliderVal, setSliderVal] = useState(0);

  // Refs used inside the onVideoLoaded callback so it can reference hooks
  // that are defined after useVideoSelector.
  const clearDataRef = useRef<() => void>(() => {});
  const resetStatusRef = useRef<() => void>(() => {});

  // Called from inside the selectVideo event handler — safe to call setState.
  const handleVideoLoaded = useCallback((video: VideoInfo) => {
    const saved = localStorage.getItem(`roi_config_${video.filename}`);
    if (saved) {
      try { setFields(JSON.parse(saved)); } catch { /* ignore corrupt data */ }
    }
    const mid = Math.floor(video.total_frames / 2);
    setFrameIndex(mid);
    setSliderVal(mid);
    setFrameNonce(n => n + 1);
    clearDataRef.current();
    resetStatusRef.current();
  }, []);

  const videoSelector = useVideoSelector(handleVideoLoaded);
  const telemetryData = useTelemetryData(videoSelector.sessionId);
  const processingStatus = useProcessingStatus(videoSelector.sessionId, telemetryData.fetchFullData);

  // Keep refs pointing to the latest stable callbacks.
  useEffect(() => {
    clearDataRef.current = telemetryData.clearData;
    resetStatusRef.current = processingStatus.resetStatus;
  });

  const loading = videoSelector.loading || processingStatus.loading || telemetryData.loading;
  const loadingMsg = videoSelector.loadingMsg || telemetryData.loadingMsg || 'Initializing processing engine…';

  // System check on startup
  useEffect(() => {
    fetch('/api/system-check')
      .then(res => res.json())
      .then(data => setSystemStatus(data))
      .catch(err => console.error('System check failed', err));
  }, []);

  // Auto-save field config to localStorage whenever fields change
  useEffect(() => {
    if (videoSelector.activeVideo) {
      localStorage.setItem(
        `roi_config_${videoSelector.activeVideo.filename}`,
        JSON.stringify(fields),
      );
    }
  }, [fields, videoSelector.activeVideo]);

  // Debounced frame loading (setState inside setTimeout — not flagged by rule)
  useEffect(() => {
    if (!videoSelector.activeVideo) return;
    const t = setTimeout(() => setFrameIndex(sliderVal), 150);
    return () => clearTimeout(t);
  }, [sliderVal, videoSelector.activeVideo]);

  const frameUrl = useMemo(
    () => (videoSelector.activeVideo && videoSelector.sessionId
      ? `/api/frame/${frameIndex}?session_id=${videoSelector.sessionId}&t=${frameNonce}`
      : ''),
    [frameIndex, videoSelector.activeVideo, frameNonce, videoSelector.sessionId],
  );

  const resetAll = () => {
    processingStatus.resetStatus();
    telemetryData.clearData();
    videoSelector.resetAll();
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs === Infinity) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const { activeVideo, sessionId } = videoSelector;

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo-container">
          <div style={{ backgroundColor: 'var(--color-primary)', width: 12, height: 24, transform: 'skewX(-15deg)' }} />
          <h1 className="logo-text">VEHICLE DASHCAM ANALYZER</h1>
          <span className="logo-sub">v2.0</span>
        </div>

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

      {/* EasyOCR missing alert */}
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
          zIndex: 9999, gap: 16,
        }}>
          <RefreshCw className="spin" size={40} style={{ color: 'var(--color-primary)' }} />
          <h3 style={{ color: '#fff' }}>{loadingMsg}</h3>
          {videoSelector.downloadProgress !== null && (
            <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ width: '100%', height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${videoSelector.downloadProgress}%`, height: '100%',
                  background: 'linear-gradient(90deg, var(--color-primary) 0%, var(--color-success) 100%)',
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                {videoSelector.downloadProgress.toFixed(1)}%
              </span>
            </div>
          )}
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

            <form onSubmit={videoSelector.selectVideo} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Video Source Path or URL</label>
                <input
                  type="text"
                  className="form-input"
                  value={videoSelector.videoPath}
                  onChange={(e) => videoSelector.setVideoPath(e.target.value)}
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

      {/* View 2: Dashboard */}
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

            {/* Frame calibration */}
            {!processingStatus.isProcessing && telemetryData.allDataPoints.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <ROISelector
                  frameUrl={frameUrl}
                  fields={fields}
                  selectedFieldKey={selectedFieldKey}
                  onUpdateFields={setFields}
                  videoWidth={activeVideo.width}
                  videoHeight={activeVideo.height}
                />

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
                        if (!isNaN(v) && v >= 0 && v < activeVideo.total_frames) setSliderVal(v);
                      }}
                      style={{ width: 90, padding: '4px 8px', fontSize: '0.85rem', textAlign: 'center' }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Processing panel */}
            {(processingStatus.isProcessing || (processingStatus.pollingStatus && processingStatus.pollingStatus.status !== 'idle')) && (
              <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <h3 style={{ marginBottom: 4 }}>OCR Telemetry Extraction Run</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Reading frames and parsing numbers using EasyOCR PyTorch engine.
                  </p>
                </div>

                {processingStatus.pollingStatus && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Status:</span>
                        <span className={`badge ${
                          processingStatus.pollingStatus.status === 'running' ? 'badge-cyan' :
                          processingStatus.pollingStatus.status === 'completed' ? 'badge-green' : 'badge-red'
                        }`}>
                          {processingStatus.pollingStatus.status}
                        </span>
                      </div>
                      {processingStatus.pollingStatus.status === 'running' && (
                        <button className="btn btn-danger" onClick={processingStatus.cancelProcessing} style={{ padding: '6px 12px', fontSize: '0.75rem' }}>
                          Cancel Run
                        </button>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                        <span>Progress</span>
                        <span className="mono-val">{processingStatus.pollingStatus.progress}%</span>
                      </div>
                      <div style={{ width: '100%', height: 10, background: 'rgba(255,255,255,0.05)', borderRadius: 5, overflow: 'hidden' }}>
                        <div style={{
                          width: `${processingStatus.pollingStatus.progress}%`,
                          height: '100%',
                          background: 'linear-gradient(90deg, var(--color-primary) 0%, var(--color-success) 100%)',
                          boxShadow: '0 0 10px var(--color-primary-glow)',
                          transition: 'width 0.4s ease',
                        }} />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                      {[
                        { label: 'Frame', value: `${processingStatus.pollingStatus.current_frame} / ${processingStatus.pollingStatus.total_frames}` },
                        { label: 'Speed', value: `${processingStatus.pollingStatus.fps} FPS` },
                        { label: 'Elapsed', value: `${processingStatus.pollingStatus.elapsed_time}s` },
                        { label: 'ETA', value: formatTime(processingStatus.pollingStatus.eta), highlight: true },
                      ].map(({ label, value, highlight }) => (
                        <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
                          <span className="mono-val" style={{ fontSize: '1rem', fontWeight: 600, color: highlight ? 'var(--color-primary)' : undefined }}>{value}</span>
                        </div>
                      ))}
                    </div>

                    {processingStatus.pollingStatus.latest_data && processingStatus.pollingStatus.latest_data.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span className="form-label">Real-time Telemetry Log</span>
                        <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6 }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                            <thead>
                              <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                <th style={{ padding: '6px 12px' }}>Timestamp</th>
                                <th style={{ padding: '6px 12px' }}>Frame</th>
                                {fields.map(f => <th key={f.key} style={{ padding: '6px 12px' }}>{f.name}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {processingStatus.pollingStatus.latest_data.map((row, idx) => (
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

            {/* Results */}
            {telemetryData.allDataPoints.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <TelemetryChart fields={fields} dataPoints={telemetryData.allDataPoints} />

                <div className="glass-card" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 15 }}>
                  <div>
                    <h4 style={{ marginBottom: 4 }}>Extraction Complete</h4>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Successfully parsed <strong style={{ color: '#fff' }}>{telemetryData.allDataPoints.length}</strong> data points from the video.
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: 12 }}>
                    <button onClick={telemetryData.downloadCsv} className="btn btn-success">
                      <Download size={16} /> Export Telemetry CSV
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        telemetryData.clearData();
                        processingStatus.resetStatus();
                        const mid = Math.floor(activeVideo.total_frames / 2);
                        setFrameIndex(mid);
                        setSliderVal(mid);
                      }}
                    >
                      Re-calibrate & Run Again
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {!processingStatus.isProcessing && telemetryData.allDataPoints.length === 0 && (
              <FieldConfig
                fields={fields}
                selectedFieldKey={selectedFieldKey}
                onSelectField={setSelectedFieldKey}
                onUpdateFields={setFields}
                frameIndex={frameIndex}
                sessionId={sessionId}
              />
            )}

            {!processingStatus.isProcessing && telemetryData.allDataPoints.length === 0 && (
              <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Settings size={18} style={{ color: 'var(--color-primary)' }} />
                  <span>Run Settings</span>
                </h3>

                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Frame Sub-sampling</span>
                    <span style={{ color: 'var(--color-primary)' }}>
                      {frameSkip === 0 ? 'Process every frame' : `Skip ${frameSkip} frames`}
                    </span>
                  </label>
                  <select className="form-input" value={frameSkip} onChange={(e) => setFrameSkip(parseInt(e.target.value))}>
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

                <div className="form-group">
                  <label className="form-label">Hardware Device</label>
                  <div className="mono-val" style={{
                    fontSize: '0.9rem',
                    color: systemStatus?.gpu_active ? 'var(--color-success)' : 'var(--color-warning)',
                    background: 'rgba(0,0,0,0.2)',
                    padding: '8px 12px', borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.05)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      backgroundColor: systemStatus?.gpu_active ? 'var(--color-success)' : 'var(--color-warning)',
                      display: 'inline-block',
                    }} />
                    {systemStatus?.gpu_active ? `GPU Active: ${systemStatus.gpu_type}` : 'CPU Mode (No GPU detected)'}
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6, display: 'block', lineHeight: 1.3 }}>
                    PyTorch automatically routes processing tasks to utilize your Mac\'s built-in GPU (Apple Silicon Metal) or multi-core CPU.
                  </span>
                </div>

                <button
                  className="btn btn-success"
                  onClick={() => processingStatus.startProcessing(fields, frameSkip)}
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
