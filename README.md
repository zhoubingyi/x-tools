# X Tools

一个 Tampermonkey 油猴脚本，为 X (Twitter) 提供实时流速徽章、热帖排行榜、媒体下载、书签数和 Markdown 复制功能。

## 功能

- **流速徽章**：在推文头部显示 views/hour，颜色分级（ 普通 / 🚀 热门 /  爆帖）
- **爆帖评分**：悬浮徽章查看浏览、互动、收藏和 0-100 分综合评分
- **流速排行榜**：右侧浮动面板，可拖拽、缩放宽度/高度，按当前页面可见推文流速排序
- **Dashboard 面板**：点击右上角 XT 按钮打开，实时展示流速排行（点击可跳转到推文）
- **书签数显示**：在推文操作栏补充 bookmark count
- **仅看热帖**：按每小时浏览量或总浏览量隐藏低热度推文
- **Markdown 复制**：在推文操作栏添加 MD 复制按钮
- **图片查看**：双击 X 图片打开原图预览
- **媒体下载**：一键下载推文中的图片和视频
- **批量删除推文**：在 Dashboard「删除」标签页中，手动批量删除自己的推文和回复（支持原创推文和 Replies）

## 安装

### 前提条件

安装浏览器扩展 **Tampermonkey**（[Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) / [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd) / [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/)）或 **Violentmonkey**。

### 安装脚本

1. 打开 Tampermonkey 管理面板
2. 点击「实用工具」→「从 URL 安装」
3. 粘贴以下地址：

```
https://raw.githubusercontent.com/zhoubingyi/x-tools/main/x-tools.user.js
```

4. 点击「安装」

或者直接点击：[安装 X Tools](https://raw.githubusercontent.com/zhoubingyi/x-tools/main/x-tools.user.js)

## 自动更新

Tampermonkey 默认每 24 小时检查一次脚本更新（可在 Tampermonkey 设置中修改检查间隔）。当本仓库 `main` 分支的 `@version` 发生变化时，Tampermonkey 会自动下载并安装新版本，无需手动操作。

如需立即检查更新：Tampermonkey 管理面板 →「已安装脚本」→ 找到 X Tools → 点击右侧「检查更新」按钮。

## 设置

点击右上角的 **XT** 按钮打开 Dashboard 面板，包含四个标签页：

### 排行榜

- 实时显示当前页面所有可见推文的流速排行
- 点击排行项可跳转到对应推文（自动关闭面板并高亮目标推文）
- 显示条数：控制浮动面板排行榜的显示数量
- 阈值说明：🌱 < trending < 🚀 < viral < 🔥

### 删除

批量删除自己的推文和回复（不可恢复，请谨慎操作）：

1. 进入自己的 Profile 页面或 Replies 页面
2. 打开 Dashboard → 「删除」标签页
3. 确认用户名识别正确后，点击「开始删除」
4. 脚本会逐条打开推文菜单 → 删除 → 确认，自动滚动加载更多内容
5. 随时可点击「停止」中断

| 类型 | 是否支持 | 执行页面 |
|------|----------|----------|
| 原创推文 | 支持 | Profile 页 |
| 回复评论 | 支持 | Replies 页 |
| 转推 / 点赞 | 暂不支持 | — |

### 设置

| 开关 | 说明 |
|------|------|
| 显示排行榜 | 是否显示右侧浮动排行榜面板 |
| 显示书签数 | 在推文操作栏显示 bookmark count |
| Markdown 复制 | 在推文操作栏显示 MD 复制按钮 |
| 双击图片查看原图 | 双击推文图片以原图分辨率打开 |
| 媒体下载按钮 | 在推文操作栏显示下载按钮 |
| 保存下载记录 | 记录已下载的推文 ID，避免重复下载 |

- **媒体文件名模板**：支持变量 `{user-name}`、`{user-id}`、`{date-time}`、`{status-id}`、`{file-type}` 等

### 关于

版本信息和使用说明。

## 评分算法

综合评分 (0-100) 由四个维度加权：

| 维度 | 权重 | 说明 |
|------|------|------|
| 流速 | 40% | views/hour，上限 50000/h |
| 互动率 | 25% | (likes + retweets + replies) / views，上限 10% |
| 转发比 | 20% | retweets / likes，上限 0.5 |
| 收藏比 | 15% | bookmarks / likes，上限 0.3 |

## 开发

直接编辑 `x-tools.user.js`，提交后推送到 `main` 分支即可。

```bash
git add x-tools.user.js
git commit -m "update"
git push
```

Tampermonkey 用户会在下次自动更新时获取到最新版本。

## License

MIT
