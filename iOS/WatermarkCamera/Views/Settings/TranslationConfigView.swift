import SwiftUI

// MARK: - 翻译接口配置（多服务商 / 多密钥，OpenAI 兼容协议）

/// 主流大模型服务商预设（均兼容 OpenAI /chat/completions 协议）
enum LLMProviderPreset {
    struct Preset {
        let name: String        // 展示名
        let provider: String
        let baseURL: String
        let model: String
        let note: String
    }

    static let all: [Preset] = [
        Preset(name: "DeepSeek", provider: "deepseek",
               baseURL: "https://api.deepseek.com/v1",
               model: "deepseek-chat",
               note: "性价比高，推荐"),
        Preset(name: "通义千问", provider: "qwen",
               baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
               model: "qwen-plus",
               note: "阿里 DashScope 兼容模式"),
        Preset(name: "Kimi", provider: "moonshot",
               baseURL: "https://api.moonshot.cn/v1",
               model: "moonshot-v1-8k",
               note: "月之暗面"),
        Preset(name: "智谱 GLM", provider: "zhipu",
               baseURL: "https://open.bigmodel.cn/api/paas/v4",
               model: "glm-4-flash",
               note: "glm-4-flash 免费"),
        Preset(name: "OpenAI", provider: "openai",
               baseURL: "https://api.openai.com/v1",
               model: "gpt-4o-mini",
               note: "官方接口"),
        Preset(name: "Ollama 本地", provider: "ollama",
               baseURL: "http://192.168.1.100:11434/v1",
               model: "qwen2.5:7b",
               note: "填你电脑的局域网 IP"),
    ]
}

struct TranslationConfigView: View {
    @State private var provider = ""
    @State private var baseURL = ""
    @State private var model = ""
    @State private var apiKey = ""
    @State private var testInput = ""
    @State private var testResult = ""
    @State private var isTesting = false
    @State private var saved = false
    /// 正在编辑的配置 id（nil = 新建）
    @State private var editingConfigID: String?

    private var hasConfig: Bool {
        !apiKey.trimmingCharacters(in: .whitespaces).isEmpty
            && !baseURL.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var configs: [TranslationAPIConfig] { AppSettings.apiConfigs }

    var body: some View {
        Form {
            // 当前激活
            Section {
                if configs.isEmpty {
                    Text("尚未保存任何配置")
                        .foregroundColor(.secondary)
                } else {
                    ForEach(configs) { cfg in
                        Button {
                            AppSettings.activeAPIConfigID = cfg.id
                            load(cfg)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(cfg.displayName)
                                        .foregroundColor(.primary)
                                    Text(cfg.hasKey ? "密钥已配置" : "密钥未配置")
                                        .font(.caption)
                                        .foregroundColor(cfg.hasKey ? .secondary : .orange)
                                }
                                Spacer()
                                if cfg.id == AppSettings.activeAPIConfigID {
                                    Label("使用中", systemImage: "checkmark.circle.fill")
                                        .font(.caption)
                                        .foregroundColor(.green)
                                        .labelStyle(.titleAndIcon)
                                }
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                deleteConfig(cfg)
                            } label: {
                                Label("删除", systemImage: "trash")
                            }
                            Button {
                                load(cfg)
                            } label: {
                                Label("编辑", systemImage: "pencil")
                            }
                            .tint(.blue)
                        }
                    }
                }
            } header: {
                Text("已保存配置（\(configs.count)）")
            } footer: {
                Text("翻译引擎仅使用「使用中」的那一条配置。点击条目可直接切换。")
            }

            // 快速预设
            Section {
                ForEach(LLMProviderPreset.all, id: \.name) { preset in
                    Button {
                        applyPreset(preset)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(preset.name)
                                    .foregroundColor(.primary)
                                Text(preset.note)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Spacer()
                            Image(systemName: "arrow.down.circle")
                                .foregroundColor(.accentColor)
                        }
                    }
                }
            } header: {
                Text("服务商预设")
            } footer: {
                Text("点击预设自动填入接口地址与模型名，只需再填 API Key 保存即可。")
            }

            // 编辑区
            Section("接口参数") {
                TextField("服务商（如 deepseek）", text: $provider)
                    .textInputAutocapitalization(.never)
                TextField("Base URL（如 https://api.deepseek.com/v1）", text: $baseURL)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                TextField("模型名（如 deepseek-chat）", text: $model)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("API Key", text: $apiKey)
            }

            // 测试翻译
            Section("测试翻译") {
                TextField("待翻译文本（中文或西语）", text: $testInput)
                if !testResult.isEmpty {
                    Text(testResult)
                        .font(.footnote)
                        .foregroundColor(.secondary)
                }
                Button(isTesting ? "翻译中..." : "测试") {
                    runTest()
                }
                .disabled(testInput.trimmingCharacters(in: .whitespaces).isEmpty || isTesting)
            }

            // 保存
            Section {
                Button {
                    saveConfig(asNew: false)
                } label: {
                    Label(editingConfigID == nil ? "保存配置" : "保存修改", systemImage: "square.and.arrow.down")
                }
                .disabled(!hasConfig)
                .fontWeight(.semibold)

                if editingConfigID != nil {
                    Button {
                        saveConfig(asNew: true)
                    } label: {
                        Label("另存为新配置", systemImage: "plus.square.on.square")
                    }
                    .disabled(!hasConfig)
                }
            } footer: {
                Text("可保存多个服务商的密钥，按需切换。兼容任意 OpenAI 格式接口：DeepSeek、通义千问、Kimi、智谱、本地 Ollama 等。留空不保存则仅使用本地词典与免费词典。")
            }
        }
        .navigationTitle("翻译接口配置")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if editingConfigID == nil {
                load(AppSettings.apiConfig)
            }
        }
        .overlay {
            if saved {
                VStack {
                    Label("已保存", systemImage: "checkmark.circle.fill")
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(Color.green))
                }
                .transition(.opacity)
            }
        }
    }

    // MARK: - 操作

    private func load(_ cfg: TranslationAPIConfig) {
        editingConfigID = cfg.id
        provider = cfg.provider
        baseURL = cfg.baseURL
        model = cfg.model
        apiKey = cfg.apiKey
    }

    /// 应用预设：填入服务商/地址/模型（保留已输入的 Key），进入新建状态
    private func applyPreset(_ preset: LLMProviderPreset.Preset) {
        editingConfigID = nil
        provider = preset.provider
        baseURL = preset.baseURL
        model = preset.model
    }

    private func saveConfig(asNew: Bool) {
        var cfg = TranslationAPIConfig(
            provider: provider.trimmingCharacters(in: .whitespaces),
            baseURL: baseURL.trimmingCharacters(in: .whitespaces),
            model: model.trimmingCharacters(in: .whitespaces),
            apiKey: apiKey.trimmingCharacters(in: .whitespaces)
        )
        var list = AppSettings.apiConfigs

        if let editingID = editingConfigID, !asNew,
           let i = list.firstIndex(where: { $0.id == editingID }) {
            cfg.id = editingID
            list[i] = cfg
        } else {
            list.append(cfg)
            editingConfigID = cfg.id
        }
        AppSettings.apiConfigs = list
        AppSettings.activeAPIConfigID = cfg.id
        withAnimation { saved = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            withAnimation { saved = false }
        }
    }

    private func deleteConfig(_ cfg: TranslationAPIConfig) {
        var list = AppSettings.apiConfigs
        list.removeAll { $0.id == cfg.id }
        AppSettings.apiConfigs = list
        if AppSettings.activeAPIConfigID == cfg.id {
            AppSettings.activeAPIConfigID = list.first?.id ?? ""
        }
        if editingConfigID == cfg.id {
            editingConfigID = nil
        }
    }

    private func runTest() {
        let text = testInput.trimmingCharacters(in: .whitespacesAndNewlines)
        let lang = TranslatorService.shared.detectLang(text)
        let from: String
        let to: String
        if lang == "zh" {
            from = "zh"; to = "es"
        } else {
            from = "es"; to = "zh"
        }
        isTesting = true
        testResult = ""
        Task {
            let result = await TranslatorService.shared.translate(text, from: from, to: to)
            await MainActor.run {
                isTesting = false
                testResult = result
            }
        }
    }
}
