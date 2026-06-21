# 水印相机小程序 · 导入与发布指南

> 本项目是基于微信小程序原生框架实现的水印相机（外贸场景），**无需后端服务即可本地跑通**。以下步骤将指导你完成：导入开发者工具 → 本地调试 → 上传到微信公众平台 → 提交审核 → 线上发布。

---

## 一、环境准备

| 项目 | 说明 |
| --- | --- |
| 微信开发者工具 | 最新稳定版即可，下载地址：<https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html> |
| 微信小程序账号 | 前往 [微信公众平台 · 小程序](https://mp.weixin.qq.com/) 注册并完成主体认证（个人 / 企业 / 个体户均可） |
| AppID | 注册后在「开发管理 → 开发设置」里获取，用于替换 `project.config.json` 里的 `touristappid` |

> 注：如果你暂不准备上线，只是想在本地调试，可以直接选择**使用测试号**（在开发者工具里新建项目时选"测试号"），不用注册也能跑通。

---

## 二、导入到微信开发者工具

### 2.1 下载本项目代码

- 方式 A（Git）：在终端执行
  ```bash
  git clone <你的仓库地址> watermark-camera
  ```
- 方式 B（直接下载 ZIP）：在 GitHub/Gitee 仓库主页点击 "Download ZIP"，解压到任意目录。

### 2.2 替换 AppID

打开 `project.config.json`，将第 48 行：

```json
"appid": "touristappid"
```

改为你的小程序 AppID（形如 `wx1234567890abcdef`）。

> 如果你暂时没有 AppID，可以在导入项目时选择「测试号」模式并把该行保持为 `touristappid`，工具会自动分配一个测试号。

### 2.3 在开发者工具里导入项目

1. 打开 **微信开发者工具**，登录你的微信账号（该账号需有小程序的管理员/开发者权限）。
2. 点击「**+ 导入项目**」或「导入」。
3. 填写表单：
   - **项目目录**：选择你下载的 `watermark-camera` 目录（即 `app.json` 所在的目录）。
   - **AppID**：使用你自己的小程序 AppID；如果没有，选择「测试号」。
   - **项目名称**：`水印相机`（任意命名即可）。
   - **编译模式**：普通编译。
4. 点击「导入」。

导入后界面应当能正常显示首页（一个绿色横幅 + 模板选择卡片 + 拍照按钮）。

---

## 三、本地调试

### 3.1 首次编译

导入后，左侧「模拟器」即可预览。底部「真机调试」按钮可以在手机上预览，适合测试**相机**和**相册**权限。

### 3.2 常用调试按钮

- **编译**：修改代码后点击编译（或保存后自动编译）即可看到最新效果。
- **真机调试**：生成一个二维码，用手机微信扫码，进入真机调试模式。**相机能力必须在真机上测试**。
- **预览**：生成二维码，微信扫码即可在手机上体验小程序（无开发调试工具条）。

### 3.3 相机权限（真机测试必做）

本项目用到以下权限，请在真机测试并允许：

- `scope.camera`：拍照（在 `app.json` 中已声明）
- `scope.writePhotosAlbum`：将带水印的照片保存到相册（在 `app.json` 中已声明）

iOS 首次启动会弹授权请求，Android 同理，全部允许即可。

### 3.4 位置信息

本项目的模板提供了「位置」字段，调用的是 `wx.getLocation`，需在 `app.json` 的 `requiredPrivateInfos` 中声明（已配置）：

```json
"requiredPrivateInfos": ["chooseLocation", "getLocation"]
```

> 在真机上，发布版本需在微信公众平台「**接口设置**」里开通「**获取地理位置**」接口（按类目限制，工具类小程序一般可正常申请）。

---

## 四、发布上线

以下按「上传 → 版本管理 → 提交审核 → 审核通过 → 发布」顺序说明。

### 4.1 上传代码

在开发者工具中：

1. 右上角点击「**上传**」。
2. 填写「**版本号**」（例如 `1.0.0`）和「**项目备注**」（例如「初版发布 · 支持双语水印模板」）。
3. 点击「上传」，等待片刻即可在微信公众平台看到上传记录。

### 4.2 在公众平台提交审核

登录 [微信公众平台](https://mp.weixin.qq.com/)，进入你的小程序后台：

1. 「**版本管理**」 → 「**开发版本**」：找到刚刚上传的版本。
2. 点击「**提交审核**」。
3. 填写表单：
   - **功能页面**：建议填写以下两页，确保审核人员能看到主流程：
     - 路径：`pages/index/index`，标签：首页
     - 路径：`pages/camera/camera`，标签：拍照
   - **功能介绍**：水印相机 · 为产品/包装/装柜/唛头等场景生成带双语信息的水印照片。
   - **类目**：建议选「**工具**」下的「效率 / 图片处理」等（工具类免费，审核较快）。
   - **所在地区**：按实际填写。
   - **隐私说明**：建议在「设置 → 基本设置 → 服务内容声明 → 隐私保护指引」中补充你收集的信息（本项目仅使用相机/相册/位置，且**照片与位置仅存于用户本地**，不回传任何服务器，可如实说明）。
4. 提交后进入审核队列。

### 4.3 审核通过 → 发布

审核通过后：

1. 回到「**版本管理**」，找到该「**审核版本**」。
2. 点击「**发布**」，确认即可。
3. 约 10~30 分钟后，用户可在微信内搜索到你的小程序。

### 4.4 发布后的版本迭代

后续每一次更新只需再次「上传」 → 审核时选择「功能迭代 / Bug修复」并说明修改点，版本号按语义化规则填写即可（如 `1.0.1`）。

---

## 五、常见问题

**Q1：导入后报"app.json 文件中的 pages 字段不能为空"？**
A：说明项目目录选择错误，请选择 `app.json` 所在的那个目录（即 `watermark-camera/`）。

**Q2：模拟器点击"拍照"按钮没反应？**
A：模拟器无法调用真实相机；请点击「**真机调试**」或「**预览**」在真机上测试；也可以使用同页的「从相册选」来测试水印合成流程。

**Q3：水印合成后图片偏暗/偏白？**
A：已在 `utils/watermark.js` 设置深色半透明背景 + 文字描边，确保在不同亮度的照片背景上都可读；如仍希望调整，可在模板的 `style.background` 改颜色（如 `'rgba(0,0,0,0.80)'`）。

**Q4：审核不通过，提示"功能与描述不符"？**
A：本项目实际功能是拍照加水印，如实描述为「水印相机 · 为外贸场景提供带水印的拍照与记录」；同时确保上传版本中没有出现"上传 / 云同步"等与实际能力不符的表述，否则会触发虚假宣传审核。

**Q5：如何让多台手机之间的数据（照片）互通？**
A：目前使用本地存储（`wx.setStorageSync`），只存在**同一设备**。要实现多端同步，需接入**微信云开发**（免费额度足够小规模使用）。参考「七、扩展：接入云开发」。

---

## 六、隐私与合规（必做，否则审核可能不通过）

微信公众平台在「**设置 → 基本设置 → 隐私保护指引**」中要求你声明收集到的用户信息。

本项目用到且必须声明的能力：

| 能力 | 用途 | 是否上传到服务器 |
| --- | --- | --- |
| 相机 `scope.camera` | 拍照以叠加水印 | ❌ 不上传 |
| 相册 `scope.writePhotosAlbum` | 保存带水印的照片 | ❌ 不上传 |
| 位置 `scope.userLocation` | 填入水印里的"位置"字段 | ❌ 不上传 |

> 你可以直接在隐私保护指引中声明：**"本小程序仅调用相机、相册、定位权限，用于生成带水印的照片，相关照片与地理位置信息仅存储在用户本地，不上传到第三方或小程序后台服务器。"**

---

## 七、扩展：接入云开发（云端存储照片 / 共享数据）

> 作为可选能力。开启后，可以：
> - 把带水印的照片上传到**云存储**（容量：初始 5GB，超出部分按量付费）；
> - 把水印的文字字段（Modelo / Descripción 等）存入**云数据库**；
> - 在多台手机之间共享记录（云数据库按集合权限控制）；
> - 在云函数中调用**腾讯云 OCR / 百度 OCR** 识别水印文本是否可读。

### 7.1 开通云开发

1. 在开发者工具中点击顶部「**云开发**」图标。
2. 按提示开通一个云环境（免费版可用），记录环境 ID（形如 `prod-1gxxxxxx`）。

### 7.2 初始化云开发

在 `app.js` 的 `onLaunch` 中添加云开发初始化：

```js
App({
  onLaunch() {
    // 初始化云开发（替换为你的环境 ID）
    if (wx.cloud) {
      wx.cloud.init({
        env: '你的云开发环境ID',
        traceUser: true
      });
    }
    // 以下保持原有内容
    const sysInfo = wx.getSystemInfoSync();
    this.globalData.systemInfo = sysInfo;
    wx.setStorageSync('watermark_photos', wx.getStorageSync('watermark_photos') || []);
  },
  globalData: { systemInfo: null, userInfo: null }
});
```

### 7.3 照片上传到云存储

在 `pages/camera/camera.js` 的 `onSave` 中，将原本的本地存储替换为「先上传云存储再写入云数据库」。示例代码片段：

```js
// 替换原先 storage.add(record) 的逻辑
const uploadRes = await wx.cloud.uploadFile({
  cloudPath: 'watermark/' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.jpg',
  filePath: outPath // 本地临时文件路径
});
await wx.cloud.database().collection('watermark_photos').add({
  data: {
    templateId: this.data.template.id,
    templateName: this.data.template.name,
    values: this.data.values,
    fileID: uploadRes.fileID,
    originalFileID: null,
    width: this.canvas.width,
    height: this.canvas.height,
    createdAt: new Date(),
    ocr: null,
    verifyIssues: []
  }
});
```

### 7.4 云数据库权限设置

在云开发控制台 → 「数据库」→ 新建集合 `watermark_photos` → 将权限设置为：

- **仅创建者可读写**（推荐，保证用户数据隐私）；或
- **所有用户可读，仅创建者可写**（适合在团队内共享记录）。

### 7.5 OCR 识别（云函数版）

如果需要云函数识别水印内的文字（便于核验），可在 `cloudfunctions/` 下新建 `ocrRecognize` 云函数：

```js
// cloudfunctions/ocrRecognize/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { fileID } = event;
  // 1. 从云存储下载文件
  const res = await cloud.downloadFile({ fileID });
  // 2. 调用第三方 OCR（如腾讯云 OCR / 百度 OCR，需自行申请密钥）
  // 3. 返回识别结果
  return {
    success: true,
    text: '（由你选择的 OCR 服务商输出）',
    fields: {}
  };
};
```

上传并部署云函数后，在 `utils/ocr.js` 中 `wx.cloud.callFunction({ name: 'ocrRecognize', data: { fileID } })` 就能复用。

> 云函数涉及到第三方密钥，务必通过云函数「环境变量」管理，不要硬编码在仓库中。

---

## 八、目录结构速查

```
watermark-camera/
├── app.js              小程序全局入口
├── app.json            全局配置（页面路由、权限声明）
├── app.wxss            全局样式
├── project.config.json 开发者工具项目配置（AppID 在这里）
├── sitemap.json        搜索收录配置
├── pages/
│   ├── index/          首页：选模板 + 入口
│   ├── camera/         拍照页：相机 + 填写 + 合成
│   ├── list/           记录列表
│   └── detail/         记录详情（可编辑、保存到相册）
└── utils/
    ├── templates.js    水印模板定义（双语）
    ├── watermark.js    水印合成渲染逻辑
    ├── storage.js      本地存储封装
    └── ocr.js          OCR 核验调用（可选）
```

---

## 九、上线自检清单

- [ ] 把 `project.config.json` 的 `appid` 改为自己的 AppID。
- [ ] `app.json` 中的 `permission` 与 `requiredPrivateInfos` 已正确声明相机/位置权限。
- [ ] 微信公众平台已完成**隐私保护指引**声明并发布。
- [ ] 真机上测试过：① 拍照 → ② 生成水印 → ③ 保存到相册 → ④ 回到列表查看 → ⑤ 删除记录。
- [ ] 首页「我的记录」入口正常可进入。
- [ ] 未接入后端时，不要在介绍中出现「云同步 / 云端存储」等表述。

祝发布顺利！如在导入 / 上传过程中遇到具体错误，可将开发者工具 Console 的报错信息复制到搜索引擎，基本都有现成解决方案。
