# Video HUD Extractor (Get_Movie)

動画（主に車載映像や走行ログ映像）の画面上に表示されているスピードメーター（車速）やラップタイムの表示領域から、OCR（文字認識）を用いて時系列の走行データを自動で抽出し、CSV化するツールです。

## 📁 構造

```text
video-hud-extractor/
├── .gitignore                      # Git除外設定
├── README.md                       # 本説明書
├── requirements.txt                # 依存ライブラリ一覧
├── download_video.py               # YouTube動画ダウンロードユーティリティ
├── roi_selector.py                 # GUIによる関心領域(ROI)選択ツール
└── analysis_movie_v1_multithreds.py # [メイン] マルチスレッド動画OCR解析スクリプト
```

## 🛠️ 前提条件

本ツールで文字認識（OCR）を行うためには、システムに **Tesseract-OCR** のインストールが必要です。

### Tesseract-OCR のインストール
1. Windowsの場合、以下のインストーラーなどからTesseract-OCRをダウンロードし、インストールします。
   - [Tesseract-OCR Windows Installs](https://github.com/UB-Mannheim/tesseract/wiki)
2. `analysis_movie_v1_multithreds.py` の 11行目にある `pytesseract.pytesseract.tesseract_cmd` のパスを、ご自身の環境に合わせて修正してください。
   ```python
   pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
   ```

### 必要なバイナリ
動画の処理に `ffmpeg` 等が必要な場合は、環境変数 `PATH` に通すか、プロジェクトのルートディレクトリに配置してください（※ Git管理からは除外されます）。

## 🚀 使い方

### 1. 依存ライブラリのインストール
```bash
pip install -r requirements.txt
```

### 2. 解析対象の動画を準備
YouTubeなどの動画を使う場合は、`download_video.py` の `video_url` を書き換えて実行することで、最高画質で動画をダウンロードできます。
```bash
python download_video.py
```

### 3. 読み取り座標 (ROI) の特定
動画内の「ラップタイム」と「車速」の表示エリアを特定するため、以下のツールを起動します。
```bash
python roi_selector.py
```
- ポップアップされたウィンドウ上で、まず「ラップタイム領域」をマウスでドラッグして選択し、Enterキーで決定します（キャンセルはESCキー）。
- 次に「車速領域」を同様に選択し、Enterキーで決定します。
- コンソールに選択した座標が表示されるので、それをメモします。

### 4. 動画解析の実行
`analysis_movie_v1_multithreds.py` の `lap_time_roi` と `speed_roi` に、ステップ3で特定した座標を書き込み、実行します。
```bash
python analysis_movie_v1_multithreds.py
```
- 解析にはマルチスレッド（デフォルト12スレッド）が使用され、進捗バーが表示されます。
- 解析完了後、結果が `output_data.csv` に出力され、車速とラップタイムの推移グラフが表示されます。
