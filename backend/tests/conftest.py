"""
Stub out heavy ML dependencies before any test module imports them.
This keeps the test suite runnable in CI without installing torch / easyocr / yt_dlp.
"""
import sys
from unittest.mock import MagicMock

for _mod in ["easyocr", "torch", "torchvision", "torch.backends", "yt_dlp"]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()
