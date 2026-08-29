import SwiftUI

// MARK: - 自定义词典 / 不翻译白名单

struct DictionaryView: View {
    @State private var zh = ""
    @State private var es = ""
    @State private var whitelistText = ""

    private var dict: [DictEntry] { AppSettings.customDict }
    private var whitelist: [String] { AppSettings.customWhitelist }

    var body: some View {
        List {
            Section {
                HStack {
                    TextField("中文", text: $zh)
                        .textFieldStyle(.roundedBorder)
                    TextField("西语", text: $es)
                        .textFieldStyle(.roundedBorder)
                    Button {
                        addEntry()
                    } label: {
                        Image(systemName: "plus")
                    }
                    .disabled(zh.trimmingCharacters(in: .whitespaces).isEmpty
                              || es.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } header: {
                Text("新增对照")
            } footer: {
                Text("本地词典优先匹配，支持“整句 + 词边界”两种匹配方式（与翻译引擎一致）。")
            }

            Section("自定义词典（\(dict.count)）") {
                if dict.isEmpty {
                    Text("暂无自定义词条")
                        .foregroundColor(.secondary)
                } else {
                    ForEach(dict) { entry in
                        HStack {
                            Text(entry.zh)
                            Spacer()
                            Text(entry.es)
                                .foregroundColor(.secondary)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                removeEntry(entry.id)
                            } label: {
                                Label("删除", systemImage: "trash")
                            }
                        }
                    }
                }
            }

            Section("不翻译白名单（\(whitelist.count)）") {
                TextField("每行一个词，如：RGB / LED / pcs", text: $whitelistText, axis: .vertical)
                    .lineLimit(4...10)
                Button("保存白名单") {
                    let cleaned = whitelistText
                        .split(whereSeparator: \.isNewline)
                        .map { $0.trimmingCharacters(in: .whitespaces) }
                        .filter { !$0.isEmpty }
                    AppSettings.customWhitelist = cleaned
                }
                .disabled(whitelistText.isEmpty)
            } footer: {
                Text("数字、货号、单位（m³、kg、pcs 等）自带白名单，无需重复添加。")
            }
        }
        .navigationTitle("自定义词典")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            whitelistText = whitelist.joined(separator: "\n")
        }
    }

    private func addEntry() {
        let z = zh.trimmingCharacters(in: .whitespaces)
        let e = es.trimmingCharacters(in: .whitespaces)
        guard !z.isEmpty, !e.isEmpty else { return }
        var list = AppSettings.customDict
        list.insert(DictEntry(id: genId(prefix: "d"), zh: z, es: e), at: 0)
        AppSettings.customDict = list
        zh = ""
        es = ""
    }

    private func removeEntry(_ id: String) {
        let list = AppSettings.customDict.filter { $0.id != id }
        AppSettings.customDict = list
    }
}