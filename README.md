# 水印相机小程序（外贸版）

基于微信小程序原生框架实现的**水印相机**，为外贸场景设计：拍商品 / 包装 / 装柜照片时，可以一键添加**双语（西语 + 中文）手写风格水印**，并把数据字段与水印照片**关联保存**。

- 无需后端即可本地跑通（使用 `wx.setStorageSync` 做本地记录）
- 可选接入**微信云开发**（云存储 + 云数据库 + 云函数 OCR），实现多端同步
- 支持 iPhone / Android 真机，已通过真机调试验证

## 功能亮点

- 模板可选：手写·双语 / 手写·精简（可在 `utils/templates.js` 自行扩展）
- 字段独立成行、可留空；西语描述 / 中文描述支持多行、自动换行
- 水印照片长边最大 4096px（Android 降级 2048，iOS 降级 3072），印刷级清晰度
- 自动关联入库（模板 ID + 全部字段 + 图片路径）
- 可一键保存到系统相册
- 可随时编辑 / 删除记录

## 快速开始

- **仅测试 / 不发布**：看 **[测试手册（TESTING.md）](./TESTING.md)** — 覆盖测试号 / 真机预览 / 体验成员 / 体验版四种方案
- **要正式发布到微信小程序**：看 **[导入与发布指南（DEPLOY.md）](./DEPLOY.md)**

简要步骤：

```bash
# 1. 下载本代码（或直接在开发者工具里导入目录）
git clone <你的仓库地址> watermark-camera

# 2. 把 project.config.json 中的 appid 替换为你的小程序 AppID

# 3. 打开「微信开发者工具」→ 导入项目 → 选择 watermark-camera 目录

# 4. 真机调试：扫码在手机上测试拍照 / 相册权限

# 5. 上传 → 在微信公众平台提交审核 → 审核通过后发布
```

## 目录结构

```
watermark-camera/
├── app.js / app.json / app.wxss        小程序全局入口与配置
├── project.config.json                 项目配置（含 AppID）
├── pages/
│   ├── index/                          首页：模板选择 + 入口
│   ├── camera/                         拍照页：相机 + 填写 + 合成
│   ├── list/                           记录列表
│   └── detail/                         记录详情（编辑 / 保存到相册 / 删除）
└── utils/
    ├── templates.js                    水印模板定义（字段 + 样式）
    ├── watermark.js                    Canvas 2D 水印合成
    ├── storage.js                      本地记录存储
    └── ocr.js                          OCR 核验（可选，依赖云函数）
```

## 自定义与扩展

### 新增一个水印模板

编辑 `utils/templates.js`，在 `TEMPLATES` 数组中追加一个对象即可。字段用 `type: 'textarea'` 表示多行输入，其他可用：`text / number / select / datetime / location`。

### 修改水印颜色 / 字号 / 位置

在模板对象中调整 `style`：

```js
style: {
  fontSize: 26,
  color: '#ffffff',
  background: 'rgba(0,0,0,0.72)',
  padding: 22,
  borderRadius: 12,
  lineHeight: 1.75
},
position: 'bottom-left'  // top-left / top-right / bottom-right / top-center / bottom-center
```

### 接入云开发（云端存储照片 + 多人共享）

详细步骤见 **[DEPLOY.md · 扩展：接入云开发](./DEPLOY.md#七扩展接入云开发云端存储照片--共享数据)**。

## License

MIT
