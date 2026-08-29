# 水印相机（iOS 本地版）安装手册

本文档说明如何把本工程（iOS 原生 SwiftUI 应用）构建并安装到 iPhone 上，**不经过 App Store**。

> 适用：摄影师 / 外贸业务员在手机上用「水印相机」拍照、加双语水印、导出 Excel。
> 数据全部保存在手机本机（`App 沙盒/Documents/WatermarkCamera`），不受微信小程序 200MB 配额限制。

---

## 1. 前置条件

| 项目 | 要求 |
|---|---|
| 电脑 | 一台 Mac（Apple Silicon 或 Intel 均可） |
| 系统 | macOS 12+（推荐 14+） |
| 开发工具 | Xcode 15+（App Store 免费下载） |
| 命令行工具 | Homebrew + XcodeGen（见下文） |
| 手机 | iPhone（iOS 17+），随附数据线（或同一 Wi-Fi 用无线调试） |
| 账号 | 一个 Apple ID（免费即可侧载，见第 4 节说明） |

### 1.1 安装 XcodeGen

Xcode 工程文件（`.xcodeproj`）由 `project.yml` 自动生成，避免手工维护工程配置：

```bash
brew install xcodegen
```

### 1.2 生成工程

```bash
cd iOS
xcodegen generate
```

成功后目录下会出现 `WatermarkCamera.xcodeproj`。

---

## 2. 方案总览：三种安装方式

| 方式 | 成本 | 有效期 | 适合场景 |
|---|---|---|---|
| A. 免费 Apple ID 侧载（Xcode 直传） | 免费 | 7 天，到期需重装 | 先在内网/办公室把功能用起来 |
| B. Apple 开发者账号（¥688/年） | 付费 | 1 年，可同时装 TestFlight 真机测试 | 长期使用、多台手机分发 |
| C. 截面方式（AltStore/Sideloadly 等） | 免费/低 | 7 天或按工具续签 | 不想装 Xcode 的电脑用户 |

本手册先讲 **方式 A（最简路径）**，再给 方式 B 的 TestFlight/描述文件要点 与 方式 C 的替代工具。

---

## 3. 快速开始（免费 Apple ID，方式 A）

### 3.1 首次：生成工程并在 Xcode 中配置签名

1. 打开终端，执行第 1.2 节的 `xcodegen generate`。
2. `open WatermarkCamera.xcodeproj` 用 Xcode 打开工程。
3. 配置签名（"选中工程"指的是 Xcode 左侧**文件导航区最顶部的蓝色工程图标 `WatermarkCamera`**，点击它之后，中间编辑区顶部会切换为工程设置页）：
   - 点击左侧导航区顶部的蓝色 `WatermarkCamera` 工程图标；
   - 中间编辑区会出现两级列表：左侧一栏是 **PROJECT / TARGETS**，右侧一栏是各目标；
   - 先点左栏的 **TARGETS → WatermarkCamera**（注意：不是 PROJECT，PROJECT 里没有 Signing & Capabilities 签名页）；
   - 顶部标签页选择 **Signing & Capabilities**：
     - 勾选 **Automatically manage signing**；
     - Team 下拉框选择 **Add an Account…** → 登录你的 Apple ID；
     - 添加后选择你的 Apple ID 个人团队（显示 "Personal Team"）。
   - Bundle Identifier 保持 `com.watermark.camera`（或改成你自己的，须唯一）。
4. 若 Xcode 提示 "No profiles for ... were found"，点 **Try Again** 即可自动生成。

> 注意：免费账号会弹出 "This will sign your app for development..." 提醒，直接允许。
> Bundle ID 必须是**全新未使用过**的（免费账号同一设备同一 ID 无法覆盖旧签名 App）。

### 3.2 连接手机并运行

1. 用数据线连接 iPhone 到 Mac。
2. iPhone 上会弹出 **"信任此电脑？"** → 点击**信任**，输入锁屏密码。
3. Xcode 顶部设备选择器选择你的 iPhone（切换为 "iPhone" 而不是 "Any iOS Device"）。
4. 按 **⌘R** 运行。

### 3.3 在 iPhone 上信任开发者

首次安装到手机后，主屏幕会出现「水印相机」图标，点击会提示"未受信任的开发者"：

> 设置 → 通用 → VPN 与设备管理 → **开发者 App** → 点击你的 Apple ID → **信任**

之后即可正常打开使用。相机 / 相册权限在首次使用时按系统弹窗授权即可（对应文案已写入 Info.plist）。

### 3.4 无线安装（可选）

无需数据线：

1. Xcode → Window → Devices and Simulators → 勾选你的 iPhone 的 **Connect via network**。
2. 拔线后保持同一 Wi-Fi，Xcode 仍然可以部署调试。

### 3.5 远程分发：把安装包发给异地手机安装

以上方式 A（免费 Apple ID 直传）要求**手机连着你的 Mac**，无法远程分发。若对方手机不在你身边，按有无付费开发者账号选择以下方案：

#### 方案一：TestFlight（推荐，需 ¥688/年 开发者账号）

最正规的远程分发渠道，对方**无需电脑、无需数据线、无需 UDID**：

1. 按第 5 节构建并上传 IPA 到 App Store Connect；
2. 在 App Store Connect → 你的 App → **TestFlight** 页，等构建处理完成（约几分钟）；
3. 添加测试员：输入对方邮箱（内部测试最多 100 人，立即生效；外部测试需简单审核，最多 10000 人）；
4. 对方手机安装 **TestFlight** App（App Store 免费）→ 打开邮件邀请链接 → 点安装，即完成。

- 有效期 90 天，重新上传新构建即可续期；
- 数据仍在手机本机，与签名方式无关。

#### 方案二：Ad Hoc + 安装链接（需开发者账号，登记对方 UDID）

适合不想走 TestFlight 审核的内部小范围分发（最多 100 台/年）：

1. 让对方获取 **UDID**：用 Safari 打开 `https://get.udid.io` 按提示安装描述文件，复制 UDID 发给你（或让对方 Mac/PC 连 iTunes 查看）；
2. 开发者后台 developer.apple.com → Devices → 注册该 UDID；
3. Xcode 打包时选择 **Ad Hoc** 分发方式导出 `.ipa`；
4. 上传 `.ipa` 到内测分发平台（如 **Diawi**：`diawi.com`，免费拖拽上传），把生成的**安装链接**发给对方；
5. 对方 Safari 打开链接 → 点 Install → 下载后到 设置→通用→VPN与设备管理 信任企业描述文件即可。

- 有效期 1 年（付费证书周期）；
- 也可直接把 `.ipa` 文件发给对方，用下方方案三安装。

#### 方案三：把 IPA 发给对方自行侧载（零成本，双方免费 Apple ID 均可）

无开发者账号时的唯一远程途径——**每个接收者用自己的免费 Apple ID 自签**：

1. 你在本机 Xcode 用 Personal Team 签名后：`Product → Archive → Distribute App → Development` 导出 `.ipa`（或将工程源码直接发给对方）；
2. 对方在自己电脑安装 **Sideloadly**（sideloadly.io，支持 Windows/macOS）或 **AltStore**（altstore.io）；
3. 拖入 `.ipa`，输入**对方自己的** Apple ID 与密码 → 连接其手机安装；
4. 对方手机上 信任开发者（同 3.3 节路径）。

- 有效期 7 天，到期由对方在自己电脑上重装/续签（AltStore 可自动续签）；
- 免费账号每台设备最多 3 个自签 App、每账号最多 10 台设备。

#### 远程分发对比

| 方案 | 费用 | 对方需要 | 有效期 | 人数 |
|---|---|---|---|---|
| TestFlight | ¥688/年 | 仅手机装 TestFlight | 90 天/构建 | 100 内测 + 10000 外测 |
| Ad Hoc + Diawi | ¥688/年 | 提供 UDID + 手机点链接 | 1 年 | 100 台/年 |
| IPA 自行侧载 | 免费 | 电脑 + 自己的 Apple ID | 7 天 | 不限 |

> 无论哪种分发方式，App 内照片与 Excel 都保存在接收者手机本机，功能完全一致。

---

## 4. 免费签名的限制（重要）

- **有效期 7 天**：免费 Apple ID 签名的 App 每 7 天过期，过期后需重新用电脑连接 Xcode 点一次运行（或重新安装）。
- 建议：把常用机型的签名流程写成一条命令定期执行，或直接用第 5 节的付费方案。
- 如不打算长期依赖电脑，再考虑 方式 C（AltStore 等可续签工具）。

---

## 5. 付费账号（方式 B）：TestFlight 分发给多人

有 Apple 开发者账号（¥688/年）时，最省事的是 TestFlight（真机 / 外部测试者最多 90 天无需续签，分发不限设备数）：

```bash
cd iOS
xcodegen generate

# 构建归档（命令行方式，需要先配置好签名 Team；也可直接在 Xcode 里 Product → Archive）
xcodebuild -project WatermarkCamera.xcodeproj \
           -scheme WatermarkCamera \
           -destination 'generic/platform=iOS' \
           -archivePath build/WatermarkCamera.xcarchive \
           -allowProvisioningUpdates \
           archive

xcodebuild -exportArchive \
           -archivePath build/WatermarkCamera.xcarchive \
           -exportOptionsPlist ExportOptions.plist \
           -exportPath build/export
```

`ExportOptions.plist` 内容（TestFlight 用 `app-store`；内部设备直接装用 `ad-hoc`）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store</string>
    <key>uploadSymbols</key>
    <false/>
</dict>
</plist>
```

然后把 IPA 上传到 App Store Connect → TestFlight，添加测试员即可直接通过「TestFlight」App 安装，**无需 UDID、无需数据线**。

---

## 6. 替代工具（方式 C）：AltStore / Sideloadly

不想开 Xcode 的电脑：
- **Sideloadly**（Windows/macOS）：拖入 `.ipa` 输入免费 Apple ID 即可装到手机，同样 7 天过期；
- **AltStore**：装一次后在手机上点“刷新”即可自动续签（前提：电脑开着且装有配套服务），适合长期免电脑签名使用。

打包自用 IPA（无需 App Store）：在 Xcode 里用 **Personal Team** 签名后选择 `Product → Archive → Distribute App → Development`，导出 Development 版 `.ipa` 即可。

> 提示：签名有效性（7 天/1 年）取决于证书，与“App 本身功能”无关；无论哪种方式，App 内照片与 Excel 一直保存在手机本机，不受影响。

---

## 7. 功能与数据说明

- **拍照水印**：AVFoundation 实时预览 + 双层水印浮层（拖动定位、双指缩放），套用模板字段。
- **编辑**：已拍照片可重新编辑水印、修改详情字段；支持从系统相册选图加水印。
- **导出 Excel**：多选记录 → 自动翻译补全空缺的西语/中文描述 → 生成 `.xlsx`（图片原始嵌入，OOXML）→ 系统分享（微信/邮件/文件 App）。
- **本地存储**：全部图片与元数据存放于 `App 沙盒/Documents/WatermarkCamera/`，用「文件」App 或分享出口可随时取出；删除进回收站，30 天自动清理。
- **云端扩展（预留）**：工程内置 `CloudSyncProvider` 协议（`Services/CloudSync.swift`），后续接 OSS / S3 / NAS(WebDAV) 时在「设置」中配置远端即可，无需改其他代码。

## 8. 常见问题

| 问题 | 处理 |
|---|---|
| 提示 "Unable to Install" / 安装失败 | 多半是 Bundle ID 撞车或 7 天过期：改 Bundle ID 或重新运行一次 |
| 打开显示"未受信任的开发者" | 按 3.3 节到 设置→通用→VPN 与设备管理 信任 |
| 相机黑屏 | 检查 设置→隐私→相机 是否已授权该 App |
| Xcode 构建报签名错误 | Signing & Capabilities → Team 重新选一次，Automatically manage signing 保持勾选 |
| 图标未更换 | 图标已内置（Assets.xcassets/AppIcon）；如需更换直接替换 `icon-1024.png` 后重新 install |

如需生成自定义图标，可运行 `python3 tools/make_icon.py` 重新生成（纯 Python，无第三方依赖）。