import SwiftUI

// MARK: - 翻译接口配置（OpenAI 兼容协议：DeepSeek / 通义 / 本地 Ollama 等）

struct TranslationConfigView: View {
    @State private var provider = ""
    @State private var baseURL = ""
    @State private var model = ""
    @State private var apiKey = ""
    @State private var testInput = ""
    @State private var testResult = ""
    @State private var isTesting = false
    @State private var saved = false

    private var hasConfig: Bool {
        !apiKey.trimmingCharacters(in: .whitespaces).isEmpty
            && !baseURL.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        Form {
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
            } footer: {
                Text("兼容任意 OpenAI 格式接口：DeepSeek、通义千问（DashScope 兼容模式）、本地 Ollama 等。留空则不调用大模型，仅使用本地词典与我们自身的免费词典。")
            }

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

            Section {
                Button("保存配置") {
                    save()
                }
                .fontWeight(.semibold)
            }
        }
        .navigationTitle("翻译接口配置")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            let cfg = AppSettings.apiConfig
            provider = cfg.provider
            baseURL = cfg.baseURL
            model = cfg.model
            apiKey = cfg.apiKey
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

    private func save() {
        AppSettings.apiConfig = TranslationAPIConfig(
            provider: provider.trimmingCharacters(in: .whitespaces),
            baseURL: baseURL.trimmingCharacters(in: .whitespaces),
            model: model.trimmingCharacters(in: .whitespaces),
            apiKey: apiKey.trimmingCharacters(in: .whitespaces)
        )
        withAnimation {
            saved = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            withAnimation { saved = false }
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