import cv2

def get_roi_coordinates(video_path):
    """
    動画の中間フレームからGUI上でROI (Region of Interest) を選択し、座標を取得する関数

    Args:
        video_path (str): 動画ファイルのパス

    Returns:
        tuple: (lap_time_roi, speed_roi) ラップタイム領域と車速領域の座標 (x1, y1, x2, y2) のタプル
                 選択がキャンセルされた場合は (None, None) を返す
    """

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("動画ファイルを開けません。ファイルパスが正しいか、動画形式がOpenCVでサポートされているか確認してください。")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames <= 0:
        cap.release()
        raise ValueError("総フレーム数を取得できませんでした。動画ファイルが正しく読み込めているか確認してください。")

    middle_frame_index = total_frames // 2 # 中間フレームのインデックス
    cap.set(cv2.CAP_PROP_POS_FRAMES, middle_frame_index) # フレーム位置を移動

    ret, frame = cap.read()
    if not ret:
        cap.release()
        raise ValueError("動画中盤フレームを読み込めません。動画ファイルが破損していないか確認してください。")

    # フレームが読み込めたか確認 (デバッグ用)
    if frame is None:
        cap.release()
        raise ValueError("フレームデータが空です。動画が正しく読み込まれているか確認してください。")

    # 表示ウィンドウを0.5倍にスケーリング
    scale_factor = 0.5
    frame_height, frame_width = frame.shape[:2]
    resized_width = int(frame_width * scale_factor)
    resized_height = int(frame_height * scale_factor)
    resized_frame = cv2.resize(frame, (resized_width, resized_height))

    # リサイズ後のフレームを表示 (ウィンドウ名を英語に変更)
    cv2.imshow("Select ROIs (Press Enter to confirm, ESC to cancel)", resized_frame)

    # ラップタイム領域の選択
    print("1. Select Lap Time ROI (Rectangular)")
    lap_time_roi = cv2.selectROI("Select ROIs (Press Enter to confirm, ESC to cancel)", resized_frame, fromCenter=False, showCrosshair=True)
    if lap_time_roi == (0, 0, 0, 0): # ESCキーでキャンセルされた場合
        cv2.destroyAllWindows()
        cap.release()
        return None, None
    # リサイズ後のROI座標を元のフレーム座標に変換
    lap_time_roi = (int(lap_time_roi[0] / scale_factor), int(lap_time_roi[1] / scale_factor), int((lap_time_roi[0] + lap_time_roi[2]) / scale_factor), int((lap_time_roi[1] + lap_time_roi[3]) / scale_factor))

    # 車速領域の選択
    print("2. Select Speed ROI (Rectangular)")
    speed_roi = cv2.selectROI("Select ROIs (Press Enter to confirm, ESC to cancel)", resized_frame, fromCenter=False, showCrosshair=True)
    if speed_roi == (0, 0, 0, 0): # ESCキーでキャンセルされた場合
        cv2.destroyAllWindows()
        cap.release()
        return None, None
    # リサイズ後のROI座標を元のフレーム座標に変換
    speed_roi = (int(speed_roi[0] / scale_factor), int(speed_roi[1] / scale_factor), int((speed_roi[0] + speed_roi[2]) / scale_factor), int((speed_roi[1] + speed_roi[3]) / scale_factor))

    cv2.destroyAllWindows()
    cap.release()
    return lap_time_roi, speed_roi


if __name__ == "__main__":
    video_file = 'input_video.mp4' # 動画ファイルパス (必要に応じて変更)

    try:
        lap_time_roi, speed_roi = get_roi_coordinates(video_file)

        if lap_time_roi and speed_roi:
            print(f"Lap Time ROI: {lap_time_roi}")
            print(f"Speed ROI: {speed_roi}")
            print("\nPlease copy the ROI coordinates above to the lap_time_roi and speed_roi variables in your main script.")
        else:
            print("ROI selection cancelled.")

    except ValueError as e:
        print(f"Error: {e}")
    except FileNotFoundError:
        print(f"Error: Video file not found: {video_file}")