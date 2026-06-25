# 外贸水印相机 · 产品手册

> 版本：v1.0 · 最后更新：2026-06-25
> 适用对象：产品 / 设计 / 开发 / 测试
> 维护规则：每次功能更新需同步修订本文档对应章节，并在「变更记录」追加一行。

---

## 一、产品定位

面向**外贸从业者**（尤其跨境电商、出口采购）的微信小程序，用于在拍摄商品 / 包装 / 装箱现场照片时，实时叠加**中西双语手写风格水印**，并把水印照片与结构化字段（货号、描述、单价、装箱数、件数、体积等）关联入库，支持按文件夹组织、批量导出 Excel。

**核心价值**

- 用一张照片同时承载「视觉证据 + 数据凭证」，免去事后整理。
- 中西双语并行，方便对接西语客户。
- 字段可编辑、可翻译、可导出，打通「拍照 → 归档 → 报价单」链路。

---

## 二、功能总览

| 模块 | 入口 | 核心能力 |
|---|---|---|
| 首页 | `pages/index` | 模板选择、记录总数、进入拍照 / 列表 / 模板管理 |
| 拍照 | `pages/camera` | 实时取景 + 水印浮层预览 + 拖拽缩放 + 字段行内编辑 + 拍照合成入库 |
| 记录列表 | `pages/list` | 文件夹管理、左滑操作、右滑批量、导出模式 |
| 详情 | `pages/detail` | 查看大图、字段编辑、水印重渲、保存相册、删除 |
| 模板管理 | `pages/template` | 自定义模板 CRUD（内置模板只读） |
| 翻译词典 | `pages/dict` | 自定义词典、白名单、内置词典、LLM 翻译引擎配置 |

**导航方式**：无 tabBar，全部通过页面内按钮 `navigateTo` / `redirectTo` 跳转。

---

## 三、水印模板

### 3.1 内置模板

| id | 名称 | 位置 | 字段 |
|---|---|---|---|
| `minimal` | 极简模板 | bottom-center | modelo, precio, desEs, pzs, volumen, cajas（6 字段） |
| `handwriteSimple` | 手写·精简 | bottom-right | modelo, desEs, precio, pzs, cajas, volumen（6 字段） |
| `handwrite` | 手写·双语 | bottom-right | modelo, desEs, desZh, precio, pzs, cajas, volumen, peso, nota, fecha（10 字段） |

**默认选中**：`minimal`（在 `pages/index/index.js` 和 `pages/camera/camera.js` 中设定）。

### 3.2 字段类型

`text` / `textarea`（多行）/ `number` / `datetime` / `date` / `time` / `select`（带选项）/ `location`

### 3.3 样式默认值

- 字号 `fontSize`：22–24
- 文字色 `color`：`#fff`
- 背景色 `background`：`rgba(0,0,0,0.70)`
- 内边距 `padding`：14
- 圆角 `borderRadius`：10
- 行高 `lineHeight`：1.35
- 宽度比 `widthRatio`：0.42
- 透明度 `opacity`：0.72

### 3.4 自定义模板

- 入口：首页「管理模板」→ 模板管理页右上角「+」。
- ID 生成规则：`custom_${timestamp}`。
- 字段 key 自动生成：标签转小写、去特殊字符、≤20 字符。
- 校验：名称必填、至少 1 个字段、所有字段标签非空。
- 存储 Key：`watermark_custom_tpls`。
- 内置模板不可编辑、不可删除。

---

## 四、拍照流程

### 4.1 拍照前

1. 首页选择水印模板（默认 `minimal`）。
2. 点击「开始拍照」进入拍照页。

### 4.2 取景与水印预览

- 取景框：后摄、自动闪光、high 分辨率。
- 水印浮层实时叠加在取景框上，可交互：
  - **拖拽**：单指拖动水印块，边界限制在画面内。
  - **缩放**：双指捏合，scale 0.5–2.0。
  - **字段编辑**：点击任意字段行内编辑，输入框 `onFieldTap` → `onEditInput` → `onEditConfirm`。
  - **位置预设**：9 宫格位置选择面板（左上 / 上中 / 右上 / 左中 / 正中 / 右中 / 左下 / 下中 / 右下）。
  - **模板切换**：底部「模板」按钮弹出选择器。

### 4.3 拍照合成

- 点击拍照按钮 → 闪光动画（300ms）→ `ctx.takePhoto({quality:'high'})`。
- 必填校验：`validate()` 校验必填字段。
- 获取照片宽高 `_getPhotoInfo`（失败重试 1 次，最终回退 3024×4032）。
- 渲染水印到临时文件 `watermark.renderWatermarkedImage`。
- 持久化原图 `_persistOriginalPhoto`（`saveFile` 优先，失败回退 `copyFile`）。
- 构造 record 入库 `storage.add`。
- `wx.redirectTo` 跳详情页（避免返回键回到拍照页）。

### 4.4 相册选图

- 底部「相册」按钮 → `chooseMedia` + `getImageInfo` → 同样走水印渲染入库流程。

### 4.5 水印渲染规格

- 离屏 Canvas 2D。
- 长边最大 **4096px**（Android 降级 2048，iOS 降级 3072）。
- 输出 jpg quality 0.98。
- 定位算法：`ratio = cw / 750`，9 宫格 + `customX/customY` 优先。

---

## 五、记录管理

### 5.1 文件夹

- 上限 `MAX_FOLDERS = 30`。
- 存储 Key：`watermark_folders`，结构 `{ id, name, createdAt, updatedAt? }`。
- 文件夹 ID 格式：`f_{timestamp}_{random6}`。
- Tab：全部(N) / 未分类(N) / 自定义文件夹 + 「+」。
- 长按文件夹：ActionSheet 重命名 / 删除。
- 删除文件夹：二选一——「一起删除记录」或「移入未分类」。

### 5.2 记录卡片手势

- **左滑**：展开 4 个操作按钮——重命名 ✎ / 移动 📁 / 复制 ⧉ / 删除 🗑。
  - 滑动超过一半（`SWIPE_ACTION_WIDTH/2 = 140px`）则展开，否则收起。
  - 点击已展开卡片时收起（不进详情）。
- **右滑**：进入批量选中态（渐进式，不替换顶部栏）。
  - 左滑展开状态下右滑 → 先收起回原位，不触发选中。
  - 原位右滑 → 切换该记录选中态。
  - 选中数归 0 自动退出批量模式。

### 5.3 批量模式

- 顶部栏渐进变化：保留导出 / 新增，标题变 ✕已选 X 条 + 全选链接，左侧加红色删除按钮。
- 点击记录切换选中。
- 右滑可继续选中其他记录。
- 批量删除：二次确认弹层。
- 退出方式：✕按钮 / 选中数归 0 自动退出。

### 5.4 导出模式

- 文件夹 Tab 变为多选，可跨文件夹多选并集去重。
- 选中文件夹时自动勾选其下所有记录。
- `_getExportModeRecords` 汇总选中文件夹的并集（去重）。
- 顶部：全选 / 取消 + 已选 N 条 + 确认导出 + 取消。
- 导出 → 文件名弹层 → `exporter.exportToExcel` → 退出导出模式。

### 5.5 记录操作

| 操作 | 说明 |
|---|---|
| 重命名 | 自定义名称 `customName`，留空恢复默认（模板名） |
| 移动 | 选择目标文件夹，可移到「未分类」 |
| 复制 | 复制图片文件 + 新建 record；`copyFile` 失败时降级用原路径 |
| 删除 | Modal 确认；只删数据库记录，不删相册文件 |
| 批量删除 | 二次确认弹层 |
| 清空 | 「清空本地记录」按钮，只删数据库，不动相册 |

### 5.6 记录数据结构

```
{
  id, templateId, templateName, customName(nullable), folderId(nullable),
  values{...},                    // 模板字段值
  imagePath, originalPath,        // 带水印图 / 原图
  width, height,
  createdAt,
  watermarkPosition,             // 9宫格位置字符串
  watermarkScale, watermarkOpacity, watermarkWidthRatio,
  watermarkX, watermarkY,         // 编辑保存后才有（原图坐标）
  ocr(null),                      // OCR 结果，目前未启用
  verifyIssues([])                // 核验问题，目前空数组
}
```

存储 Key：`watermark_photos`，ID 格式 `p_{timestamp}_{random6}`。

---

## 六、详情页

### 6.1 查看模式

- 图片 `aspectFit` 显示，点击全屏预览。
- 右上角浮层菜单 ⋮ → 删除记录。
- 字段卡片：只读展示所有字段，空值显示「—」。
- 识别与核验卡片：`ocrResult` / `verifyIssues`（目前 mock，显示「未进行 OCR 核验」；需部署腾讯云 / 百度 OCR 云函数才能启用）。
- 保存到相册 `onSaveAlbum`（`saveImageToPhotosAlbum`）。
- 分享 `onShareAppMessage`（标题带模板名）。

### 6.2 编辑模式

- 切到原图 `originalPath`（避免看到两层水印）。
- 显示可拖拽水印层 `#wmLayer`：
  - 单指拖拽 + 双指缩放（scale 0.5–1.5）。
  - `_getDragBounds` 按 aspectFit 实际显示区精确限制边界（留黑补偿）。
  - `_measureWmHeight` 用 `createSelectorQuery` 测量水印层真实高度。
- 三组滑块：缩放 / 透明度 / 宽度。
- 字段实时编辑 `onFieldInput`（同步刷新 `displayFields` 预览）。
- 保存：`display 坐标 → 原图坐标`换算 → `_rerenderWatermark` 重渲 → `storage.update`。

---

## 七、导出 Excel

### 7.1 列结构（9 列，顺序固定）

| key | header | 说明 |
|---|---|---|
| imagePath | FOTO | 图片列（VML + img 双写，base64 内嵌） |
| modelo | CODIGO | 货号 |
| desEs | DETALLADOS | 西语描述 |
| desZh | 描述 | 中文描述 |
| precio | PRECIO | 单价 |
| pzs | CANTIDAD DE CAJA | 每箱件数 |
| cajas | CUANTAS CAJAS | 件数 |
| volumen | CUBICO | 体积 |
| peso | PESO | 重量 |

### 7.2 自动翻译

导出前自动检测 desEs / desZh 缺哪列：
- desEs 有值、desZh 空 → 译为中文填第 4 列。
- desZh 有值、desEs 空 → 译为西语填第 3 列。
- 调 `translator.translate(..., true)` 带 debug，console.log 输出诊断。

### 7.3 导出格式

- 伪 `.xls`（实为 HTML + VML），`wx.getFileSystemManager().writeFile` 写到 `USER_DATA_PATH`。
- `wx.openDocument` 打开，失败回退 `wx.shareFileMessage` 分享。
- 列宽自适应（中文字符约 9px，最小 60px，FOTO 列固定 220px）。
- 行高按图片宽高比自适应。
- 表头蓝底白字 `#4472C4`，单元格文本格式防科学计数。

### 7.4 文件名

- `sanitizeFileName`：移除 `/\:*?"<>|`、空白转下划线、截断 50 字符。
- 预填文件夹名或「水印照片导出」。

---

## 八、翻译引擎

### 8.1 架构

```
导出 / 测试翻译
  ↓
检查 desEs/desZh 哪个空
  ↓
translator.translate()
  ↓
① splitText 切分 ② 本地词典先长后短匹配 ③ 白名单跳过
  ↓
未命中段调用 LLM API（OpenAI 兼容）
  ↓
API 失败 → 降级用本地结果
  ↓
回填空列后生成 Excel
```

### 8.2 本地词典

- 内置词典 `BUILTIN_DICT`：约 130 条中西对照，覆盖外贸常用词。
- 自定义词典 `watermark_custom_dict`：用户维护 `[{zh, es}]`。
- 索引 `buildIndex`：按源词长度降序排序，先长后短匹配（避免 `luz` 抢匹配 `con luz`）。
- 匹配策略：先整段精确匹配，再模糊匹配（文本中包含词典词则替换）。

### 8.3 白名单

- **白名单内的词不参与翻译，原样保留。**
- 内置白名单 `WHITELIST`：约 35 项（单位 m³/kg/pzs/ctn/cajas、货币 ¥/$/€/rmb/usd、规格 RGB/LED/USB/W/V/Hz、标点 ×·-/+）。
- 自动识别：纯数字、数字+单位（50kg/0.125m³/48pzs）、货币+数字。
- 自定义白名单 `watermark_custom_whitelist`：用户维护 `string[]`。
- 合并：`getMergedWhitelist()` = 内置 + 用户自定义，大小写不敏感。

### 8.4 LLM 翻译引擎

支持的 7 家 provider（OpenAI 兼容协议）：

| provider | Base URL | 默认 Model |
|---|---|---|
| DeepSeek | api.deepseek.com/v1 | deepseek-v4-flash |
| 智谱GLM | open.bigmodel.cn/api/paas/v4 | glm-4-flash |
| 通义千问 | dashscope.aliyuncs.com/compatible-mode/v1 | qwen-turbo |
| 阿里百炼 | dashscope.aliyuncs.com/compatible-mode/v1 | qwen-plus |
| MiniMax | api.minimaxi.com/v1 | MiniMax-M3 |
| 小米MiMo | api.xiaomimimo.com/v1 | mimo-v2.5-pro |
| 自定义 | 空 | 空 |

**配置存储**：按 provider 独立存储 `baseURL` / `model` / `apiKey`：
- `watermark_translator_config`：`{ provider }`（当前选中）。
- `watermark_translator_profiles`：`{ [provider]: {baseURL, model, apiKey} }`。
- 切换 provider 自动加载对应配置，互不覆盖。
- 输入时实时存储（边输入边保存）。
- 切页面回来仍记住最后选中的 provider。

**调用参数**：temperature 0.3，max_tokens 1024，超时 30s。翻译时调 API 是**整段原文**（而非只翻译未命中段），API 结果优先于本地拼装结果。

### 8.5 Prompt

- 默认模板 `DEFAULT_PROMPT_TEMPLATE`，4 个占位符：`{source}` `{target}` `{whitelist}` `{text}`。
- 不假定方向（既可能中→西，也可能西→中）。
- 规则：数字 / 货号 / 通用符号保持不变；白名单词保持原文；直接返回结果不加引号。
- 自定义 prompt 优先（`watermark_translator_prompt`），录入一次永久生效。
- 实时预览：用 `con luz y música` 示例展示当前 prompt 实际效果。
- 「恢复默认」按钮可清空自定义回退到默认模板。

### 8.6 翻译诊断

`translate(text, from, to, withDebug)` 第 4 个参数 `withDebug=true` 返回 `{result, debug}`：

| debug.source | 含义 |
|---|---|
| `api` | ✅ 走了 API（含 provider 和耗时） |
| `local_all` | ⚠ 全部本地命中，未调 API |
| `local_no_api` | ⚠ 未配置 API，仅本地翻译 |
| `local_api_fail` | ❌ API 调用失败降级本地（含原因） |

还附带 `missSegments`（未命中本地词库的词列表）和 `reason`（失败原因）。导出时也会在 console 输出每行的翻译诊断日志。

---

## 九、暗黑模式

- 机制：`@media (prefers-color-scheme: dark)`，页面级 WXSS 优先级高于全局 app.wxss。
- 覆盖页面：index / list / detail / template / dict。
- **camera 页未做暗黑适配**（取景框本身深色，影响较小，暂不处理）。
- 暗色主色调：`rgb(0, 105, 12)`（深绿），呼应亮色 `#07c160`。
- template 页导航栏固定绿色 `#07c160`。

---

## 十、数据存储

所有 `wx.setStorageSync` Key：

| Key | 模块 | 内容 |
|---|---|---|
| `watermark_photos` | storage.js | 照片记录数组 |
| `watermark_folders` | storage.js | 文件夹数组 |
| `watermark_custom_tpls` | storage.js / templates.js | 自定义模板数组 |
| `watermark_custom_dict` | translator.js | 用户词典 `[{zh, es}]` |
| `watermark_custom_whitelist` | translator.js | 用户白名单 `string[]` |
| `watermark_translator_config` | translator.js | `{ provider }` 当前选中 |
| `watermark_translator_profiles` | translator.js | `{ [provider]: {baseURL, model, apiKey} }` |
| `watermark_translator_apikeys` | translator.js | 旧版（仅迁移用） |
| `watermark_translator_prompt` | translator.js | 自定义 prompt |

`app.js` 的 `onLaunch` 初始化 `watermark_photos` 和 `watermark_folders`（非数组则置空数组）。

**数据安全提示**：所有数据存小程序本地存储，清理小程序会丢失。带水印照片和原图通过 `saveFile`/`copyFile` 持久化到 `USER_DATA_PATH`。

---

## 十一、权限声明

| scope | 用途 |
|---|---|
| `scope.camera` | 拍摄照片 |
| `scope.writePhotosAlbum` | 保存带水印的照片到相册 |

`requiredPrivateInfos`：`chooseLocation`、`getLocation`（用于 location 类型字段）。

---

## 十二、已知限制

1. **OCR 核验未启用**：详情页「识别与核验」卡片始终显示 mock 提示，需部署腾讯云 / 百度 OCR 云函数才能启用。
2. **导出是伪 .xls**：实为 HTML + VML，依赖 Excel/WPS 兼容性打开，移动端可能只能通过 `shareFileMessage` 分享。
3. **复制记录可能共享图片文件**：`copyFile` 失败时降级用原路径，多记录共享同一图片文件（删除其一不影响另一条，因 `storage.remove` 只删记录不删文件）。
4. **本地存储会随清理小程序丢失**：建议重要照片另存相册。
5. **provider 预设 model 名需自行核对**：如 `deepseek-v4-flash` / `MiniMax-M3` / `mimo-v2.5-pro` / `glm-4-flash`，以各平台最新文档为准。
6. **真机调用 LLM 需配置 request 合法域名**：在小程序后台「开发设置」→「服务器域名」添加对应 API 域名，否则会被拦截。

---

## 十三、变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-06-25 | v1.0 | 首版产品手册 |
