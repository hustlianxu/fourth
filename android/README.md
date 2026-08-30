# 水印相机 · Android 版

与 iOS 版（`../iOS/WatermarkCamera`）功能对齐的安卓水印相机：拍摄 → 添加可拖动/缩放的水印 → 管理记录 → 导出内嵌图片的 Excel。

技术栈：Kotlin + Jetpack Compose (Material 3) + CameraX；数据存 JSON + 图片文件（无数据库依赖）；Excel 导出为自研 OOXML 写入器（已在 iOS 端逐字节验证其 ZIP 结构）。

## 功能一览

| 模块 | 说明 |
|---|---|
| 拍摄 | CameraX 实时预览 + 水印浮层实时渲染；模板切换；相册选图 |
| 水印编辑 | 单指拖动移动、双指等比缩放（字体+块一起）、边缘手柄单向缩放、点按水印编辑内容；图片完整显示 |
| 模板 | 3 个内置模板（手写·双语 / 极简 / 手写·精简），支持新建自定义模板（位置 9 宫格、宽度比、字号、颜色、字段增删） |
| 记录管理 | 文件夹分组（重名校验、折叠、删除）、多选批量保存到相册/移入回收站、移动到文件夹 |
| 详情 | 默认只读防误编辑；编辑态字段改动实时反映到图片水印；保存按原位置/原模板重渲染；"重新编辑水印"回到编辑器 |
| 导出 | 范围（全部/文件夹）、图片压缩（原像素/50%/25%/1MB 内）、4 种时间排序（创建/更新 × 正序/倒序）；列表顺序即导出行顺序 |
| 回收站 | 恢复 / 彻底删除 / 清空；30 天自动清理 |
| 设置 | 本机占用、回收站入口、导出文件管理与分享 |

## 环境要求

- **Android Studio Hedgehog (2023.1.1) 或更高**（推荐路径，含全部依赖）
- JDK 17（Android Studio 自带）
- Android SDK Platform 34（Studio 会自动下载）
- 真机/模拟器：Android 8.0（API 26）及以上

## 打包流程

### 方式一：Android Studio（推荐）

1. 打开 Android Studio → **File → Open** → 选择本 `android` 目录
2. 等待 Gradle Sync 完成（首次会下载依赖，需联网）
3. 连接手机（需开启"开发者选项 → USB 调试"），顶部设备选择器选中它
4. 点击 **Run ▶**（或 `Ctrl+R`）—— 编译、安装、启动一步完成

调试包 APK 输出路径：`app/build/outputs/apk/debug/app-debug.apk`

### 方式二：命令行

```bash
cd android

# 调试包
./gradlew assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk

# 发布包（见下方签名配置）
./gradlew assembleRelease
```

> Gradle Wrapper 已包含在仓库中（`gradlew` + `gradle/wrapper/`），无需另装 Gradle，只要求 JDK 17。
> 本工程已在 JDK 17 + Gradle 8.14.5 + AGP 8.2.2 + SDK Platform 34 环境下实际编译验证：`assembleDebug` 与 `assembleRelease` 均构建成功。

## 安装到手机

### adb 安装

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

### 直接发送 APK

把 `app-debug.apk` 通过微信/网盘发到手机，点击安装（需允许"安装未知来源应用"）。

## 发布签名（可选）

`app/build.gradle.kts` 中已预留配置，创建 `android/keystore.properties`：

```properties
storeFile=../my-release-key.jks
storePassword=你的密码
keyAlias=my-alias
keyPassword=你的密码
```

然后运行 `./gradlew assembleRelease`，产物在 `app/build/outputs/apk/release/app-release.apk`。

生成密钥：

```bash
keytool -genkey -v -keystore my-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias my-alias
```

## 数据存储位置

- 照片与索引：应用私有目录 `files/WatermarkCamera/`（卸载即清除）
- 导出的 Excel：应用外部文件目录（`Android/data/com.watermark.camera/files/exports/`），分享后可在微信/QQ 中直接打开
- 相册保存：`Pictures/WatermarkCamera/`（API 29+ 无需存储权限）

## 与 iOS 端的关系

- 数据模型（模板/记录/文件夹/水印放置）与 iOS `Models.swift` 一一对应，JSON 字段名相同
- 渲染公式（字号、行高、内边距、换行算法、9 宫格定位）逐行移植自 `WatermarkRenderer.swift`
- Excel 导出采用同一套 OOXML 结构与 STORE 模式 ZIP 写入器（含 central directory external attrs 4 字节的正确写法——iOS 端曾因此 bug 踩坑，安卓端直接修复后移植）
