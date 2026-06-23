# X Tools

一个 Chrome / Edge 扩展，参考 `Icy-Cat/x-viral-monitor` 的功能形态，实时流速徽章、热帖排行榜、书签数和 Markdown 复制。

## 功能

- 流速徽章：在 X 时间线推文头部显示 views/hour，颜色分级（绿/橙/红）
- 爆帖评分：悬浮徽章查看浏览、互动、收藏和 0-100 分评分
- 流速排行榜：右侧浮动面板，可拖拽、缩放宽度/高度，按当前页面可见推文流速排序
- 书签数显示：在推文操作栏补充 bookmark count
- 仅看热帖：按每小时浏览量或总浏览量隐藏低热度推文
- Markdown 复制：在推文操作栏添加 MD 复制按钮
- 图片查看：双击 X 图片打开原图预览

## 安装

1. 打开 `chrome://extensions/`
2. 开启右上角"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择这个目录：`x-tools`

## 实现说明

- `hook-main.js` 运行在页面 MAIN world，拦截 X GraphQL `fetch` / `XMLHttpRequest` 响应并提取 tweet metrics
- `content-script.js` 运行在扩展隔离世界，接收 tweet 数据、读取设置、渲染 DOM
- `popup.html` / `popup.js` 提供功能开关和阈值设置（Tab 布局）
- `styles.css` 同时服务页面注入 UI 和 popup UI，使用暖棕/沙色配色

## 样式说明

采用参考项目的暖棕/沙色调：
- 徽章：半透明背景 + 深色文字，绿/橙/红三级
- 排行榜：`#fffcf6` 底色，`#bf5a2a` 暖橙强调色，14px 圆角
- 字体：`"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif`
- 暗色主题：自动跟随系统 `prefers-color-scheme: dark`
