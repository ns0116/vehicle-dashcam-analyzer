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

## セキュリティ上の注意

- ローカル個人利用が前提。バックエンドは既定で `127.0.0.1` のみ待ち受け（`HOST` / `PORT`（既定5001）/ `FLASK_DEBUG` 環境変数で変更可）。`HOST=0.0.0.0` 等でLANに公開しない
- `/api/select-video` はローカルの任意ファイルパスを読み込め、`yt-dlp` で任意URLもダウンロードできる。認証・パス制限を追加せずに外部公開する変更はしない
- 車載動画・CSVにはナンバープレート等の個人情報が映り込み得る。サンプル動画・出力CSVをコミットしない（`videos/`・`*.csv` は`.gitignore`対象）。詳細はREADME「セキュリティに関する注意」「プライバシーに関する注意」

## クラウド／サンドボックスでの作業

- 実OCR（EasyOCR + PyTorch）は重い: PyTorchのLinux x86_64 wheelだけで約0.55GB（PyPI掲載値）、Linuxでは更にCUDA系依存が入りうる（実測せず）。初回実行時にEasyOCRがモデル重みを `~/.EasyOCR/` へネットワークDLする。通常のコード変更・テストでは実OCRは不要
- 実OCRを使わない作業はCIと同じ手順で足りる: backendは `pip install pytest numpy opencv-python-headless flask flask-cors pandas` のみ（easyocr/torch/yt_dlpは `conftest.py` がモック）。例: `uv run --no-project --python 3.13 --with pytest --with numpy --with opencv-python-headless --with flask --with flask-cors --with pandas pytest backend/tests/ -q`
- frontendは `cd frontend && npm ci`。ローカルのNode v25でも lint/test/build は通る（2026-10-04確認。Node 25固有の失敗は出なかった。CIはNode 20）
- `TelemetryOCRProcessor` は `easyocr.Reader(['en'], gpu=True)` 固定（`backend/ocr_processor.py`）。GPUなし環境での挙動は未検証。`GET /api/system-check` でGPU有無（CUDA/Metal/CPU）を確認できる
- 動画は `videos/` に置くか、`/api/select-video` にファイルパスまたはURLを渡す（リポジトリに動画は含まれない）。実OCR・重い動画処理が必要な検証はGPU付きローカルで行う
- `python run.py` は実行中のPython環境へ `pip install -r backend/requirements.txt` を行う（venv推奨）。サンドボックスでは使わず、必要なプロセスだけ個別に起動して終了時に止める
