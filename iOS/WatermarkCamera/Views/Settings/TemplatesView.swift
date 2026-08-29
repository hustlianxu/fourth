import SwiftUI
import UIKit

// MARK: - 模板管理（内置模板展示 + 自定义模板增删改）

struct TemplatesView: View {
    @EnvironmentObject var storage: StorageManager
    @State private var editingTemplate: WatermarkTemplate?
    @State private var isNew = false

    var body: some View {
        List {
            Section {
                Button {
                    startNewTemplate()
                } label: {
                    Label("新建自定义模板", systemImage: "plus.circle")
                }
            }

            Section("内置模板") {
                ForEach(BuiltinTemplates.all, id: \.id) { tpl in
                    templateRow(tpl)
                }
            }

            if !storage.customTemplates.isEmpty {
                Section("我的模板") {
                    ForEach(storage.customTemplates, id: \.id) { tpl in
                        templateRow(tpl)
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    storage.deleteCustomTemplate(tpl.id)
                                } label: {
                                    Label("删除", systemImage: "trash")
                                }
                            }
                    }
                }
            }
        }
        .navigationTitle("模板管理")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $editingTemplate) { tpl in
            TemplateEditorView(template: tpl, isNew: isNew) { saved in
                if saved {
                    // 更新当前使用模板名（如需）
                }
            }
            .environmentObject(storage)
        }
    }

    private func templateRow(_ tpl: WatermarkTemplate) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(tpl.name)
                        .font(.subheadline.weight(.medium))
                    if tpl.id == AppSettings.activeTemplateID {
                        Text("当前")
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(Color.accentColor.opacity(0.15)))
                            .foregroundColor(.accentColor)
                    }
                }
                Text(tpl.desc ?? "")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }
            Spacer()
            if !tpl.isBuiltin {
                Button {
                    editingTemplate = tpl
                    isNew = false
                } label: {
                    Image(systemName: "pencil")
                }
                .buttonStyle(.bordered)
                .tint(.blue)
            } else {
                Button("复制") {
                    var copy = tpl
                    copy.id = genId(prefix: "t")
                    copy.name = "\(tpl.name)·副本"
                    copy.isBuiltin = false
                    storage.saveCustomTemplate(copy)
                    editingTemplate = copy
                    isNew = false
                }
                .buttonStyle(.bordered)
                .tint(.blue)
            }
        }
        .contextMenu {
            Button("使用该模板") {
                AppSettings.activeTemplateID = tpl.id
            }
        }
    }

    private func startNewTemplate() {
        var tpl = WatermarkTemplate(id: genId(prefix: "t"),
                                    name: "新模板",
                                    desc: nil,
                                    isBuiltin: false)
        // 默认字段组（货号+描述+单价）
        tpl.fields = [
            TemplateField(key: "modelo", label: "货号 · Modelo", type: .text, placeholder: "如：RL-034"),
            TemplateField(key: "desEs", label: "描述 · Des.", type: .textarea, placeholder: "如：6 estrellas", multiline: true),
            TemplateField(key: "precio", label: "单价 · Precio", type: .text, placeholder: "如：¥11")
        ]
        editingTemplate = tpl
        isNew = true
    }
}

// MARK: - 模板编辑器

struct TemplateEditorView: View {
    @EnvironmentObject var storage: StorageManager
    @Environment(\.dismiss) private var dismiss

    let template: WatermarkTemplate
    let isNew: Bool
    /// 保存完成回调（saved: Bool）
    var onSaved: ((Bool) -> Void)? = nil

    @State private var name: String
    @State private var desc: String
    @State private var position: String
    @State private var widthRatio: Double
    @State private var fontSize: Double
    @State private var textColor: Color
    @State private var useBg: Bool
    @State private var bgOpacity: Double
    @State private var borderRadius: Double
    @State private var lineHeight: Double
    @State private var fields: [TemplateField]
    @State private var showSaveError = false

    init(template: WatermarkTemplate, isNew: Bool, onSaved: ((Bool) -> Void)? = nil) {
        self.template = template
        self.isNew = isNew
        self.onSaved = onSaved
        _name = State(initialValue: template.name)
        _desc = State(initialValue: template.desc ?? "")
        _position = State(initialValue: template.position)
        _widthRatio = State(initialValue: template.widthRatio)
        _fontSize = State(initialValue: template.style.fontSize)
        _textColor = State(initialValue: Color(hex: template.style.colorHex) ?? .white)
        let bg = template.style.backgroundRGBA
        _useBg = State(initialValue: bg.contains("rgba") ? !bg.contains("rgba(0,0,0,0)") : !bg.isEmpty)
        _bgOpacity = State(initialValue: extractAlpha(bg) ?? 0.7)
        _borderRadius = State(initialValue: template.style.borderRadius)
        _lineHeight = State(initialValue: template.style.lineHeight)
        _fields = State(initialValue: template.fields)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("基本信息") {
                    TextField("模板名称", text: $name)
                    TextField("描述（可选）", text: $desc)
                    Picker("水印位置", selection: $position) {
                        ForEach(Self.positions, id: \.self) { pos in
                            Text(positionName(pos)).tag(pos)
                        }
                    }
                    HStack {
                        Text("宽度占比 \(Int(widthRatio * 100))%")
                        Slider(value: $widthRatio, in: 0.2...0.8)
                    }
                }

                Section("样式") {
                    HStack {
                        Text("字号 \(Int(fontSize))")
                        Slider(value: $fontSize, in: 14...36)
                    }
                    ColorPicker("文字颜色", selection: $textColor)
                    Toggle("深色底", isOn: $useBg)
                    if useBg {
                        HStack {
                            Text("底透明度 \(Int(bgOpacity * 100))%")
                            Slider(value: $bgOpacity, in: 0.1...0.95)
                        }
                    }
                    HStack {
                        Text("圆角 \(Int(borderRadius))")
                        Slider(value: $borderRadius, in: 0...24)
                    }
                    HStack {
                        Text("行距 \(String(format: "%.2f", lineHeight))")
                        Slider(value: $lineHeight, in: 1.0...1.8)
                    }
                }

                Section {
                    ForEach(fields.indices, id: \.self) { index in
                        fieldEditorRow(Binding(
                            get: { fields[index] },
                            set: { fields[index] = $0 }
                        ))
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                fields.remove(at: index)
                            } label: {
                                Label("删除", systemImage: "trash")
                            }
                        }
                    }

                    Button {
                        fields.append(TemplateField(key: "field\(fields.count + 1)",
                                                    label: "字段\(fields.count + 1)",
                                                    type: .text,
                                                    placeholder: ""))
                    } label: {
                        Label("添加字段", systemImage: "plus")
                    }
                } header: {
                    Text("水印字段")
                } footer: {
                    Text("每个字段独立成行：标签一行、内容另起一行（对齐小程序渲染规则）。左滑可删除字段。")
                }
            }
            .navigationTitle(isNew ? "新建模板" : "编辑模板")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") { save() }
                        .fontWeight(.semibold)
                }
            }
            .alert("提示", isPresented: $showSaveError) {
                Button("好") { showSaveError = false }
            } message: {
                Text("模板名称不能为空，且至少保留一个字段")
            }
        }
    }

    private func fieldEditorRow(_ field: Binding<TemplateField>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "line.3.horizontal")
                    .foregroundColor(.secondary)
                    .font(.caption)
                TextField("字段名（显示如水印标签）", text: field.label)
                    .font(.subheadline)
            }
            HStack {
                TextField("key", text: field.key)
                    .textInputAutocapitalization(.never)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .frame(width: 80)
                Picker("类型", selection: field.type) {
                    ForEach(FieldType.allCases, id: \.self) { t in
                        Text(t.displayName).tag(t)
                    }
                }
            }
            TextField("占位提示（可选）", text: Binding(
                get: { field.wrappedValue.placeholder ?? "" },
                set: { field.wrappedValue.placeholder = $0.isEmpty ? nil : $0 }
            ))
            if field.wrappedValue.type == .select {
                TextField("选项（英文逗号分隔）", text: Binding(
                    get: { field.wrappedValue.options?.joined(separator: ",") ?? "" },
                    set: {
                        let opts = $0.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
                        field.wrappedValue.options = opts.isEmpty ? nil : opts
                    }
                ))
            } else if field.wrappedValue.type == .textarea {
                Toggle("多行换行", isOn: field.multiline)
            }
        }
        .padding(.vertical, 2)
    }

    private func save() {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty, !fields.isEmpty,
              !fields.contains(where: { $0.key.trimmingCharacters(in: .whitespaces).isEmpty }) else {
            showSaveError = true
            return
        }
        var tpl = template
        tpl.name = trimmedName
        tpl.desc = desc.isEmpty ? nil : desc
        tpl.position = position
        tpl.widthRatio = widthRatio
        tpl.style.fontSize = fontSize
        tpl.style.colorHex = textColor.hexString ?? "#ffffff"
        tpl.style.lineHeight = lineHeight
        tpl.style.borderRadius = borderRadius
        tpl.style.backgroundRGBA = useBg ? "rgba(0,0,0,\(String(format: "%.2f", bgOpacity)))" : "rgba(0,0,0,0)"
        tpl.fields = fields
        storage.saveCustomTemplate(tpl)
        AppSettings.activeTemplateID = tpl.id
        onSaved?(true)
        dismiss()
    }

    // MARK: - 辅助

    static let positions = ["top-left", "top-center", "top-right",
                            "center-left", "center-center", "center-right",
                            "bottom-left", "bottom-center", "bottom-right"]

    func positionName(_ pos: String) -> String {
        switch pos {
        case "top-left": return "左上"
        case "top-center": return "上中"
        case "top-right": return "右上"
        case "center-left": return "左中"
        case "center-center": return "正中"
        case "center-right": return "右中"
        case "bottom-left": return "左下"
        case "bottom-center": return "下中"
        case "bottom-right": return "右下"
        default: return "下中"
        }
    }

    private func extractAlpha(_ rgba: String) -> Double? {
        // "rgba(r,g,b,a)" → a
        guard rgba.hasPrefix("rgba(") else { return nil }
        let inner = rgba.dropFirst(6).dropLast()
        let parts = inner.split(separator: ",")
        guard parts.count == 4, let a = Double(parts[3].trimmingCharacters(in: .whitespaces)) else { return nil }
        return a
    }
}

// MARK: - Color 十六进制转换

extension Color {
    init?(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard h.count == 6, let v = UInt64(h, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 0xFF) / 255.0,
                  green: Double((v >> 8) & 0xFF) / 255.0,
                  blue: Double(v & 0xFF) / 255.0,
                  opacity: 1)
    }

    /// 输出 #RRGGBB（WatermarkRenderer.parseColor 要求 # 前缀）
    var hexString: String? {
        let ui = UIColor(self)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard ui.getRed(&r, green: &g, blue: &b, alpha: &a) else { return nil }
        return String(format: "#%02X%02X%02X",
                      Int(round(r * 255)), Int(round(g * 255)), Int(round(b * 255)))
    }
}