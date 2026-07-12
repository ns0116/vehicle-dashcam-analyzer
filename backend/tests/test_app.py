"""
Flask endpoint tests using the built-in test client.
Heavy deps (easyocr, cv2 VideoCapture, yt-dlp) are mocked where needed.
"""
import sys
import os
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import app as flask_app  # noqa: E402


@pytest.fixture()
def client():
    flask_app.app.config["TESTING"] = True
    # Reset session/download state between tests
    flask_app.SESSIONS.clear()
    flask_app.DOWNLOADS.clear()
    with flask_app.app.test_client() as c:
        yield c


@pytest.fixture()
def session_id(client):
    """Creates a session with a fake video path."""
    return flask_app._create_session("/fake/video.mp4")


# ---------------------------------------------------------------------------
# /api/system-check
# ---------------------------------------------------------------------------

class TestSystemCheck:
    def test_returns_json(self, client):
        with patch.dict(sys.modules, {"torch": MagicMock(), "easyocr": MagicMock()}):
            resp = client.get("/api/system-check")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "easyocr_detected" in data
        assert "gpu_active" in data


# ---------------------------------------------------------------------------
# /api/select-video (local path branch)
# ---------------------------------------------------------------------------

class TestSelectVideo:
    def test_missing_path_returns_400(self, client):
        resp = client.post("/api/select-video", json={})
        assert resp.status_code == 400

    def test_unsupported_extension_returns_400(self, client):
        resp = client.post("/api/select-video", json={"path_or_url": "video.xyz"})
        assert resp.status_code == 400

    def test_file_not_found_returns_404(self, client):
        resp = client.post("/api/select-video", json={"path_or_url": "nonexistent.mp4"})
        assert resp.status_code == 404

    def test_local_file_returns_session_id(self, client):
        with patch("app.os.path.exists", return_value=True):
            resp = client.post("/api/select-video", json={"path_or_url": "video.mp4"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert "session_id" in data
        assert data["type"] == "local"

    def test_url_starts_background_download(self, client):
        with patch("app.threading.Thread") as mock_thread:
            mock_thread.return_value = MagicMock()
            resp = client.post("/api/select-video", json={"path_or_url": "https://example.com/video"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["type"] == "download"
        assert "download_id" in data
        assert "session_id" in data


# ---------------------------------------------------------------------------
# /api/download-status
# ---------------------------------------------------------------------------

class TestDownloadStatus:
    def test_unknown_id_returns_404(self, client):
        resp = client.get("/api/download-status/nonexistent-id")
        assert resp.status_code == 404

    def test_returns_download_state(self, client):
        dl_id = "test-dl-id"
        flask_app.DOWNLOADS[dl_id] = {
            'status': 'downloading', 'progress': 42.0,
            'path': None, 'filename': None,
            'error': None, 'session_id': 'sess-1',
        }
        resp = client.get(f"/api/download-status/{dl_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "downloading"
        assert data["progress"] == 42.0


# ---------------------------------------------------------------------------
# /api/video-info
# ---------------------------------------------------------------------------

class TestVideoInfo:
    def test_no_session_id_returns_400(self, client):
        resp = client.get("/api/video-info")
        assert resp.status_code == 400

    def test_unknown_session_returns_400(self, client):
        resp = client.get("/api/video-info?session_id=nonexistent")
        assert resp.status_code == 400

    def test_returns_metadata_when_video_active(self, client, session_id):
        import cv2 as real_cv2

        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = True
        mock_cap.get.side_effect = lambda prop: {
            real_cv2.CAP_PROP_FRAME_WIDTH:  1280.0,
            real_cv2.CAP_PROP_FRAME_HEIGHT: 720.0,
            real_cv2.CAP_PROP_FRAME_COUNT:  300.0,
            real_cv2.CAP_PROP_FPS:          30.0,
        }.get(prop, 0.0)

        with patch("app.os.path.exists", return_value=True), \
             patch("app.cv2.VideoCapture", return_value=mock_cap):
            resp = client.get(f"/api/video-info?session_id={session_id}")

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["width"] == 1280
        assert data["height"] == 720
        assert data["total_frames"] == 300
        assert data["fps"] == 30.0


# ---------------------------------------------------------------------------
# /api/preview-ocr — validation
# ---------------------------------------------------------------------------

class TestPreviewOcr:
    def test_no_session_returns_400(self, client):
        resp = client.post("/api/preview-ocr", json={"roi": [0, 0, 100, 50]})
        assert resp.status_code == 400

    def test_invalid_roi_returns_400(self, client, session_id):
        with patch("app.os.path.exists", return_value=True):
            resp = client.post("/api/preview-ocr", json={
                "session_id": session_id,
                "roi": [0, 0, -10, 50],
            })
        assert resp.status_code == 400

    def test_roi_with_non_numeric_values_returns_400(self, client, session_id):
        with patch("app.os.path.exists", return_value=True):
            resp = client.post("/api/preview-ocr", json={
                "session_id": session_id,
                "roi": ["a", "b", "c", "d"],
            })
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# /api/status
# ---------------------------------------------------------------------------

class TestStatus:
    def test_idle_when_no_session(self, client):
        resp = client.get("/api/status")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "idle"

    def test_idle_when_session_has_no_processor(self, client, session_id):
        resp = client.get(f"/api/status?session_id={session_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "idle"

    def test_returns_processor_status(self, client, session_id):
        mock_proc = MagicMock()
        mock_proc.get_status.return_value = {"status": "running", "progress": 42.0}
        flask_app.SESSIONS[session_id]['processor'] = mock_proc

        resp = client.get(f"/api/status?session_id={session_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "running"
        assert data["progress"] == 42.0


# ---------------------------------------------------------------------------
# /api/process — validation
# ---------------------------------------------------------------------------

class TestStartProcessing:
    def test_no_session_returns_400(self, client):
        resp = client.post("/api/process", json={"fields": [{"key": "speed"}]})
        assert resp.status_code == 400

    def test_no_fields_returns_400(self, client, session_id):
        with patch("app.os.path.exists", return_value=True):
            resp = client.post("/api/process", json={
                "session_id": session_id,
                "fields": [],
            })
        assert resp.status_code == 400

    def test_no_video_in_session_returns_400(self, client):
        sid = flask_app._create_session(None)
        resp = client.post("/api/process", json={
            "session_id": sid,
            "fields": [{"key": "speed"}],
        })
        assert resp.status_code == 400
