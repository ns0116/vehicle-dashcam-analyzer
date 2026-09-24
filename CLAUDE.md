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

- 旧CLI版スクリプトはすべて `_archive/` に退避済み（**ローカル専用・`.gitignore`対象**。クラウドセッションの`git clone`には含まれず参照不可）。新規実装は `backend/`・`frontend/` 側で行う
- `videos/` はダウンロード動画の保存先（大容量になりやすいため`.gitignore`対象）
- OCR領域選択（ROI）はフロント側 `ROISelector.tsx` で行う。バックエンドのOCRパラメータ変更は `FieldConfig.tsx` の想定値とズレないよう両方確認する

## テスト・CI

```bash
pytest backend/tests/ -v
cd frontend && npm run lint && npm run test && npm run build
```

- `.github/workflows/ci.yml`: frontendジョブは上記lint/test/buildを、backendジョブは`py_compile`と`pytest backend/tests/ -v`を実行する
- backend CIは`easyocr`/`torch`を実インストールせず、`backend/tests/conftest.py`でモック化して迂回している（`pytest numpy opencv-python-headless flask flask-cors pandas`のみインストール）。**実際のOCRパイプラインはCIで検証されない**点に注意
