# X Tools

一个 Chrome 浏览器扩展，为 X (Twitter) 提供实时流速徽章、热帖排行榜、批量删除推文、媒体下载、书签数和 Markdown 复制等功能。

## 功能

| 功能 | 说明 |
|------|------|
| **流速徽章** | 在推文头部显示 views/hour，颜色分级（🌱 普通 / 🚀 热门 / 🔥 爆帖） |
| **爆帖评分** | 悬浮徽章查看浏览、互动、收藏和 0-100 分综合评分 |
| **流速排行榜** | 右侧浮动面板，可拖拽、缩放宽度/高度，按当前页面可见推文流速排序 |
| **Dashboard 面板** | 点击右上角 XT 按钮打开，实时展示流速排行（点击可跳转到推文） |
| **书签数显示** | 在推文操作栏补充 bookmark count |
| **仅看热帖** | 按每小时浏览量或总浏览量隐藏低热度推文 |
| **Markdown 复制** | 在推文操作栏添加 MD 复制按钮 |
| **图片查看** | 双击 X 图片打开原图预览 |
| **媒体下载** | 一键下载推文中的图片和视频 |
| **批量删除推文** | 在 Dashboard「删除」标签页中，手动批量删除自己的推文和回复 |

## 安装

### 方法一：从源码加载（推荐）

1. 克隆或下载本仓库：
   ```bash
   git clone https://github.com/zhoubingyi/x-tools.git
   ```

2. 打开 Chrome，进入 `chrome://extensions/`

3. 开启右上角的「开发者模式」

4. 点击「加载已解压的扩展程序」

5. 选择本项目的 `x-tools` 文件夹

6. 扩展安装完成，刷新 X/Twitter 页面即可使用

### 方法二：打包安装

1. 在 `chrome://extensions/` 页面点击「打包扩展程序」
2. 扩展根目录选择本项目的 `x-tools` 文件夹
3. 生成的 `.crx` 文件可直接拖入 Chrome 安装

## 使用方法

### 流速徽章 & 排行榜

打开 X/Twitter 页面后，扩展自动开始工作：
- 每条推文右侧显示流速徽章（views/hour）
- 鼠标悬停徽章查看详细数据
- 右侧浮动排行榜实时显示最热门推文
- 可拖拽排行榜标题栏移动位置
- 可拖拽右下角/底边调整大小

### Dashboard 设置

点击右上角 **XT** 按钮打开 Dashboard，包含四个标签页：

#### 排行榜
- 实时显示当前页面所有可见推文的流速排行
- 点击排行项可跳转到对应推文
- 显示条数：控制浮动面板的显示数量
- 阈值说明：🌱 < trending < 🚀 < viral < 🔥

#### 删除
批量删除自己的推文和回复（不可恢复，请谨慎操作）：

1. 进入自己的 Profile 页面或 Replies 页面
2. 打开 Dashboard → 「删除」标签页
3. 确认用户名识别正确后，点击「开始删除」
4. 脚本会逐条打开推文菜单 → 删除 → 确认，自动滚动加载更多内容
5. 随时可点击「停止」中断

| 类型 | 是否支持 | 执行页面 |
|------|----------|----------|
| 原创推文 | ✅ 支持 | Profile 页 |
| 回复评论 | ✅ 支持 | Replies 页 |
| 转推 / 点赞 | ❌ 暂不支持 | — |

#### 设置

| 开关 | 说明 |
|------|------|
| 显示排行榜 | 是否显示右侧浮动排行榜面板 |
| 显示书签数 | 在推文操作栏显示 bookmark count |
| Markdown 复制 | 在推文操作栏显示 MD 复制按钮 |
| 双击图片查看原图 | 双击推文图片以原图分辨率打开 |
| 媒体下载按钮 | 在推文操作栏显示下载按钮 |
| 保存下载记录 | 记录已下载的推文 ID，避免重复下载 |

- **媒体文件名模板**：支持变量 `{user-name}`、`{user-id}`、`{date-time}`、`{status-id}`、`{file-type}` 等

#### 关于
版本信息和使用说明。

## 评分算法

综合评分 (0-100) 由四个维度加权：

| 维度 | 权重 | 说明 |
|------|------|------|
| 流速 | 40% | views/hour，上限 50000/h |
| 互动率 | 25% | (likes + retweets + replies) / views，上限 10% |
| 转发比 | 20% | retweets / likes，上限 0.5 |
| 收藏比 | 15% | bookmarks / likes，上限 0.3 |

## 项目结构

```
x-tools/
├── manifest.json        # Chrome 扩展清单 (Manifest V3)
├── background.js        # Service Worker：处理 chrome.downloads
├── hook-main.js         # MAIN world：拦截 fetch/XHR 获取推文数据
├── content-script.js    # ISOLATED world：UI 渲染、Dashboard、排行榜、删除
├── styles.css           # 扩展样式
├── icons/               # 扩展图标
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 技术架构

- **Manifest V3** Chrome 扩展
- **MAIN world** 内容脚本：拦截 `fetch` 和 `XMLHttpRequest`，从 GraphQL API 响应中提取推文数据，通过 `postMessage` 传递给 ISOLATED world
- **ISOLATED world** 内容脚本：接收推文数据，渲染 UI 元素（徽章、排行榜、按钮），处理用户交互
- **Service Worker**：通过 `chrome.downloads` API 处理媒体文件下载
- **chrome.storage.sync**：跨设备同步用户设置

## License

MIT
