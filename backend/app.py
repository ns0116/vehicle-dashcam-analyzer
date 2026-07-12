import os
import sys
import cv2
import re
import json
import uuid
import yt_dlp
import traceback
import threading
import pandas as pd
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from ocr_processor import TelemetryOCRProcessor, BackgroundVideoProcessor

app = Flask(__name__, static_folder='../frontend/dist', static_url_path='/')
CORS(app, origins=["http://localhost:5173", "http://localhost:5001", "http://127.0.0.1:5001", "http://127.0.0.1:5173"])

# Session state: session_id -> {video_path, processor}
# Each browser tab/client creates its own session, eliminating global state conflicts.
SESSIONS: dict = {}
SESSIONS_LOCK = threading.Lock()

# Download state: download_id -> {status, progress, error, filename, path, session_id}
DOWNLOADS: dict = {}
DOWNLOADS_LOCK = threading.Lock()

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


def _create_session(video_path=None) -> str:
    session_id = str(uuid.uuid4())
    with SESSIONS_LOCK:
        SESSIONS[session_id] = {'video_path': video_path, 'processor': None}
    return session_id


def _get_session(session_id: str) -> dict | None:
    with SESSIONS_LOCK:
        return SESSIONS.get(session_id)


def _background_download(download_id: str, url: str) -> None:
    """Downloads a video URL in a background thread, updating DOWNLOADS state."""
    import shutil

    try:
        ffmpeg_installed = shutil.which("ffmpeg") is not None

        ydl_opts: dict = {
            'outtmpl': os.path.join(VIDEO_DIR, '%(title)s.%(ext)s'),
        }
        if ffmpeg_installed:
            ydl_opts['format'] = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
            ydl_opts['merge_output_format'] = 'mp4'
        else:
            ydl_opts['format'] = 'best[ext=mp4]/best'

        def _progress_hook(d):
            if d['status'] == 'downloading':
                downloaded = d.get('downloaded_bytes', 0)
                total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
                percent = (downloaded / total * 100) if total > 0 else 0
                with DOWNLOADS_LOCK:
                    DOWNLOADS[download_id]['progress'] = round(percent, 1)

        ydl_opts['progress_hooks'] = [_progress_hook]

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)
            base, _ = os.path.splitext(filename)
            filename_mp4 = base + ".mp4"
            if os.path.exists(filename_mp4):
                filename = filename_mp4

        session_id = DOWNLOADS[download_id]['session_id']
        with SESSIONS_LOCK:
            if session_id in SESSIONS:
                SESSIONS[session_id]['video_path'] = filename
                SESSIONS[session_id]['processor'] = None

        with DOWNLOADS_LOCK:
            DOWNLOADS[download_id].update({
                'status': 'completed',
                'path': filename,
                'filename': os.path.basename(filename),
                'progress': 100.0,
            })

    except Exception as e:
        traceback.print_exc()
        with DOWNLOADS_LOCK:
            DOWNLOADS[download_id].update({'status': 'error', 'error': str(e)})


@app.route('/api/select-video', methods=['POST'])
def select_video():
    data = request.json or {}
    path_or_url = data.get('path_or_url', '')
    existing_session_id = data.get('session_id')

    if not path_or_url:
        return jsonify({"error": "No video path or URL provided"}), 400

    try:
        if path_or_url.startswith('http://') or path_or_url.startswith('https://'):
            # Create session up front; download runs in background.
            session_id = _create_session()
            download_id = str(uuid.uuid4())
            with DOWNLOADS_LOCK:
                DOWNLOADS[download_id] = {
                    'status': 'downloading',
                    'progress': 0.0,
                    'path': None,
                    'filename': None,
                    'error': None,
                    'session_id': session_id,
                }
            thread = threading.Thread(
                target=_background_download,
                args=(download_id, path_or_url),
                daemon=True,
            )
            thread.start()
            return jsonify({
                "type": "download",
                "download_id": download_id,
                "session_id": session_id,
                "message": "Download started in background",
            })

        else:
            _, ext = os.path.splitext(path_or_url)
            if ext.lower() not in ALLOWED_VIDEO_EXTENSIONS:
                allowed = ', '.join(sorted(ALLOWED_VIDEO_EXTENSIONS))
                return jsonify({"error": f"Unsupported file type '{ext}'. Allowed: {allowed}"}), 400

            resolved_path = os.path.abspath(path_or_url)
            if not os.path.exists(resolved_path):
                alt_path = os.path.join(VIDEO_DIR, path_or_url)
                if os.path.exists(alt_path):
                    resolved_path = alt_path
                else:
                    return jsonify({"error": f"File not found: {path_or_url}"}), 404

            # Reuse existing session if valid, otherwise create a fresh one.
            session = _get_session(existing_session_id) if existing_session_id else None
            if session is not None:
                session_id = existing_session_id
                with SESSIONS_LOCK:
                    SESSIONS[session_id]['video_path'] = resolved_path
                    SESSIONS[session_id]['processor'] = None
            else:
                session_id = _create_session(resolved_path)

            return jsonify({
                "type": "local",
                "session_id": session_id,
                "message": "Video selected successfully",
                "path": resolved_path,
                "filename": os.path.basename(resolved_path),
            })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/download-status/<download_id>', methods=['GET'])
def get_download_status(download_id):
    with DOWNLOADS_LOCK:
        dl = DOWNLOADS.get(download_id)

    if not dl:
        return jsonify({"error": "Download not found"}), 404

    return jsonify({
        "status": dl['status'],
        "progress": dl['progress'],
        "filename": dl['filename'],
        "error": dl['error'],
        "session_id": dl['session_id'],
    })


@app.route('/api/video-info', methods=['GET'])
def get_video_info():
    session_id = request.args.get('session_id')
    session = _get_session(session_id) if session_id else None
    video_path = session['video_path'] if session else None

    if not video_path or not os.path.exists(video_path):
        return jsonify({"error": "No active video selected"}), 400

    try:
        cap = cv2.VideoCapture(video_path)
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
            "filename": os.path.basename(video_path),
            "width": width,
            "height": height,
            "total_frames": total_frames,
            "fps": round(fps, 2),
            "duration": round(duration, 2),
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/frame/<int:frame_index>', methods=['GET'])
def get_frame(frame_index):
    session_id = request.args.get('session_id')
    session = _get_session(session_id) if session_id else None
    video_path = session['video_path'] if session else None

    if not video_path or not os.path.exists(video_path):
        return "No video selected", 400

    try:
        cap = cv2.VideoCapture(video_path)
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
    data = request.json or {}
    session_id = data.get('session_id')
    session = _get_session(session_id) if session_id else None
    video_path = session['video_path'] if session else None

    if not video_path or not os.path.exists(video_path):
        return jsonify({"error": "No active video selected"}), 400

    frame_index = data.get('frame_index', 0)
    roi = data.get('roi')
    threshold_value = data.get('threshold_value', 127)
    invert = data.get('invert', False)
    data_type = data.get('type', 'integer')
    min_confidence = float(data.get('min_confidence', 0.0))

    if not _validate_roi(roi):
        return jsonify({"error": "Invalid ROI bounding box"}), 400

    try:
        cap = cv2.VideoCapture(video_path)
        try:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ret, frame = cap.read()
        finally:
            cap.release()

        if not ret:
            return jsonify({"error": "Could not read frame"}), 500

        processor = TelemetryOCRProcessor()
        bin_base64, raw_text, parsed_val = processor.test_ocr_on_frame(
            frame, roi, threshold_value, invert, data_type, min_confidence
        )

        return jsonify({
            "binarized_image": bin_base64,
            "raw_text": raw_text,
            "parsed_value": parsed_val,
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/process', methods=['POST'])
def start_processing():
    data = request.json or {}
    session_id = data.get('session_id')
    session = _get_session(session_id) if session_id else None

    if not session:
        return jsonify({"error": "Invalid or missing session_id"}), 400

    video_path = session['video_path']
    if not video_path or not os.path.exists(video_path):
        return jsonify({"error": "No active video selected"}), 400

    fields = data.get('fields', [])
    frame_skip = data.get('frame_skip', 2)

    if not fields:
        return jsonify({"error": "No telemetry fields configured"}), 400

    try:
        if session['processor'] and session['processor'].get_status()['status'] == 'running':
            session['processor'].cancel()

        processor = BackgroundVideoProcessor(
            video_path=video_path,
            fields=fields,
            frame_skip=frame_skip,
        )
        with SESSIONS_LOCK:
            SESSIONS[session_id]['processor'] = processor
        processor.run()

        return jsonify({"message": "Processing started", "status": "running"})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/status', methods=['GET'])
def get_processing_status():
    session_id = request.args.get('session_id')
    session = _get_session(session_id) if session_id else None

    if not session or not session.get('processor'):
        return jsonify({"status": "idle", "message": "No active process"})

    return jsonify(session['processor'].get_status())


@app.route('/api/cancel', methods=['POST'])
def cancel_processing():
    data = request.json or {}
    session_id = data.get('session_id')
    session = _get_session(session_id) if session_id else None

    if not session or not session.get('processor'):
        return jsonify({"message": "No active process"}), 400

    session['processor'].cancel()
    return jsonify({"message": "Cancellation requested"})


@app.route('/api/data', methods=['GET'])
def get_data():
    session_id = request.args.get('session_id')
    session = _get_session(session_id) if session_id else None

    if not session or not session.get('processor'):
        return jsonify({"data_points": []})

    processor = session['processor']
    with processor.lock:
        data = list(processor.data_points)
    return jsonify({"data_points": data})


@app.route('/api/export', methods=['GET'])
def export_csv():
    session_id = request.args.get('session_id')
    session = _get_session(session_id) if session_id else None

    if not session or not session.get('video_path') or not session.get('processor'):
        return jsonify({"error": "No data available to export"}), 400

    video_path = session['video_path']
    processor = session['processor']

    with processor.lock:
        data_snapshot = list(processor.data_points)

    if not data_snapshot:
        return jsonify({"error": "No data available to export"}), 400

    try:
        df = pd.DataFrame(data_snapshot)
        video_name = os.path.basename(video_path)
        base_name, _ = os.path.splitext(video_name)

        safe_base_name = re.sub(r'[^\x00-\x7F]+', '_', base_name)
        safe_base_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', safe_base_name)
        csv_name = f"{safe_base_name}_telemetry.csv"

        csv_data = df.to_csv(index=False)

        return Response(
            csv_data,
            mimetype="text/csv",
            headers={"Content-disposition": f"attachment; filename={csv_name}"},
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/system-check', methods=['GET'])
def system_check():
    try:
        import torch
        import easyocr  # noqa: F401
        cuda_available = torch.cuda.is_available()
        mps_available = hasattr(torch.backends, 'mps') and torch.backends.mps.is_available()
        gpu_active = cuda_available or mps_available
        gpu_type = "CUDA" if cuda_available else "Metal (Apple Silicon)" if mps_available else "None (CPU Mode)"

        return jsonify({
            "easyocr_detected": True,
            "gpu_active": gpu_active,
            "gpu_type": gpu_type,
            "platform": sys.platform,
            "python_version": sys.version,
        })
    except Exception as e:
        return jsonify({
            "easyocr_detected": False,
            "gpu_active": False,
            "gpu_type": None,
            "platform": sys.platform,
            "python_version": sys.version,
            "error": str(e),
        })


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
