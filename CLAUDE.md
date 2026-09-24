# vehicle-dashcam-analyzer — Claude Context

車載動画のスピードメーター/RPM等の表示領域をOCRで解析し、時系列走行データをWebダッシュボードで可視化・CSVエクスポートするツール。

## スタック

- バックエンド: Python / Flask（`backend/app.py`）+ EasyOCR（`backend/ocr_processor.py`、macOSのlzma回避パッチ内蔵）
- フロントエンド: React + TypeScript + Vite（`frontend/`）
- `run.py` が一括起動ランチャー（backend + frontend）

## 実行

```bash
python run.py          # backend + frontend を一括起動
# フロントのみ: cd frontend && npm run dev
```

## 注意点

- 旧CLI版スクリプトはすべて `_archive/` に退避済み。新規実装は `backend/`・`frontend/` 側で行う
- `videos/` はダウンロード動画の保存先（大容量になりやすい、gitignore対象か確認してからコミット）
- OCR領域選択（ROI）はフロント側 `ROISelector.tsx` で行う。バックエンドのOCRパラメータ変更は `FieldConfig.tsx` の想定値とズレないよう両方確認する
