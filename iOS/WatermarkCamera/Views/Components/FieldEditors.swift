import SwiftUI

// MARK: - 模板字段编辑区（相机 / 编辑器 / 明细编辑共用）

struct TemplateFieldsEditor: View {
    let template: WatermarkTemplate
    @Binding var values: [String: String]
    var compact: Bool = false

    var body: some View {
        VStack(spacing: 14) {
            if template.style.backgroundRGBA.contains("rgba") {
                // 留白，无需特殊处理
            }
            ForEach(template.fields) { field in
                FieldEditorRow(field: field, value: binding(for: field))
            }
        }
    }

    private func binding(for field: TemplateField) -> Binding<String> {
        Binding(
            get: { values[field.key] ?? "" },
            set: { values[field.key] = $0 }
        )
    }
}

struct FieldEditorRow: View {
    let field: TemplateField
    @Binding var value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(field.label)
                .font(.caption)
                .foregroundColor(.secondary)

            switch field.type {
            case .text:
                TextField(field.placeholder ?? "", text: $value)
                    .textFieldStyle(.roundedBorder)
            case .textarea:
                TextField(field.placeholder ?? "", text: $value, axis: .vertical)
                    .lineLimit(2...4)
                    .textFieldStyle(.roundedBorder)
            case .select:
                Menu {
                    ForEach(field.options ?? [], id: \.self) { opt in
                        Button(opt) { value = opt }
                    }
                } label: {
                    HStack {
                        Text(value.isEmpty ? (field.placeholder ?? "请选择") : value)
                            .foregroundColor(value.isEmpty ? .secondary : .primary)
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color(.systemGray6)))
                }
            case .date, .datetime:
                let (showDate, showTime) = field.type == .datetime ? (true, true) : (true, false)
                DateFieldRow(value: $value, showDate: showDate, showTime: showTime)
            case .time:
                DateFieldRow(value: $value, showDate: false, showTime: true)
            }
        }
    }
}

/// 日期/时间选择：与存储字符串（yyyy-MM-dd / HH:mm:ss / yyyy-MM-dd HH:mm:ss）互转
private struct DateFieldRow: View {
    @Binding var value: String
    let showDate: Bool
    let showTime: Bool

    private static var parseFormatter: DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }

    private var dateValue: Date {
        get {
            let s = value
            if let d = DateFieldRow.parseFormatter.date(from: s) { return d }
            let df = DateFormatter()
            df.locale = Locale(identifier: "en_US_POSIX")
            let tries = ["yyyy-MM-dd", "HH:mm:ss"]
            for fmt in tries {
                df.dateFormat = fmt
                if let d = df.date(from: s) { return d }
            }
            return Date()
        }
        set {
            let df = DateFormatter()
            df.locale = Locale(identifier: "en_US_POSIX")
            if showDate && showTime {
                df.dateFormat = "yyyy-MM-dd HH:mm:ss"
            } else if showDate {
                df.dateFormat = "yyyy-MM-dd"
            } else {
                df.dateFormat = "HH:mm:ss"
            }
            value = df.string(from: newValue)
        }
    }

    var body: some View {
        DatePicker("", selection: Binding(get: { dateValue }, set: { dateValue = $0 }),
                   displayedComponents: displayComponents)
            .labelsHidden()
    }

    private var displayComponents: DatePickerComponents {
        if showDate && showTime { return [.date, .hourAndMinute] }
        if showDate { return [.date] }
        return [.hourAndMinute]
    }
}