# Shim to fix Python 3.13 macOS pyenv compilation issue without _lzma module.
# Only stubs the module when _lzma is genuinely absent; avoids clobbering any
# legitimate lzma usage by downstream libraries (e.g. PyTorch model loading).
import sys
try:
    import _lzma  # noqa: F401 — just confirming it is available
except ImportError:
    import types
    _mock_lzma = types.ModuleType("lzma")
    _mock_lzma.LZMAError = Exception  # type: ignore[attr-defined]
    _mock_lzma.open = lambda *args, **kwargs: None  # type: ignore[attr-defined]
    _mock_lzma.LZMACompressor = object  # type: ignore[attr-defined]
    _mock_lzma.LZMADecompressor = object  # type: ignore[attr-defined]
    if "lzma" not in sys.modules:
        sys.modules["lzma"] = _mock_lzma
    if "_lzma" not in sys.modules:
        sys.modules["_lzma"] = _mock_lzma

import cv2
import easyocr
import re
import time
import os
import base64
import threading
import pandas as pd

class TelemetryOCRProcessor:
    def __init__(self):
        self.reader = easyocr.Reader(['en'], gpu=True)

    def preprocess_image(self, crop, threshold_value=None, invert=False):
        """
        Preprocesses a cropped image for EasyOCR.
        If threshold_value is provided (> 0), it performs grayscale conversion, 
        binarization (thresholding), and optional inversion.
        Otherwise, it returns the raw crop converted to RGB (EasyOCR standard).
        """
        if threshold_value is not None and threshold_value > 0:
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            thresh_type = cv2.THRESH_BINARY_INV if invert else cv2.THRESH_BINARY
            _, binary = cv2.threshold(gray, threshold_value, 255, thresh_type)
            # Convert single channel back to RGB for EasyOCR
            return cv2.cvtColor(binary, cv2.COLOR_GRAY2RGB)
        else:
            # EasyOCR handles raw RGB images best
            return cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)

    def run_ocr(self, img_rgb, data_type, min_confidence=0.0):
        """
        Runs EasyOCR on preprocessed RGB image.
        """
        try:
            # readtext returns list of [ [bbox], text, confidence ]
            results = self.reader.readtext(img_rgb)
            if results:
                texts = [res[1] for res in results if res[2] >= min_confidence]
                return " ".join(texts).strip()
            return ""
        except Exception as e:
            print(f"EasyOCR Error: {e}")
            return ""

    def parse_value(self, text, data_type):
        """
        Parses OCR text into the requested data type using regex.
        """
        if not text:
            return None
            
        # Clean up text (often EasyOCR might pick up spaces or minor typos)
        text = text.strip()
            
        if data_type == 'integer':
            # Extract digits and optional negative sign
            match = re.search(r'(-?\d+)', text)
            return int(match.group(1)) if match else None
            
        elif data_type == 'float':
            # Replace comma with dot
            cleaned = text.replace(',', '.')
            match = re.search(r'(-?\d+\.\d+|-?\d+)', cleaned)
            return float(match.group(1)) if match else None
            
        elif data_type == 'time':
            cleaned = text.replace(',', '.')
            # Match hh:mm:ss.ms
            match = re.search(r'(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})\.(\d+)', cleaned)
            if match:
                h, m, s, ms = match.groups()
                h_val = int(h) if h else 0
                return h_val * 3600 + int(m) * 60 + int(s) + float(f"0.{ms}")
            # Match mm:ss.ms
            match = re.search(r'(\d{1,2}):(\d{1,2})\.(\d+)', cleaned)
            if match:
                m, s, ms = match.groups()
                return int(m) * 60 + int(s) + float(f"0.{ms}")
            # Match ss.ms
            match = re.search(r'(\d{1,2})\.(\d+)', cleaned)
            if match:
                s, ms = match.groups()
                return int(s) + float(f"0.{ms}")
            return None
            
        else: # string
            return text

    def test_ocr_on_frame(self, frame, roi, threshold_value, invert, data_type, min_confidence=0.0):
        """
        Extracts OCR data for a single ROI in a single frame.
        Returns:
            - binarized_img_base64: Base64-encoded JPEG image of the preview crop
            - raw_text: Raw OCR string
            - parsed_value: Parsed value
        """
        x, y, w, h = roi
        h_img, w_img = frame.shape[:2]

        # Boundaries check
        x1 = max(0, min(x, w_img - 1))
        y1 = max(0, min(y, h_img - 1))
        x2 = max(0, min(x + w, w_img))
        y2 = max(0, min(y + h, h_img))

        if x2 <= x1 or y2 <= y1:
            raise ValueError(f"Invalid ROI bounding box coordinates: {roi}")

        crop = frame[y1:y2, x1:x2]

        # Determine whether to use binarization
        use_binarization = (threshold_value > 0)

        if use_binarization:
            processed = self.preprocess_image(crop, threshold_value, invert)
            # Display binarized image
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            thresh_type = cv2.THRESH_BINARY_INV if invert else cv2.THRESH_BINARY
            _, display_img = cv2.threshold(gray, threshold_value, 255, thresh_type)
        else:
            processed = self.preprocess_image(crop, None, False)
            # Display raw color crop
            display_img = crop

        # Run OCR
        raw_text = self.run_ocr(processed, data_type, min_confidence)
        parsed_val = self.parse_value(raw_text, data_type)
        
        # Convert display image to base64 jpeg
        _, buffer = cv2.imencode('.jpg', display_img)
        img_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return img_base64, raw_text, parsed_val


class BackgroundVideoProcessor:
    def __init__(self, video_path, fields, frame_skip=2):
        self.video_path = video_path
        self.fields = fields # list of dicts: {key, name, roi: [x,y,w,h], type, threshold, invert}
        self.frame_skip = frame_skip
        
        # We reuse the same processor initialized in background run thread.
        # Setting Reader inside the background thread to prevent CUDA/MPS thread locks.
        self.processor = None
        
        # State variables
        self.lock = threading.Lock()
        self.status = "idle" # idle, running, completed, error, cancelled
        self.progress = 0.0 # 0 to 100
        self.current_frame = 0
        self.total_frames = 0
        self.elapsed_time = 0.0
        self.eta = 0.0
        self.fps = 0.0
        self.error_message = ""
        self.data_points = []
        self.cancel_requested = False

    def get_status(self):
        with self.lock:
            # Check if processor has initialized and we can query device
            device_type = "GPU"
            if self.processor and hasattr(self.processor.reader, 'device'):
                device_type = "GPU" if "cpu" not in str(self.processor.reader.device) else "CPU"
                
            return {
                "status": self.status,
                "progress": self.progress,
                "current_frame": self.current_frame,
                "total_frames": self.total_frames,
                "elapsed_time": self.elapsed_time,
                "fps": self.fps,
                "eta": self.eta,
                "device": device_type,
                "error_message": self.error_message,
                "data_points_count": len(self.data_points),
                # Send the latest 10 data points for UI log
                "latest_data": self.data_points[-10:] if self.data_points else []
            }

    def cancel(self):
        with self.lock:
            if self.status == "running":
                self.cancel_requested = True
                self.status = "cancelling"

    def run(self):
        thread = threading.Thread(target=self._process_video)
        thread.daemon = True
        thread.start()

    def _process_video(self):
        with self.lock:
            self.status = "running"
            self.progress = 0.0
            self.current_frame = 0
            self.data_points = []
            self.cancel_requested = False

        start_time = time.time()

        try:
            # Lazy initialize EasyOCR engine within this background thread
            self.processor = TelemetryOCRProcessor()

            cap = cv2.VideoCapture(self.video_path)
            if not cap.isOpened():
                raise ValueError(f"Could not open video file: {self.video_path}")

            try:
                total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                video_fps = cap.get(cv2.CAP_PROP_FPS)

                if total_frames <= 0 or video_fps <= 0:
                    raise ValueError("Could not retrieve video metadata.")

                with self.lock:
                    self.total_frames = total_frames

                results = []
                processed_count = 0
                frame_idx = 0

                # Process frames as they are read — no pre-loading into RAM
                while True:
                    ret, frame = cap.read()
                    if not ret:
                        break

                    frame_idx += 1

                    with self.lock:
                        if self.cancel_requested:
                            self.status = "cancelled"
                            return

                    if frame_idx % (self.frame_skip + 1) != 0:
                        continue

                    timestamp_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
                    timestamp_sec = timestamp_ms / 1000.0

                    row = {
                        'timestamp': round(timestamp_sec, 3),
                        'frame': frame_idx
                    }

                    for f in self.fields:
                        f_key = f['key']
                        roi = f['roi']
                        threshold = f.get('threshold', 0)
                        invert = f.get('invert', False)
                        data_type = f.get('type', 'integer')
                        min_confidence = f.get('min_confidence', 0.0)

                        try:
                            x, y, w, h = roi
                            h_img, w_img = frame.shape[:2]
                            x1 = max(0, min(x, w_img - 1))
                            y1 = max(0, min(y, h_img - 1))
                            x2 = max(0, min(x + w, w_img))
                            y2 = max(0, min(y + h, h_img))

                            if x2 > x1 and y2 > y1:
                                crop = frame[y1:y2, x1:x2]
                                processed = self.processor.preprocess_image(crop, threshold, invert)
                                raw_text = self.processor.run_ocr(processed, data_type, min_confidence)
                                parsed_val = self.processor.parse_value(raw_text, data_type)
                                row[f_key] = parsed_val
                            else:
                                row[f_key] = None
                        except Exception:
                            row[f_key] = None

                    results.append(row)
                    processed_count += 1

                    elapsed = time.time() - start_time
                    fps_calc = processed_count / elapsed if elapsed > 0 else 0
                    remaining_tasks = (total_frames - frame_idx) // (self.frame_skip + 1)
                    eta_calc = remaining_tasks / fps_calc if fps_calc > 0 else 0

                    with self.lock:
                        self.current_frame = frame_idx
                        self.progress = round((frame_idx / total_frames) * 100, 1)
                        self.elapsed_time = round(elapsed, 1)
                        self.fps = round(fps_calc, 1)
                        self.eta = round(eta_calc, 1)
                        self.data_points = results[:]
            finally:
                cap.release()

            if processed_count == 0:
                raise ValueError("No frames to process with the current frame skip value.")

            with self.lock:
                self.status = "completed"
                self.progress = 100.0

        except Exception as e:
            import traceback
            traceback.print_exc()
            with self.lock:
                self.status = "error"
                self.error_message = str(e)
