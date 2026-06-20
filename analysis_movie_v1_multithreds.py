import cv2
import pytesseract
from PIL import Image
import matplotlib.pyplot as plt
import pandas as pd
import re  # 正規表現ライブラリ
from tqdm import tqdm  # tqdm ライブラリのインポート
import concurrent.futures # マルチスレッド用ライブラリ

# Tesseract-OCRのパス (環境に合わせて変更)
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe' # 例: Windows

def extract_data_from_video(video_path, lap_time_roi, speed_roi, frame_skip=3, threshold_value=150, num_threads=4): # num_threads引数を追加
    """
    動画からラップタイムと車速を抽出する関数 (プログレスバー表示、フレーム間引き処理、グレースケール+二値化、タイムスタンプ出力、マルチスレッド処理付き)

    Args:
        video_path (str): 動画ファイルのパス
        lap_time_roi (tuple): ラップタイム領域 (x1, y1, x2, y2)
        speed_roi (tuple): 車速領域 (x1, y1, x2, y2)
        frame_skip (int): フレーム間引き間隔 (例: 3 なら 3フレームに1回解析)
        threshold_value (int): 二値化の閾値 (0-255)
        num_threads (int): OCR処理に使用するスレッド数

    Returns:
        pandas.DataFrame: タイムスタンプ順にソートされた時系列データ (timestamp, frame, lap_time, speed) を含むDataFrame
    """

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("動画ファイルが開けません")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames <= 0:
        cap.release()
        raise ValueError("総フレーム数を取得できませんでした。動画ファイルが正しく読み込めているか確認してください。")

    fps = cap.get(cv2.CAP_PROP_FPS) # FPSを取得
    if fps <= 0:
        cap.release()
        raise ValueError("FPSを取得できませんでした。動画ファイルが正しく読み込めているか確認してください。")

    data = []
    frame_count = 0

    with tqdm(total=total_frames // (frame_skip + 1), desc="動画解析中") as pbar, concurrent.futures.ThreadPoolExecutor(max_workers=num_threads) as executor: # ThreadPoolExecutor をコンテキストマネージャーとして使用
        futures = [] # Futureオブジェクトを格納するリスト

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_count += 1

            if frame_count % (frame_skip + 1) != 0: # フレーム間引き処理: 指定間隔以外のフレームはスキップ
                continue # 次のフレームへ

            timestamp_ms = cap.get(cv2.CAP_PROP_POS_MSEC) # ミリ秒単位のタイムスタンプを取得
            timestamp_sec = timestamp_ms / 1000.0 # 秒単位に変換

            # 各フレームのOCR処理をスレッドプールにsubmit
            future = executor.submit(process_frame_ocr, frame, lap_time_roi, speed_roi, threshold_value) # process_frame_ocr 関数に処理を委譲
            futures.append({'timestamp': timestamp_sec, 'frame': frame_count, 'future': future}) # Futureオブジェクトとフレーム情報を紐付けてリストに追加
            pbar.update(1)

        # 全Futureオブジェクトの処理完了を待機し、結果を取得
        for item in futures:
            future = item['future']
            lap_time_seconds, speed_kmh = future.result() # 結果を取得
            data.append({'timestamp': item['timestamp'], 'frame': item['frame'], 'lap_time': lap_time_seconds, 'speed': speed_kmh}) # 結果をデータリストに追加

    cap.release()
    df = pd.DataFrame(data)
    df_sorted = df.sort_values(by='timestamp') # タイムスタンプでソート
    return df_sorted


def process_frame_ocr(frame, lap_time_roi, speed_roi, threshold_value): # OCR処理を関数化
    """
    フレーム画像からOCRでラップタイムと車速を抽出する関数

    Args:
        frame (numpy.ndarray): フレーム画像
        lap_time_roi (tuple): ラップタイム領域
        speed_roi (tuple): 車速領域
        threshold_value (int): 二値化閾値

    Returns:
        tuple: (lap_time_seconds, speed_kmh) ラップタイム(秒)と車速(km/h)
    """
    # ラップタイム領域を切り出し、グレースケール+二値化処理、OCR処理
    lap_time_image_color = frame[lap_time_roi[1]:lap_time_roi[3], lap_time_roi[0]:lap_time_roi[2]] # カラー画像として切り出し
    lap_time_image_gray = cv2.cvtColor(lap_time_image_color, cv2.COLOR_BGR2GRAY) # グレースケール化
    _, lap_time_image_binary = cv2.threshold(lap_time_image_gray, threshold_value, 255, cv2.THRESH_BINARY) # 二値化 (閾値処理)
    lap_time_pil_image = Image.fromarray(lap_time_image_binary) # PIL Image に変換
    lap_time_text = pytesseract.image_to_string(lap_time_pil_image, config='--psm 7')
    lap_time_seconds = parse_lap_time(lap_time_text)

    # 車速領域を切り出し、グレースケール+二値化処理、OCR処理
    speed_image_color = frame[speed_roi[1]:speed_roi[3], speed_roi[0]:speed_roi[2]] # カラー画像として切り出し
    speed_image_gray = cv2.cvtColor(speed_image_color, cv2.COLOR_BGR2GRAY) # グレースケール化
    _, speed_image_binary = cv2.threshold(speed_image_gray, threshold_value, 255, cv2.THRESH_BINARY) # 二値化 (閾値処理)
    speed_pil_image = Image.fromarray(speed_image_binary) # PIL Image に変換
    speed_text = pytesseract.image_to_string(speed_pil_image, config='--psm 7')
    speed_kmh = parse_speed(speed_text)

    return lap_time_seconds, speed_kmh # 2つの値を返す


def parse_lap_time(text):
    """OCRテキストからラップタイム（秒）を抽出・変換する関数 (hh:mm:ss.0 形式対応)"""
    match = re.search(r'(\d{2}):(\d{2}):(\d{2}).(\d)', text) # hh:mm:ss.0 形式に対応した正規表現
    if match:
        hours, minutes, seconds, milliseconds = map(int, match.groups()) # 時間、分、秒、ミリ秒を抽出
        total_seconds = hours * 3600 + minutes * 60 + seconds + milliseconds / 10 # 秒単位に変換
        return total_seconds
    return None # 抽出失敗時はNone

def parse_speed(text):
    """OCRテキストから車速(km/h)を抽出・変換する関数 (最大3桁車速対応)"""
    speed_value = re.search(r'(\d{1,3})', text) # 数字部分を1桁から3桁まで抽出するように修正
    if speed_value:
        return int(speed_value.group(1))
    return None # 抽出失敗時はNone


if __name__ == "__main__":
    video_file = 'input_video.mp4' # 動画ファイルパス
    lap_time_roi = (490, 1008, 682, 1044)   # 動画に合わせて調整 (左上x, 左上y, 右下x, 右下y)
    speed_roi = (534, 876, 638, 926)     # 動画に合わせて調整
    threshold_value = 150 # 二値化の閾値 (必要に応じて調整)
    frame_skip = 2 # フレーム間引き間隔 (必要に応じて調整)
    num_threads = 12 # スレッド数 (CPUコア数に合わせて調整)

    try:
        # frame_skip, num_threads を指定
        df = extract_data_from_video(video_file, lap_time_roi, speed_roi, frame_skip=frame_skip, threshold_value=threshold_value, num_threads=num_threads)

        # CSVファイルに保存 (タイムスタンプ列を含む)
        csv_file = 'output_data.csv'
        df.to_csv(csv_file, index=False)
        print(f"データをCSVファイルに保存しました: {csv_file}")

        # グラフ描画 (X軸をタイムスタンプに変更)
        plt.figure(figsize=(12, 6))

        plt.subplot(1, 2, 1) # 1行2列の1番目のグラフ
        plt.plot(df['timestamp'], df['lap_time']) # X軸をタイムスタンプに
        plt.title('Lap Time over Time') # タイトル変更
        plt.xlabel('Time (seconds)') # X軸ラベル変更
        plt.ylabel('Lap Time (seconds)')

        plt.subplot(1, 2, 2) # 1行2列の2番目のグラフ
        plt.plot(df['timestamp'], df['speed']) # X軸をタイムスタンプに
        plt.title('Speed over Time') # タイトル変更
        plt.xlabel('Time (seconds)') # X軸ラベル変更
        plt.ylabel('Speed (km/h)')

        plt.tight_layout() # グラフ間のスペース調整
        plt.show()

    except ValueError as e:
        print(f"エラー: {e}")
    except FileNotFoundError:
        print(f"エラー: 動画ファイルが見つかりません: {video_file}")