import React, { useState } from 'react';
import type { FieldROI } from './ROISelector';
import { Plus, Trash2, Play, AlertCircle, Settings } from 'lucide-react';

interface FieldConfigProps {
  fields: FieldROI[];
  selectedFieldKey: string | null;
  onSelectField: (key: string | null) => void;
  onUpdateFields: (fields: FieldROI[]) => void;
  frameIndex: number;
}

const FIELD_COLORS = [
  '#00f0ff', // Cyan
  '#39ff14', // Neon Green
  '#ffbf00', // Amber
  '#e056fd', // Purple
  '#ff3131', // Neon Red
  '#ff9f43', // Orange
  '#0abde3'  // Sky Blue
];

export const FieldConfig: React.FC<FieldConfigProps> = ({
  fields,
  selectedFieldKey,
  onSelectField,
  onUpdateFields,
  frameIndex
}) => {
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldROI['type']>('integer');
  const [showAddCustom, setShowAddCustom] = useState(false);
  
  // OCR test state
  const [testingOcr, setTestingOcr] = useState(false);
  const [testResult, setTestResult] = useState<{
    binImage: string | null;
    rawText: string;
    parsedValue: number | string | null;
    error: string | null;
  } | null>(null);

  const selectedField = fields.find((f) => f.key === selectedFieldKey);

  const addPresetField = (preset: 'speed' | 'lap_time' | 'rpm' | 'gear') => {
    // Check if already exists
    if (fields.some((f) => f.key === preset)) {
      alert(`Field "${preset}" is already added.`);
      return;
    }

    let name = '';
    let type: FieldROI['type'] = 'integer';
    const threshold = 0;

    switch (preset) {
      case 'speed':
        name = 'Speed (km/h)';
        type = 'integer';
        break;
      case 'lap_time':
        name = 'Lap Time';
        type = 'time';
        break;
      case 'rpm':
        name = 'Engine RPM';
        type = 'integer';
        break;
      case 'gear':
        name = 'Gear';
        type = 'string';
        break;
    }

    const newField: FieldROI = {
      key: preset,
      name,
      type,
      roi: [50, 50, 100, 40],
      threshold,
      invert: false,
      color: FIELD_COLORS[fields.length % FIELD_COLORS.length],
      min_confidence: 0.3
    };

    onUpdateFields([...fields, newField]);
    onSelectField(newField.key);
    setTestResult(null);
  };

  const addCustomField = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldName.trim()) return;

    const key = newFieldName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (fields.some((f) => f.key === key)) {
      alert('A field with a similar name already exists.');
      return;
    }

    const newField: FieldROI = {
      key,
      name: newFieldName,
      type: newFieldType,
      roi: [50, 50, 100, 40],
      threshold: 127,
      invert: false,
      color: FIELD_COLORS[fields.length % FIELD_COLORS.length],
      min_confidence: 0.3
    };

    onUpdateFields([...fields, newField]);
    onSelectField(newField.key);
    setNewFieldName('');
    setShowAddCustom(false);
    setTestResult(null);
  };

  const removeField = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = fields.filter((f) => f.key !== key);
    onUpdateFields(updated);
    if (selectedFieldKey === key) {
      onSelectField(updated.length > 0 ? updated[0].key : null);
      setTestResult(null);
    }
  };

  const updateSelectedField = (changes: Partial<FieldROI>) => {
    if (!selectedFieldKey) return;
    const updated = fields.map((f) => {
      if (f.key === selectedFieldKey) {
        return { ...f, ...changes };
      }
      return f;
    });
    onUpdateFields(updated);
  };

  const testOcr = async () => {
    if (!selectedField) return;
    setTestingOcr(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/preview-ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frame_index: frameIndex,
          roi: selectedField.roi,
          threshold_value: selectedField.threshold,
          invert: selectedField.invert,
          type: selectedField.type,
          min_confidence: selectedField.min_confidence
        })
      });

      const data = await response.json();
      if (response.ok) {
        setTestResult({
          binImage: data.binarized_image,
          rawText: data.raw_text,
          parsedValue: data.parsed_value,
          error: null
        });
      } else {
        setTestResult({
          binImage: null,
          rawText: '',
          parsedValue: null,
          error: data.error || 'Failed to perform OCR.'
        });
      }
    } catch (err) {
      setTestResult({
        binImage: null,
        rawText: '',
        parsedValue: null,
        error: err instanceof Error ? err.message : 'Server connection error.'
      });
    } finally {
      setTestingOcr(false);
    }
  };

  return (
    <div className="glass-card" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Title */}
      <div>
        <h3 style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Settings size={18} style={{ color: 'var(--color-primary)' }} />
          <span>Telemetry Fields</span>
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Identify text regions to extract.
        </p>
      </div>

      {/* Preset Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="form-label">Add Standard Presets</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button 
            className="btn btn-secondary" 
            onClick={() => addPresetField('speed')}
            disabled={fields.some(f => f.key === 'speed')}
            style={{ padding: '6px 12px', fontSize: '0.75rem' }}
          >
            + Speed
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={() => addPresetField('lap_time')}
            disabled={fields.some(f => f.key === 'lap_time')}
            style={{ padding: '6px 12px', fontSize: '0.75rem' }}
          >
            + Lap Time
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={() => addPresetField('rpm')}
            disabled={fields.some(f => f.key === 'rpm')}
            style={{ padding: '6px 12px', fontSize: '0.75rem' }}
          >
            + RPM
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={() => addPresetField('gear')}
            disabled={fields.some(f => f.key === 'gear')}
            style={{ padding: '6px 12px', fontSize: '0.75rem' }}
          >
            + Gear
          </button>
        </div>
      </div>

      {/* Custom field expander */}
      <div>
        {!showAddCustom ? (
          <button 
            className="btn btn-secondary" 
            onClick={() => setShowAddCustom(true)}
            style={{ width: '100%', justifyContent: 'center', padding: '8px', fontSize: '0.8rem' }}
          >
            <Plus size={14} /> Add Custom Field
          </button>
        ) : (
          <form onSubmit={addCustomField} className="glass-card" style={{ background: 'rgba(0,0,0,0.2)', padding: 12 }}>
            <div className="form-group">
              <label className="form-label">Field Name</label>
              <input 
                type="text" 
                className="form-input" 
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                placeholder="e.g. Throttle, Temperature"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Data Type</label>
              <select 
                className="form-input"
                value={newFieldType}
                onChange={(e) => setNewFieldType(e.target.value as FieldROI['type'])}
              >
                <option value="integer">Integer (124)</option>
                <option value="float">Float (12.4)</option>
                <option value="time">Time (01:23.4)</option>
                <option value="string">Text / Code</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="submit" className="btn btn-primary" style={{ flex: 1, padding: 6, fontSize: '0.8rem' }}>
                Add
              </button>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => setShowAddCustom(false)}
                style={{ flex: 1, padding: 6, fontSize: '0.8rem' }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Fields List */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '200px' }}>
        <span className="form-label">Active Regions</span>
        {fields.length === 0 ? (
          <div style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No fields defined yet.
          </div>
        ) : (
          fields.map((field) => {
            const isSelected = field.key === selectedFieldKey;
            return (
              <div
                key={field.key}
                onClick={() => {
                  onSelectField(field.key);
                  setTestResult(null);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: isSelected ? 'rgba(0, 240, 255, 0.1)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${isSelected ? 'var(--color-primary)' : 'rgba(255,255,255,0.05)'}`,
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: field.color }} />
                  <span style={{ fontSize: '0.9rem', fontWeight: isSelected ? 600 : 400 }}>{field.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{field.type}</span>
                  <button 
                    onClick={(e) => removeField(field.key, e)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}
                    className="hover-danger"
                  >
                    <Trash2 size={14} className="hover-red" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Field calibration controls (only if field selected) */}
      {selectedField && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h4 style={{ fontSize: '0.9rem', color: selectedField.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Calibrate: {selectedField.name}
          </h4>

          {/* Type Selector */}
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label className="form-label">Data Format</label>
            <select
              className="form-input"
              value={selectedField.type}
              onChange={(e) => updateSelectedField({ type: e.target.value as FieldROI['type'] })}
              style={{ padding: '6px 10px', fontSize: '0.85rem' }}
            >
              <option value="integer">Integer</option>
              <option value="float">Float</option>
              <option value="time">Time (hh:mm:ss.t)</option>
              <option value="string">String / Text</option>
            </select>
          </div>

          {/* Threshold Slider */}
          <div className="form-group" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <label className="form-label">Binarize Threshold ({selectedField.threshold === 0 ? 'Disabled' : selectedField.threshold})</label>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>0 = Raw Color (Rec.)</span>
            </div>
            <input
              type="range"
              min="0"
              max="255"
              value={selectedField.threshold}
              onChange={(e) => updateSelectedField({ threshold: parseInt(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--color-primary)' }}
            />
          </div>

          {/* Invert Checkbox */}
          {selectedField.threshold > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input
                type="checkbox"
                id="invert-checkbox"
                checked={selectedField.invert}
                onChange={(e) => updateSelectedField({ invert: e.target.checked })}
                style={{ accentColor: 'var(--color-primary)' }}
              />
              <label htmlFor="invert-checkbox" className="form-label" style={{ marginBottom: 0, cursor: 'pointer' }}>
                Invert Colors (Dark Text on Light)
              </label>
            </div>
          )}

          {/* Confidence Threshold Slider */}
          <div className="form-group" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <label className="form-label">Min OCR Confidence ({Math.round(selectedField.min_confidence * 100)}%)</label>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>0 = Accept all</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(selectedField.min_confidence * 100)}
              onChange={(e) => updateSelectedField({ min_confidence: parseInt(e.target.value) / 100 })}
              style={{ width: '100%', accentColor: 'var(--color-primary)' }}
            />
          </div>

          {/* Test OCR trigger */}
          <button 
            className="btn btn-primary"
            onClick={testOcr}
            disabled={testingOcr}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            <Play size={14} /> {testingOcr ? 'Analyzing...' : 'Test OCR'}
          </button>

          {/* Test results display */}
          {testResult && (
            <div className="glass-card" style={{ background: 'rgba(0,0,0,0.4)', padding: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
              {testResult.error ? (
                <div style={{ color: 'var(--color-danger)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertCircle size={16} />
                  <span>{testResult.error}</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {testResult.binImage && (
                      <div style={{ border: '1px solid rgba(255,255,255,0.1)', padding: 2, background: '#000', borderRadius: 4 }}>
                        <img 
                          src={`data:image/jpeg;base64,${testResult.binImage}`} 
                          alt="Binarized crop" 
                          style={{ display: 'block', maxHeight: 40, maxWidth: 120, objectFit: 'contain' }}
                        />
                      </div>
                    )}
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Binarized Preview</span>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Raw Text:</div>
                    <div className="mono-val" style={{ fontSize: '1.1rem', color: '#fff', fontWeight: 600 }}>
                      {testResult.rawText || '"" (empty)'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Parsed Value:</div>
                    <div className="mono-val" style={{ fontSize: '1.2rem', color: 'var(--color-success)', fontWeight: 700 }}>
                      {testResult.parsedValue === null ? 'None' : String(testResult.parsedValue)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
