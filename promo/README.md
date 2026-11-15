# Still Today 宣传短片

77 秒，1920×1080，60 fps，配乐 111 BPM。整支片子是一个网页动画（`index.html`），`render(t)` 按时间点画出任意一帧，用 Playwright 逐帧截图，再由 ffmpeg 编码并合上配乐。

## 镜头与配乐

| 时间 | 配乐 | 画面 |
|---|---|---|
| 0–10.8s | 前奏 | 浏览器登录、手机批准，慢速两轮 |
| 10.8–25.9s | 鼓点进入 | 登录越来越快（每小节 → 每半小节 → 每拍），作业泡泡破掉，卡片堆满桌面 |
| 25.9–28.1s | 停顿 | Canvas 泡泡飘入，小组件出现 |
| 28.1–36.7s | 鼓点回归 | 泡泡飞进小组件，散落的作业排成列表 |
| 36.7–43.2s | | 按 今天 / 明天 / 本周 分组，橙色手绘圈“快到期了” |
| 43.2–51.9s | | 打开作业 → 专注这项任务 → 25 分钟快进，时长记在作业上 |
| 51.9–58.4s | | 去 Canvas 提交 → 自动打勾 → 出分了 18/20 |
| 58.4–71.3s | 停顿 + 四个小节 | 拉远到桌面一角，每小节换一次壁纸，小组件配色跟着变 |
| 71.3–77.3s | 尾声 | App 图标、Still Today、Canvas 作业，常驻桌面 |

切点都在小节线上（`bt(i)` 是第 i 拍的时间），不是每拍都切。

## 渲染

```bash
npm install
```

```bash
node stills.js out 12 40.8 75
```

```bash
node render.js out/final 60 8
```

```bash
ffmpeg -f concat -safe 0 -i out/final/list.txt -i music.mp3 -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -movflags +faststart -shortest StillToday-promo.mp4
```

`render.js` 的参数依次是：输出目录、帧率、并行数、时长（秒）、缩放（0.5 出半分辨率预览）。配乐文件不在仓库里。
