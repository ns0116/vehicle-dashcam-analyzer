# AUDIT.md — vehicle-dashcam-analyzer

作成日: 2026-09-24
更新日: 2026-09-24（対応状況追記）

## 対応状況（2026-09-24）

- ✅ **対応済み**: `.gitignore` の `CLAUDE.md` 除外を解除し、Git追跡対象に変更。内容（スタック・実行コマンド・`_archive/`や`videos/`に関する注意点）に機密情報・絶対パスは含まれておらず、公開して問題ないと判断。`.gitignore` は代わりに`CLAUDE.local.md`を除外するよう変更済み。
- ✅ **対応済み**: CLAUDE.mdの`_archive/`言及に「ローカル専用・gitignore対象・クラウドセッションからは参照不可」を明記。テストコマンド（`pytest backend/tests/ -v`、`cd frontend && npm run lint && npm run test && npm run build`）とCI概要（`.github/workflows/ci.yml`がeasyocr/torchをモックして検証している点）を追記（2026-09-24）。
- 未対応: EasyOCR/GPU依存の明記、クラウドサンドボックスでのセットアップ手順明文化などは今回のスコープ外（下記「改善提案」の中・低セクション参照、実装は未着手）。

## プロンプト監査結果

対象ファイルの存在状況:

- `CLAUDE.md`（プロジェクトルート）: **存在する**（23行、`vehicle-dashcam-analyzer\CLAUDE.md`）
- `.claude/agents/*`, `.claude/skills/*`, `.claude/commands/*`, `.claude/rules/*`: **いずれも対象ファイルなし**（`.claude/` ディレクトリ自体が存在しない）

### 最重要の発見: CLAUDE.md自体がgit管理対象外

`.gitignore` の末尾に以下がある。

```
# Claude Code
CLAUDE.md
```

つまり `CLAUDE.md` はリポジトリに一切コミットされていない。ローカル環境では手元にファイルが存在するため気づきにくいが、**クラウドの隔離サンドボックスセッション（毎回まっさらな`git clone`）では、このファイル自体が一切存在しない**。今回この監査タスクの指示文が前提としている「クラウドセッションでもCLAUDE.mdが読み込まれる」という状況そのものが、現状の設定では成立しない。プロンプト監査・クラウド対応検討のいずれの観点でも最優先で扱うべき論点。

### 古くなった情報・矛盾

- `CLAUDE.md:20`「旧CLI版スクリプトはすべて `_archive/` に退避済み。新規実装は `backend/`・`frontend/` 側で行う」との記述があるが、プロジェクトルートに `_archive/` ディレクトリは**現存しない**（`find . -maxdepth 1 -iname "*archive*"` で0件）。さらに `.gitignore:16`「旧CLIツール群（ローカル参照用に残すが、公開リポジトリには含めない）\n_archive/」とあり、そもそも意図的にgit管理対象外にしている。ローカルの別環境でも同様に存在しない可能性があり、また上記の通りCLAUDE.md自体がクラウドセッションに渡らないため実害は限定的だが、ローカルで参照した際に「`_archive/`を見て」と指示されたエージェントが存在しないディレクトリを探索する無駄が生じ得る。「ローカル専用・gitignore対象」である旨を明記するか、記述自体を削除すべき。
- `CLAUDE.md:21`「`videos/` はダウンロード動画の保存先（大容量になりやすい、gitignore対象か確認してからコミット）」は、`.gitignore:9`ですでに `videos/` が対象化されており「確認してから」という保留表現はすでに解消済みの古い書き方。断定形に直すべき（些細）。

### 曖昧・解釈がブレそうな箇所

- 上記「gitignore対象か確認してからコミット」は、これから確認する指示なのか、確認済みで対象外という前提なのか読み手によって解釈が分かれる。
- 「バックエンドのOCRパラメータ変更は `FieldConfig.tsx` の想定値とズレないよう両方確認する」（`CLAUDE.md:22`）は方針としては妥当だが、両者の対応関係（どのフィールド/パラメータが厳密に対応するか）が書かれておらず、初見のエージェントは実際に両ファイルを読んで突き合わせる必要がある。具体的なフィールド名（threshold, invert, min_confidence等）を1行挙げるだけでも探索コストが下がる。

### 冗長な記述

- 現状のCLAUDE.mdは23行と簡潔で、無駄なトークン消費は見られない。README.mdとの間で「スタック」「実行方法」の説明が軽く重複しているが、対象読者（人間 vs エージェント）が異なるため許容範囲。ただし将来的にどちらかを更新し忘れると内容が乖離するリスクはある。

### 本来書いておくべきなのに抜けているコンテキスト

コード上には存在するがCLAUDE.mdに書かれていない情報:

- **テストコマンド**: `backend/tests/`（pytest, `conftest.py`でeasyocr/torch/yt_dlpをモック）、`frontend/src/__tests__/`（vitest）。実行コマンド（`pytest backend/tests/ -v`、`cd frontend && npm run test`）が未記載。
- **CI概要**: `.github/workflows/ci.yml`でfrontend（lint/test/build）とbackend（py_compile/pytest、ただしtorch/easyocrは実インストールせずモック）が走ることが未記載。
- **環境変数**: `backend/app.py:474-476`の`PORT`（既定5001）、`HOST`（既定127.0.0.1）、`FLASK_DEBUG`（既定0）が未記載。
- **セッションモデル/アーキテクチャ概要**: `app.py`内の`SESSIONS`/`DOWNLOADS`のグローバル辞書によるセッション管理方式（ブラウザタブ単位でsession_idを発行し、同時実行を分離する設計）が未記載。新規機能追加時に把握が必要な設計判断。
- **セキュリティ上の注意**: README.md側には「`/api/select-video`はローカルの任意ファイルパスを読み込める」「信頼できないネットワークに公開しない」という重要な注意書きがあるが、CLAUDE.md側には一切転記されていない。エージェント向けの作業指針としても重要な情報。
- **GPU/EasyOCRの重量依存**: `easyocr.Reader(['en'], gpu=True)`（`backend/ocr_processor.py:30`）を軸にした処理系であること、初回実行時にモデルの重みをネットワーク経由でダウンロードすることなど、開発時に踏みやすい落とし穴が未記載。

## ローカル依存リスト

全体としてWindows/WSL/NASの**絶対パスのハードコード（`D:\`, `C:\Users\`, `/mnt/`, `\\host\share`等）はリポジトリ内に一件も見つからなかった**（プロジェクト全体をgrep、node_modules等を除く）。ハードコードパス面ではクラウド移植性は比較的良好。ただし以下の依存・前提が見つかった。

1. **CLAUDE.mdがgit管理対象外**（`.gitignore:19-20`）
   クラウドセッションが`git clone`した時点でこのファイルが存在しない。「ローカル依存」というより「クラウドセッションにコンテキストが一切渡らない」という、今回の監査観点で最も重大な項目。

2. **`_archive/`への参照が実体・git管理のいずれからも欠落**（`CLAUDE.md:20`、`.gitignore:16`）
   ローカルにも現存せず、かつgitignore対象。クラウドセッションからは原理的に到達不可能なディレクトリへの言及が残っている。

3. **EasyOCRのGPU固定初期化**（`backend/ocr_processor.py:30`）
   ```python
   self.reader = easyocr.Reader(['en'], gpu=True)
   ```
   `/api/preview-ocr`（`backend/app.py:301`）と`BackgroundVideoProcessor._process_video`（`backend/ocr_processor.py:223`）の両方でこの初期化を経由する。GPUなしのクラウドサンドボックスでもEasyOCR/PyTorch側の自動フォールバックで動作はする可能性が高いが、実機で未検証。CPUのみだと処理速度が大幅に低下する点は`backend/app.py:432-457`の`/api/system-check`エンドポイント（`gpu_active`判定）でも前提とされている設計。

4. **EasyOCR / PyTorchの重量級依存とモデルの実行時ダウンロード**（`backend/requirements.txt:4`）
   `easyocr==1.7.2`はPyTorchを連鎖的に要求し、初回`pip install`だけで数GB規模になり得る。さらに初回推論時に学習済みモデルの重みをネットワーク経由（AWS/GitHub等）で取得する。クラウドサンドボックスのegress制限やディスク/時間クォータによっては、依存インストールやモデル取得自体が失敗し得る。CI（`.github/workflows/ci.yml:34`）はこの重量依存を回避するため`pytest numpy opencv-python-headless flask flask-cors pandas`のみをインストールし、`backend/tests/conftest.py:8-10`でeasyocr/torch/yt_dlpをモック化して迂回している——裏を返せば、CIは実際のOCRパイプラインを一度も検証していない。

5. **サンプル/テスト用動画がリポジトリに一切含まれない**（`videos/`は`.gitignore:9`で除外、`*.mp4`も`.gitignore:8`で除外）
   アプリの主要機能（ローカル動画ファイルパスの指定、またはYouTube URLからの`yt-dlp`ダウンロード）を実際に動かして確認するには、クラウドセッション側で動画を用意する必要がある。ローカルファイルパスを指定するUIの都合上（`frontend/src/App.tsx:221`のplaceholderが`/Users/path/video.mp4`等を例示）、動画そのものをクラウドサンドボックスにアップロードするか、`yt-dlp`でネットワーク経由ダウンロードするかのいずれかが必須になる。後者はクラウド側のegress許可とYouTube側のブロック挙動に依存する。

6. **`run.py`のブラウザ自動起動**（`run.py:62-65`）
   `webbrowser.open("http://localhost:5001")`はGUIのないクラウドサンドボックスでは効果を持たない（エラーにはならないが無意味）。実害はないが、クラウド上での「ワンクリック起動」体験は成立しない。

7. **localhost決め打ちのCORS/プロキシ設定**（`backend/app.py:18`, `frontend/vite.config.ts:10`）
   `CORS`許可オリジンおよびVite開発プロキシの向き先が`http://localhost:5173`/`5001`/`127.0.0.1:*`に固定。通常のクラウドサンドボックス（同一コンテナ内でfrontend/backendを両方起動しポートフォワードする方式）であれば動作するはずだが、サンドボックスのプレビューURLの仕組み次第では調整が必要になる可能性がある。

8. **良好点**: `backend/app.py:474-476`の`PORT`/`HOST`/`FLASK_DEBUG`は既に環境変数化されており、クラウド適応の模範例。`backend/app.py:432-457`の`/api/system-check`もCUDA/MPS/CPUを動的判定しておりハードコードを避けている。

## 改善提案（優先度付き）

### 高

- ✅ **対応済み** ~~CLAUDE.mdを`.gitignore`から外し、リポジトリに含める~~: 機密情報が含まれていないことを確認した上でGit追跡対象に変更した（2026-09-24）。
- ✅ **対応済み** ~~`CLAUDE.md`から`_archive/`への言及を削除するか、「ローカル専用・gitignore対象・クラウドセッションからは参照不可」と明記する~~: CLAUDE.mdの該当行に「ローカル専用・`.gitignore`対象。クラウドセッションの`git clone`には含まれず参照不可」と明記した（2026-09-24）。
- ✅ **対応済み** ~~テストコマンド・CI概要をCLAUDE.mdに追記する~~: `pytest backend/tests/ -v`、`cd frontend && npm run lint && npm run test && npm run build`、および`.github/workflows/ci.yml`がheavy dependency（easyocr/torch）をモックして検証している点をCLAUDE.mdの「テスト・CI」セクションに追記した（2026-09-24）。

### 中

- **クラウドサンドボックスでのセットアップ手順を明文化する**: (a) `pip install -r backend/requirements.txt`は数GB規模のダウンロードを伴うこと、(b) EasyOCRは初回推論時にモデル重みをネットワーク経由取得すること、(c) GPUなし環境ではCPUフォールバックになり処理が大幅に遅くなること、(d) 動作確認用の動画をどう用意するか（アップロード or `yt-dlp`での取得、後者はegress許可が前提）。
- **`easyocr.Reader(gpu=True)`のCPU-onlyサンドボックスでの実際の挙動を一度検証し、結果をコメント/ドキュメントに残す**（自動フォールバックで問題なく動くのか、明示的な例外・警告が出るのか）。
- **README.mdのセキュリティ注意事項（任意ローカルファイル読み込み、信頼できないネットワークへの非公開推奨）をCLAUDE.md側にも要約転記する**。エージェントが実装変更する際の安全側の判断材料になる。

### 低

- CLAUDE.mdとREADME.mdの「スタック」「実行方法」重複箇所を整理し、CLAUDE.mdは差分情報（エージェント向けの作業ルール）に絞る運用ルールを決める。
- `run.py`のブラウザ自動起動処理に、ヘッドレス/クラウド環境では無害だが無意味である旨のコメントを添える（任意、実害なし）。
- CLAUDE.md内「`videos/` はダウンロード動画の保存先（大容量になりやすい、gitignore対象か確認してからコミット）」の「確認してから」を、`.gitignore`ですでに対象化済みである事実に合わせて断定形に修正する。
