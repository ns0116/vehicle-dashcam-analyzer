import os
import sys
import cv2
import json
import yt_dlp
import traceback
import pandas as pd
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS

# Add parent directory to path to import backend modules if needed
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from ocr_processor import TelemetryOCRProcessor, BackgroundVideoProcessor

app = Flask(__name__, static_folder='../frontend/dist', static_url_path='/')
CORS(app, origins=["http://localhost:5173", "http://localhost:5001", "http://127.0.0.1:5001", "http://127.0.0.1:5173"])

# Global state
ACTIVE_VIDEO_PATH = None
ACTIVE_PROCESSOR = None

# Video storage directory
VIDEO_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "videos")
os.makedirs(VIDEO_DIR, exist_ok=True)

ALLOWED_VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.flv', '.ts'}


def _validate_roi(roi) -> bool:
    if not roi or len(roi) != 4:
        return False
    try:
        x, y, w, h = [float(v) for v in roi]
        return x >= 0 and y >= 0 and w > 0 and h > 0
    except (TypeError, ValueError):
        return False


@app.route('/api/select-video', methods=['POST'])
def select_video():
    global ACTIVE_VIDEO_PATH
    data = request.json or {}
    
    path_or_url = data.get('path_or_url', '')
    if not path_or_url:
        return jsonify({"error": "No video path or URL provided"}), 400
        
    try:
        # Check if it's a YouTube URL or similar
        if path_or_url.startswith('http://') or path_or_url.startswith('https://'):
            # Check if ffmpeg is installed to determine if format merging is supported
            import shutil
            ffmpeg_installed = shutil.which("ffmpeg") is not None
            
            ydl_opts = {
                'outtmpl': os.path.join(VIDEO_DIR, '%(title)s.%(ext)s'),
            }
            if ffmpeg_installed:
                ydl_opts['format'] = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
                ydl_opts['merge_output_format'] = 'mp4'
            else:
                # Download pre-merged format directly (no ffmpeg merging required)
                ydl_opts['format'] = 'best[ext=mp4]/best'
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(path_or_url, download=True)
                filename = ydl.prepare_filename(info)
                # If extension changed (e.g. merging), find the merged file
                base, _ = os.path.splitext(filename)
                filename_mp4 = base + ".mp4"
                if os.path.exists(filename_mp4):
                    filename = filename_mp4
                
            ACTIVE_VIDEO_PATH = filename
            return jsonify({
                "message": "Video downloaded successfully",
                "path": ACTIVE_VIDEO_PATH,
                "filename": os.path.basename(ACTIVE_VIDEO_PATH)
            })
            
        else:
            # Local file path — validate extension before resolving
            _, ext = os.path.splitext(path_or_url)
            if ext.lower() not in ALLOWED_VIDEO_EXTENSIONS:
                allowed = ', '.join(sorted(ALLOWED_VIDEO_EXTENSIONS))
                return jsonify({"error": f"Unsupported file type '{ext}'. Allowed: {allowed}"}), 400

            resolved_path = os.path.abspath(path_or_url)
            if not os.path.exists(resolved_path):
                # Try finding in the videos directory
                alt_path = os.path.join(VIDEO_DIR, path_or_url)
                if os.path.exists(alt_path):
                    resolved_path = alt_path
                else:
                    return jsonify({"error": f"File not found: {path_or_url}"}), 404

            ACTIVE_VIDEO_PATH = resolved_path
            return jsonify({
                "message": "Video selected successfully",
                "path": ACTIVE_VIDEO_PATH,
                "filename": os.path.basename(ACTIVE_VIDEO_PATH)
            })
            
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/video-info', methods=['GET'])
def get_video_info():
    global ACTIVE_VIDEO_PATH
    if not ACTIVE_VIDEO_PATH or not os.path.exists(ACTIVE_VIDEO_PATH):
        return jsonify({"error": "No active video selected"}), 400
        
    try:
        cap = cv2.VideoCapture(ACTIVE_VIDEO_PATH)
        if not cap.isOpened():
            return jsonify({"error": "Could not open video file"}), 400

        try:
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            duration = total_frames / fps if fps > 0 else 0
        finally:
            cap.release()

        return jsonify({
            "filename": os.path.basename(ACTIVE_VIDEO_PATH),
            "width": width,
            "height": height,
            "total_frames": total_frames,
            "fps": round(fps, 2),
            "duration": round(duration, 2)
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/frame/<int:frame_index>', methods=['GET'])
def get_frame(frame_index):
    global ACTIVE_VIDEO_PATH
    if not ACTIVE_VIDEO_PATH or not os.path.exists(ACTIVE_VIDEO_PATH):
        return "No video selected", 400
        
    try:
        cap = cv2.VideoCapture(ACTIVE_VIDEO_PATH)
        if not cap.isOpened():
            return "Could not open video", 400

        try:
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if frame_index < 0 or frame_index >= total_frames:
                frame_index = total_frames // 2
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ret, frame = cap.read()
        finally:
            cap.release()

        if not ret:
            return "Could not read frame", 500

        _, buffer = cv2.imencode('.jpg', frame)
        return Response(buffer.tobytes(), mimetype='image/jpeg')

    except Exception as e:
        return str(e), 500


@app.route('/api/preview-ocr', methods=['POST'])
def preview_ocr():
    global ACTIVE_VIDEO_PATH
    if not ACTIVE_VIDEO_PATH or not os.path.exists(ACTIVE_VIDEO_PATH):
        return jsonify({"error": "No active video selected"}), 400
        
    data = request.json or {}
    frame_index = data.get('frame_index', 0)
    roi = data.get('roi')  # [x, y, w, h]
    threshold_value = data.get('threshold_value', 127)
    invert = data.get('invert', False)
    data_type = data.get('type', 'integer')

    if not _validate_roi(roi):
        return jsonify({"error": "Invalid ROI bounding box"}), 400

    try:
        cap = cv2.VideoCapture(ACTIVE_VIDEO_PATH)
        try:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ret, frame = cap.read()
        finally:
            cap.release()

        if not ret:
            return jsonify({"error": "Could not read frame"}), 500

        processor = TelemetryOCRProcessor()
        bin_base64, raw_text, parsed_val = processor.test_ocr_on_frame(
            frame, roi, threshold_value, invert, data_type
        )
        
        return jsonify({
            "binarized_image": bin_base64,
            "raw_text": raw_text,
            "parsed_value": parsed_val
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/process', methods=['POST'])
def start_processing():
    global ACTIVE_VIDEO_PATH, ACTIVE_PROCESSOR
    if not ACTIVE_VIDEO_PATH or not os.path.exists(ACTIVE_VIDEO_PATH):
        return jsonify({"error": "No active video selected"}), 400
        
    data = request.json or {}
    fields = data.get('fields', []) # list of field configs
    frame_skip = data.get('frame_skip', 2)
    num_threads = data.get('num_threads', 4)
    
    if not fields:
        return jsonify({"error": "No telemetry fields configured"}), 400
        
    try:
        # If there's a running process, stop it
        if ACTIVE_PROCESSOR and ACTIVE_PROCESSOR.get_status()['status'] == "running":
            ACTIVE_PROCESSOR.cancel()
            
        ACTIVE_PROCESSOR = BackgroundVideoProcessor(
            video_path=ACTIVE_VIDEO_PATH,
            fields=fields,
            frame_skip=frame_skip,
            num_threads=num_threads
        )
        ACTIVE_PROCESSOR.run()
        
        return jsonify({"message": "Processing started", "status": "running"})
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/status', methods=['GET'])
def get_processing_status():
    global ACTIVE_PROCESSOR
    if not ACTIVE_PROCESSOR:
        return jsonify({"status": "idle", "message": "No active process"})
        
    return jsonify(ACTIVE_PROCESSOR.get_status())


@app.route('/api/cancel', methods=['POST'])
def cancel_processing():
    global ACTIVE_PROCESSOR
    if not ACTIVE_PROCESSOR:
        return jsonify({"message": "No active process"}), 400
        
    ACTIVE_PROCESSOR.cancel()
    return jsonify({"message": "Cancellation requested"})


@app.route('/api/data', methods=['GET'])
def get_data():
    global ACTIVE_PROCESSOR
    if not ACTIVE_PROCESSOR:
        return jsonify({"data_points": []})
    with ACTIVE_PROCESSOR.lock:
        data = list(ACTIVE_PROCESSOR.data_points)
    return jsonify({"data_points": data})


@app.route('/api/export', methods=['GET'])
def export_csv():
    global ACTIVE_PROCESSOR, ACTIVE_VIDEO_PATH
    if not ACTIVE_VIDEO_PATH or not ACTIVE_PROCESSOR:
        return jsonify({"error": "No data available to export"}), 400

    with ACTIVE_PROCESSOR.lock:
        data_snapshot = list(ACTIVE_PROCESSOR.data_points)

    if not data_snapshot:
        return jsonify({"error": "No data available to export"}), 400

    try:
        # Create CSV text
        df = pd.DataFrame(data_snapshot)
        
        # Determine output filename based on video name
        video_name = os.path.basename(ACTIVE_VIDEO_PATH)
        base_name, _ = os.path.splitext(video_name)
        
        # Sanitize filename to ensure it is valid ASCII (HTTP headers cannot contain Unicode)
        import re
        safe_base_name = re.sub(r'[^\x00-\x7F]+', '_', base_name)  # replace non-ASCII characters
        safe_base_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', safe_base_name)  # replace spaces and special chars
        csv_name = f"{safe_base_name}_telemetry.csv"
        
        csv_data = df.to_csv(index=False)
        
        return Response(
            csv_data,
            mimetype="text/csv",
            headers={"Content-disposition": f"attachment; filename={csv_name}"}
        )
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# Check system details (like easyocr installed)
@app.route('/api/system-check', methods=['GET'])
def system_check():
    try:
        import torch
        import easyocr
        # Check if GPU (CUDA or Apple Silicon Metal) is available for acceleration
        cuda_available = torch.cuda.is_available()
        mps_available = hasattr(torch.backends, 'mps') and torch.backends.mps.is_available()
        gpu_active = cuda_available or mps_available
        gpu_type = "CUDA" if cuda_available else "Metal (Apple Silicon)" if mps_available else "None (CPU Mode)"
        
        return jsonify({
            "easyocr_detected": True,
            "gpu_active": gpu_active,
            "gpu_type": gpu_type,
            "platform": sys.platform,
            "python_version": sys.version
        })
    except Exception as e:
        return jsonify({
            "easyocr_detected": False,
            "gpu_active": False,
            "gpu_type": None,
            "platform": sys.platform,
            "python_version": sys.version,
            "error": str(e)
        })


# Static File Serving catch-all (for SPA)
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != "" and os.path.exists(app.static_folder + '/' + path):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')


if __name__ == '__main__':
    # Binds to localhost only by default. This tool grants network callers
    # arbitrary local file read (via /api/select-video) and Flask debug mode
    # exposes the Werkzeug interactive debugger (remote code execution risk),
    # so only opt into a non-loopback HOST on trusted networks.
    port = int(os.environ.get("PORT", 5001))
    host = os.environ.get("HOST", "127.0.0.1")
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host=host, port=port, debug=debug)
