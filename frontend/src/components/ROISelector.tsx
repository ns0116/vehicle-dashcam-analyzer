import React, { useRef, useState, useEffect } from 'react';

export interface FieldROI {
  key: string;
  name: string;
  type: 'integer' | 'float' | 'time' | 'string';
  roi: [number, number, number, number]; // [x, y, w, h] in natural image coords
  threshold: number;
  invert: boolean;
  color: string;
}

interface ROISelectorProps {
  frameUrl: string;
  fields: FieldROI[];
  selectedFieldKey: string | null;
  onUpdateFields: (fields: FieldROI[]) => void;
  videoWidth: number;
  videoHeight: number;
}

export const ROISelector: React.FC<ROISelectorProps> = ({
  frameUrl,
  fields,
  selectedFieldKey,
  onUpdateFields,
  videoWidth,
  videoHeight
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null); // 'nw', 'ne', 'se', 'sw'
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [activeOffset, setActiveOffset] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [hoveredBox, setHoveredBox] = useState<string | null>(null);

  const scaleX = videoWidth > 0 ? displaySize.width / videoWidth : 1;
  const scaleY = videoHeight > 0 ? displaySize.height / videoHeight : 1;

  // Track size of image container for canvas matching
  const updateDisplaySize = () => {
    if (imageRef.current) {
      setDisplaySize({
        width: imageRef.current.clientWidth,
        height: imageRef.current.clientHeight
      });
    }
  };

  useEffect(() => {
    window.addEventListener('resize', updateDisplaySize);
    return () => window.removeEventListener('resize', updateDisplaySize);
  }, []);

  // Redraw canvas whenever fields, selection, sizes, or hovers change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || displaySize.width === 0) return;

    canvas.width = displaySize.width;
    canvas.height = displaySize.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all ROIs
    fields.forEach((field) => {
      const isSelected = field.key === selectedFieldKey;
      const isHovered = field.key === hoveredBox;
      const [x, y, w, h] = field.roi;

      // Scale to canvas coordinates
      const cx = x * scaleX;
      const cy = y * scaleY;
      const cw = w * scaleX;
      const ch = h * scaleY;

      // Box outline
      ctx.strokeStyle = field.color;
      ctx.lineWidth = isSelected ? 3 : isHovered ? 2 : 1.5;
      
      // Dashed lines for unselected
      if (!isSelected && !isHovered) {
        ctx.setLineDash([4, 4]);
      } else {
        ctx.setLineDash([]);
      }
      
      ctx.strokeRect(cx, cy, cw, ch);
      
      // Semi-transparent fill
      ctx.fillStyle = isSelected 
        ? `${field.color}20` 
        : isHovered 
          ? `${field.color}10` 
          : 'transparent';
      ctx.fillRect(cx, cy, cw, ch);

      // Label background
      ctx.fillStyle = field.color;
      ctx.font = 'bold 11px sans-serif';
      const labelText = field.name;
      const textWidth = ctx.measureText(labelText).width;
      
      // Handle label drawing position (try top, fallback inside)
      const labelY = cy - 5 > 0 ? cy - 5 : cy + 15;
      ctx.fillRect(cx, labelY - 11, textWidth + 10, 15);
      
      // Label text
      ctx.fillStyle = '#000000';
      ctx.fillText(labelText, cx + 5, labelY);

      // Draw resize handles for selected ROI
      if (isSelected) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = field.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        
        const hs = 6; // handle size
        const handles = [
          { x: cx, y: cy, cursor: 'nw' },
          { x: cx + cw, y: cy, cursor: 'ne' },
          { x: cx + cw, y: cy + ch, cursor: 'se' },
          { x: cx, y: cy + ch, cursor: 'sw' }
        ];

        handles.forEach((h) => {
          ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
          ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
        });
      }
    });
  }, [fields, selectedFieldKey, displaySize, scaleX, scaleY, hoveredBox]);

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const getHandleAtPos = (cx: number, cy: number, rx: number, ry: number, rw: number, rh: number) => {
    const hs = 8; // click sensitivity
    if (Math.abs(cx - rx) < hs && Math.abs(cy - ry) < hs) return 'nw';
    if (Math.abs(cx - (rx + rw)) < hs && Math.abs(cy - ry) < hs) return 'ne';
    if (Math.abs(cx - (rx + rw)) < hs && Math.abs(cy - (ry + rh)) < hs) return 'se';
    if (Math.abs(cx - rx) < hs && Math.abs(cy - (ry + rh)) < hs) return 'sw';
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedFieldKey) return;
    const { x: cx, y: cy } = getCanvasCoords(e);
    
    // Find selected field
    const selectedField = fields.find((f) => f.key === selectedFieldKey);
    if (!selectedField) return;

    const [rx, ry, rw, rh] = selectedField.roi;
    const rcx = rx * scaleX;
    const rcy = ry * scaleY;
    const rcw = rw * scaleX;
    const rch = rh * scaleY;

    // 1. Check if clicking on resize handles
    const handle = getHandleAtPos(cx, cy, rcx, rcy, rcw, rch);
    if (handle) {
      setIsResizing(handle);
      setDragStart({ x: cx, y: cy });
      setActiveOffset({ x: rcx, y: rcy, w: rcw, h: rch });
      return;
    }

    // 2. Check if clicking inside the selected box (for dragging)
    if (cx >= rcx && cx <= rcx + rcw && cy >= rcy && cy <= rcy + rch) {
      setIsDragging(true);
      setDragStart({ x: cx, y: cy });
      setActiveOffset({ x: rcx, y: rcy, w: rcw, h: rch });
      return;
    }

    // 3. Otherwise, initiate new box drawing
    setIsDrawing(true);
    setDragStart({ x: cx, y: cy });
    
    // Create or reset ROI
    const updated = fields.map((f) => {
      if (f.key === selectedFieldKey) {
        return {
          ...f,
          roi: [
            Math.round(cx / scaleX),
            Math.round(cy / scaleY),
            0,
            0
          ] as [number, number, number, number]
        };
      }
      return f;
    });
    onUpdateFields(updated);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x: cx, y: cy } = getCanvasCoords(e);

    // Hover state detection
    if (!isDrawing && !isDragging && !isResizing) {
      let foundHover: string | null = null;
      // Loop backwards to check top-most boxes first
      for (let i = fields.length - 1; i >= 0; i--) {
        const f = fields[i];
        const [rx, ry, rw, rh] = f.roi;
        const rcx = rx * scaleX;
        const rcy = ry * scaleY;
        const rcw = rw * scaleX;
        const rch = rh * scaleY;

        if (cx >= rcx && cx <= rcx + rcw && cy >= rcy && cy <= rcy + rch) {
          foundHover = f.key;
          break;
        }
      }
      setHoveredBox(foundHover);
    }

    if (!selectedFieldKey) return;

    const selectedField = fields.find((f) => f.key === selectedFieldKey);
    if (!selectedField) return;

    // Drawing new box
    if (isDrawing) {
      const dx = cx - dragStart.x;
      const dy = cy - dragStart.y;

      const x = Math.min(dragStart.x, cx);
      const y = Math.min(dragStart.y, cy);
      const w = Math.abs(dx);
      const h = Math.abs(dy);

      const updated = fields.map((f) => {
        if (f.key === selectedFieldKey) {
          return {
            ...f,
            roi: [
              Math.round(x / scaleX),
              Math.round(y / scaleY),
              Math.round(w / scaleX),
              Math.round(h / scaleY)
            ] as [number, number, number, number]
          };
        }
        return f;
      });
      onUpdateFields(updated);
    }

    // Dragging existing box
    else if (isDragging) {
      const dx = cx - dragStart.x;
      const dy = cy - dragStart.y;

      // Limit moving inside frame boundaries
      let newCx = activeOffset.x + dx;
      let newCy = activeOffset.y + dy;

      newCx = Math.max(0, Math.min(newCx, displaySize.width - activeOffset.w));
      newCy = Math.max(0, Math.min(newCy, displaySize.height - activeOffset.h));

      const updated = fields.map((f) => {
        if (f.key === selectedFieldKey) {
          return {
            ...f,
            roi: [
              Math.round(newCx / scaleX),
              Math.round(newCy / scaleY),
              Math.round(activeOffset.w / scaleX),
              Math.round(activeOffset.h / scaleY)
            ] as [number, number, number, number]
          };
        }
        return f;
      });
      onUpdateFields(updated);
    }

    // Resizing
    else if (isResizing) {
      const dx = cx - dragStart.x;
      const dy = cy - dragStart.y;

      let newX = activeOffset.x;
      let newY = activeOffset.y;
      let newW = activeOffset.w;
      let newH = activeOffset.h;

      if (isResizing === 'nw') {
        newX = Math.max(0, Math.min(activeOffset.x + dx, activeOffset.x + activeOffset.w - 5));
        newW = activeOffset.w - (newX - activeOffset.x);
        newY = Math.max(0, Math.min(activeOffset.y + dy, activeOffset.y + activeOffset.h - 5));
        newH = activeOffset.h - (newY - activeOffset.y);
      } else if (isResizing === 'ne') {
        newW = Math.max(5, Math.min(activeOffset.w + dx, displaySize.width - activeOffset.x));
        newY = Math.max(0, Math.min(activeOffset.y + dy, activeOffset.y + activeOffset.h - 5));
        newH = activeOffset.h - (newY - activeOffset.y);
      } else if (isResizing === 'se') {
        newW = Math.max(5, Math.min(activeOffset.w + dx, displaySize.width - activeOffset.x));
        newH = Math.max(5, Math.min(activeOffset.h + dy, displaySize.height - activeOffset.y));
      } else if (isResizing === 'sw') {
        newX = Math.max(0, Math.min(activeOffset.x + dx, activeOffset.x + activeOffset.w - 5));
        newW = activeOffset.w - (newX - activeOffset.x);
        newH = Math.max(5, Math.min(activeOffset.h + dy, displaySize.height - activeOffset.y));
      }

      const updated = fields.map((f) => {
        if (f.key === selectedFieldKey) {
          return {
            ...f,
            roi: [
              Math.round(newX / scaleX),
              Math.round(newY / scaleY),
              Math.round(newW / scaleX),
              Math.round(newH / scaleY)
            ] as [number, number, number, number]
          };
        }
        return f;
      });
      onUpdateFields(updated);
    }
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    setIsDragging(false);
    setIsResizing(null);
  };

  // Determine mouse cursor style based on mouse position
  const getCursorStyle = () => {
    if (isDrawing) return 'crosshair';
    if (isDragging) return 'move';
    if (isResizing) return `${isResizing}-resize`;

    if (!selectedFieldKey) return 'default';
    const selectedField = fields.find((f) => f.key === selectedFieldKey);
    if (!selectedField) return 'default';

    // Check if mouse is hovering over handle or inside box (requires active canvas tracking, simplified here)
    return 'default';
  };

  return (
    <div className="glass-card" style={{ padding: 15 }}>
      <h3 style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Video Feed Calibration</span>
        {selectedFieldKey && (
          <span style={{ fontSize: '0.8rem', color: '#00f0ff' }}>
            Drawing mode: {fields.find(f => f.key === selectedFieldKey)?.name}
          </span>
        )}
      </h3>
      
      <div 
        ref={containerRef} 
        style={{ 
          width: '100%', 
          overflow: 'hidden',
          borderRadius: 8,
          background: '#000',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '10px 0',
          position: 'relative'
        }}
      >
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <img
            ref={imageRef}
            src={frameUrl}
            alt="Video calibration frame"
            onLoad={updateDisplaySize}
            style={{ 
              maxWidth: '100%', 
              maxHeight: '75vh',
              display: 'block',
              userSelect: 'none'
            }}
          />
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              cursor: getCursorStyle(),
              pointerEvents: selectedFieldKey ? 'auto' : 'none' // Disable clicks if no field selected
            }}
          />
        </div>
        
        {!selectedFieldKey && fields.length > 0 && (
          <div 
            style={{
              position: 'absolute',
              background: 'rgba(0,0,0,0.7)',
              color: '#fff',
              padding: '10px 16px',
              borderRadius: 6,
              fontSize: '0.9rem',
              pointerEvents: 'none',
              border: '1px solid rgba(255,255,255,0.1)'
            }}
          >
            Select a field on the right panel to draw/adjust its bounding box.
          </div>
        )}
      </div>
      
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        <span>Video Resolution: {videoWidth} x {videoHeight}</span>
        <span>Canvas Resolution: {displaySize.width} x {displaySize.height}</span>
      </div>
    </div>
  );
};
