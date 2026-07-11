"""
Tests for TelemetryOCRProcessor pure logic (no EasyOCR / GPU required).
"""
import sys
import os
import pytest
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ocr_processor import TelemetryOCRProcessor  # noqa: E402


@pytest.fixture()
def proc():
    """Return a TelemetryOCRProcessor instance without calling __init__ (avoids easyocr.Reader)."""
    p = TelemetryOCRProcessor.__new__(TelemetryOCRProcessor)
    return p


# ---------------------------------------------------------------------------
# parse_value
# ---------------------------------------------------------------------------

class TestParseValueInteger:
    def test_plain_digits(self, proc):
        assert proc.parse_value("124", "integer") == 124

    def test_strips_whitespace(self, proc):
        assert proc.parse_value("  42  ", "integer") == 42

    def test_negative(self, proc):
        assert proc.parse_value("-7", "integer") == -7

    def test_digits_embedded_in_text(self, proc):
        assert proc.parse_value("Speed: 120 km/h", "integer") == 120

    def test_no_digits_returns_none(self, proc):
        assert proc.parse_value("abc", "integer") is None

    def test_empty_string_returns_none(self, proc):
        assert proc.parse_value("", "integer") is None

    def test_none_input_returns_none(self, proc):
        assert proc.parse_value(None, "integer") is None


class TestParseValueFloat:
    def test_simple_float(self, proc):
        assert proc.parse_value("12.4", "float") == pytest.approx(12.4)

    def test_comma_separator(self, proc):
        assert proc.parse_value("12,4", "float") == pytest.approx(12.4)

    def test_negative_float(self, proc):
        assert proc.parse_value("-3.14", "float") == pytest.approx(-3.14)

    def test_integer_string_as_float(self, proc):
        assert proc.parse_value("100", "float") == pytest.approx(100.0)

    def test_no_number_returns_none(self, proc):
        assert proc.parse_value("no number here", "float") is None


class TestParseValueTime:
    def test_mm_ss_ms(self, proc):
        result = proc.parse_value("1:23.4", "time")
        assert result == pytest.approx(1 * 60 + 23 + 0.4)

    def test_hh_mm_ss_ms(self, proc):
        result = proc.parse_value("1:02:03.5", "time")
        assert result == pytest.approx(1 * 3600 + 2 * 60 + 3 + 0.5)

    def test_ss_ms_only(self, proc):
        result = proc.parse_value("45.7", "time")
        assert result == pytest.approx(45 + 0.7)

    def test_no_match_returns_none(self, proc):
        assert proc.parse_value("abc", "time") is None

    def test_comma_decimal_normalised(self, proc):
        result = proc.parse_value("1:23,4", "time")
        assert result == pytest.approx(1 * 60 + 23 + 0.4)


class TestParseValueString:
    def test_plain_text(self, proc):
        assert proc.parse_value("N", "string") == "N"

    def test_gear_code(self, proc):
        assert proc.parse_value("3rd", "string") == "3rd"


# ---------------------------------------------------------------------------
# preprocess_image
# ---------------------------------------------------------------------------

class TestPreprocessImage:
    @pytest.fixture()
    def gray_patch_img(self):
        """50x50 BGR image with a 200-gray square in the center."""
        img = np.zeros((50, 50, 3), dtype=np.uint8)
        img[10:40, 10:40] = [200, 200, 200]
        return img

    def test_no_threshold_returns_rgb_shape(self, proc, gray_patch_img):
        result = proc.preprocess_image(gray_patch_img, None, False)
        assert result.shape == (50, 50, 3)

    def test_no_threshold_swaps_bgr_to_rgb(self, proc, gray_patch_img):
        result = proc.preprocess_image(gray_patch_img, None, False)
        # For a gray pixel B==G==R, channels stay the same value.
        assert int(result[25, 25, 0]) == int(gray_patch_img[25, 25, 2])

    def test_threshold_binarises_bright_pixel_to_white(self, proc, gray_patch_img):
        result = proc.preprocess_image(gray_patch_img, 127, False)
        assert result.shape == (50, 50, 3)
        assert result[25, 25, 0] == 255  # 200 > 127 → white

    def test_threshold_binarises_dark_pixel_to_black(self, proc, gray_patch_img):
        result = proc.preprocess_image(gray_patch_img, 127, False)
        assert result[5, 5, 0] == 0  # 0 < 127 → black

    def test_invert_flips_binarisation(self, proc, gray_patch_img):
        normal = proc.preprocess_image(gray_patch_img, 127, False)
        inverted = proc.preprocess_image(gray_patch_img, 127, True)
        assert normal[25, 25, 0] == 255
        assert inverted[25, 25, 0] == 0

    def test_zero_threshold_treated_as_no_threshold(self, proc, gray_patch_img):
        result = proc.preprocess_image(gray_patch_img, 0, False)
        assert result.shape == (50, 50, 3)


# ---------------------------------------------------------------------------
# run_ocr confidence filtering (mocked reader)
# ---------------------------------------------------------------------------

class TestRunOcrConfidenceFilter:
    def test_filters_low_confidence(self, proc):
        from unittest.mock import MagicMock
        proc.reader = MagicMock()
        # Two detections: high-conf "120" and low-conf "O"
        proc.reader.readtext.return_value = [
            (None, "120", 0.9),
            (None, "O",   0.1),
        ]
        result = proc.run_ocr(np.zeros((10, 10, 3), dtype=np.uint8), "integer", min_confidence=0.5)
        assert "O" not in result
        assert "120" in result

    def test_accepts_all_when_threshold_zero(self, proc):
        from unittest.mock import MagicMock
        proc.reader = MagicMock()
        proc.reader.readtext.return_value = [
            (None, "120", 0.9),
            (None, "O",   0.1),
        ]
        result = proc.run_ocr(np.zeros((10, 10, 3), dtype=np.uint8), "integer", min_confidence=0.0)
        assert "120" in result
        assert "O" in result

    def test_empty_results_returns_empty_string(self, proc):
        from unittest.mock import MagicMock
        proc.reader = MagicMock()
        proc.reader.readtext.return_value = []
        result = proc.run_ocr(np.zeros((10, 10, 3), dtype=np.uint8), "integer")
        assert result == ""
