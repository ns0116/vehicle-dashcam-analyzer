import yt_dlp

def download_video(url):
    ydl_opts = {
        'outtmpl': './videos/%(title)s.%(ext)s',  # videosディレクトリに保存
        'format': 'bestvideo+bestaudio/best',  # 最高画質・最高音質
        # 'ignoreerrors': True,                   # エラーを無視
        # 'verbose': True,                        # 詳細ログ表示
        # 'embedthumbnail': True,  # サムネイルを埋め込むオプション
        'embedmetadata': True  # メタデータを埋め込むオプション (サムネイルも含む)
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

if __name__ == "__main__":
    # video_url = input("ダウンロードしたい動画のURLを入力してください: ")
    # video_url = "https://www.youtube.com/watch?v=kgvLYo_ay2M"
    video_url = "https://www.youtube.com/watch?v=_dzBY8KAbKA&t=12s"
    download_video(video_url)
    print("ダウンロードが完了しました。")