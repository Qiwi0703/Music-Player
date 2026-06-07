# Offline Beat

一个 Spotify 风格的离线本地音乐播放器 PWA。

## 使用方式

推荐用本地静态服务器打开，这样 service worker 才能注册并缓存应用壳。当前机器可以直接运行：

```powershell
& "C:\Users\(Username)\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m http.server 4173 --bind 127.0.0.1
```

如果你的系统已经安装了 Python，也可以运行：

```powershell
python -m http.server 4173
```

然后访问 `http://127.0.0.1:4173`。

如果只是快速预览，也可以直接打开 `index.html`，但浏览器通常不会允许 `file://` 页面注册离线缓存。

## 功能

- 导入本地下载好的歌曲
- 使用 IndexedDB 离线保存歌曲文件和歌单
- 创建歌单、添加歌曲、从歌单移除歌曲
- 播放、暂停、上一首、下一首
- 歌单循环播放
- 显示当前歌曲名、进度和音量
- PWA manifest 与 service worker 离线缓存
