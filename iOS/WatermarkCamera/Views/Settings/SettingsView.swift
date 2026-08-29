import SwiftUI

// MARK: - 设置

struct SettingsView: View {
    @EnvironmentObject var storage: StorageManager
    @State private var exportFiles: [URL] = []

    var body: some View {
        List {
            // 存储
            Section("存储") {
                LabeledContent("本机占用") {
                    Text(formatBytes(storage.totalStorageBytes()))
                }
                NavigationLink("回收站（\(storage.trash.count)）") {
                    TrashView()
                        .environmentObject(storage)
                }
            }

            // 拍摄
            Section("拍摄") {
                Toggle("拍照后保存到系统相册", isOn: Binding(
                    get: { AppSettings.autoSaveAlbum },
                    set: { AppSettings.autoSaveAlbum = $0 }
                ))
                Toggle("编辑保存时也备份到相册", isOn: Binding(
                    get: { AppSettings.autoSaveEditAlbum },
                    set: { AppSettings.autoSaveEditAlbum = $0 }
                ))
                HStack {
                    Text("当前模板")
                    Spacer()
                    Menu {
                        ForEach(BuiltinTemplates.all, id: \.id) { tpl in
                            Button {
                                AppSettings.activeTemplateID = tpl.id
                            } label: {
                                if tpl.id == AppSettings.activeTemplateID {
                                    Label(tpl.name, systemImage: "checkmark")
                                } else {
                                    Text(tpl.name)
                                }
                            }
                        }
                        Divider()
                        ForEach(storage.customTemplates, id: \.id) { tpl in
                            Button {
                                AppSettings.activeTemplateID = tpl.id
                            } label: {
                                if tpl.id == AppSettings.activeTemplateID {
                                    Label(tpl.name, systemImage: "checkmark")
                                } else {
                                    Text(tpl.name)
                                }
                            }
                        }
                    } label: {
                        Text(activeTemplateName)
                            .foregroundColor(.secondary)
                    }
                }
                NavigationLink("模板管理") {
                    TemplatesView()
                        .environmentObject(storage)
                }
            }

            // 翻译
            Section {
                NavigationLink("自定义词典") {
                    DictionaryView()
                }
                NavigationLink("翻译接口配置") {
                    TranslationConfigView()
                }
                Toggle("优先调用大模型翻译", isOn: Binding(
                    get: { AppSettings.llmFirst },
                    set: { AppSettings.llmFirst = $0 }
                ))
                Toggle("允许使用免费在线词典（MyMemory）", isOn: Binding(
                    get: { AppSettings.freeDictConfig.enabled },
                    set: {
                        var cfg = AppSettings.freeDictConfig
                        cfg.enabled = $0
                        cfg.provider = $0 ? "mymemory" : cfg.provider
                        AppSettings.freeDictConfig = cfg
                    }
                ))
            } header: {
                Text("翻译引擎")
            } footer: {
                Text("导出时描述（西语/中文）空缺会自动翻译补全：优先本地词典，其次免费词典，最后大模型接口。")
            }

            // 云端扩展（预留）
            Section {
                LabeledContent("当前模式") {
                    Text(CloudSyncManager.shared.provider.displayName)
                        .foregroundColor(.secondary)
                }
            } header: {
                Text("云端存储（扩展）")
            } footer: {
                Text("当前为纯本机模式，照片与 Excel 全部保存在手机内，不受存储配额限制。后续接入 OSS / S3 / NAS(WebDAV) 后，可在应用内配置远端地址自动同步。")
            }

            // 导出文件
            if !exportFiles.isEmpty {
                Section("导出文件（.xlsx）") {
                    ForEach(exportFiles, id: \.self) { url in
                        HStack {
                            Image(systemName: "doc.richtext")
                                .foregroundColor(.green)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(url.lastPathComponent)
                                    .font(.subheadline)
                                Text(formatBytes(url.fileSizeBytes))
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            ShareLink(item: url) {
                                Image(systemName: "square.and.arrow.up")
                            }
                            Button(role: .destructive) {
                                try? FileManager.default.removeItem(at: url)
                                refreshExportFiles()
                            } label: {
                                Image(systemName: "trash")
                            }
                        }
                    }
                }
            }

            // 关于
            Section("关于") {
                LabeledContent("版本") {
                    Text("v\(AppSettings.appVersion)")
                }
                LabeledContent("数据存放") {
                    Text("本机 Documents/WatermarkCamera")
                        .foregroundColor(.secondary)
                }
            }
        }
        .navigationTitle("设置")
        .onAppear {
            refreshExportFiles()
        }
    }

    private var activeTemplateName: String {
        BuiltinTemplates.template(withID: AppSettings.activeTemplateID)?.name ?? "手写·双语"
    }

    private func refreshExportFiles() {
        let dir = StorageManager.shared.exportsDirectory
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        exportFiles = files.filter { $0.pathExtension.lowercased() == "xlsx" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }
}

// MARK: - 格式化辅助

func formatBytes(_ bytes: Int64) -> String {
    let f = ByteCountFormatter()
    f.countStyle = .file
    return f.string(fromByteCount: bytes)
}

extension URL {
    var fileSizeBytes: Int64 {
        (try? FileManager.default.attributesOfItem(atPath: path))?[.size] as? Int64 ?? 0
    }
}