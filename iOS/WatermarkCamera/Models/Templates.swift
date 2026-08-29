import Foundation

/// 内置模板（移植自小程序 utils/templates.js）
enum BuiltinTemplates {
    static let all: [WatermarkTemplate] = [handwrite, minimal, handwriteSimple]

    static let handwrite = WatermarkTemplate(
        id: "handwrite",
        name: "手写·双语",
        desc: "Formato anotación · 货号 + 西语描述 + 中文描述 + 单价 + 装箱数 + 件数 + 体积 + 日期",
        isBuiltin: true,
        position: "bottom-center",
        widthRatio: 0.42,
        style: TemplateStyle(fontSize: 22, colorHex: "#ffffff", backgroundRGBA: "rgba(0,0,0,0.70)",
                             padding: 14, borderRadius: 10, lineHeight: 1.35),
        fields: [
            TemplateField(key: "modelo", label: "货号 · Modelo / Código", type: .text, placeholder: "如：RL-034 · HB098"),
            TemplateField(key: "desEs", label: "Descripción ES · 西语描述", type: .textarea,
                          placeholder: "如：6 estrellas grande + 6 estrellas chicas · 8 secuencias · sin música", multiline: true),
            TemplateField(key: "desZh", label: "Descripción ZH · 中文描述", type: .textarea,
                          placeholder: "如：6 大星星 + 6 小星星挂灯 · 8 种闪烁模式 · 不带音乐", multiline: true),
            TemplateField(key: "precio", label: "单价 · Precio unitario", type: .text, placeholder: "如：¥11 · $0.65"),
            TemplateField(key: "pzs", label: "每箱件数 · Pzs / caja", type: .text, placeholder: "如：48 pzs / caja"),
            TemplateField(key: "cajas", label: "件数 · Total cajas / pzs", type: .text, placeholder: "如：50 cajas · 1200 pzs"),
            TemplateField(key: "volumen", label: "体积 · Volumen", type: .text, placeholder: "如：0.125 m³ / 2 cajas"),
            TemplateField(key: "peso", label: "重量 · Peso", type: .text, placeholder: "如：2.5 kg"),
            TemplateField(key: "nota", label: "备注 · Nota", type: .textarea,
                          placeholder: "如：con luz y música · movimiento · poner más opp en la caja", multiline: true),
            TemplateField(key: "fecha", label: "日期 · Fecha", type: .datetime)
        ]
    )

    static let minimal = WatermarkTemplate(
        id: "minimal",
        name: "极简模板",
        desc: "货号 + 单价 + 描述 + 装箱数 + 体积 + 件数",
        isBuiltin: true,
        position: "bottom-center",
        widthRatio: 0.42,
        style: TemplateStyle(fontSize: 22, colorHex: "#ffffff", backgroundRGBA: "rgba(0,0,0,0.70)",
                             padding: 14, borderRadius: 10, lineHeight: 1.35),
        fields: [
            TemplateField(key: "modelo", label: "货号 · Modelo", type: .text, placeholder: "如：RL-034"),
            TemplateField(key: "precio", label: "单价 · Precio ￥", type: .text, placeholder: "如：¥11"),
            TemplateField(key: "desEs", label: "描述 · Des.", type: .textarea, placeholder: "如：6 estrellas grande", multiline: true),
            TemplateField(key: "pzs", label: "装箱数 · Pzas/Caja", type: .text, placeholder: "如：48 pzs / caja"),
            TemplateField(key: "volumen", label: "体积 · Cúbico", type: .text, placeholder: "如：0.125 m³"),
            TemplateField(key: "cajas", label: "件数 · Cajas", type: .text, placeholder: "如：50 cajas")
        ]
    )

    static let handwriteSimple = WatermarkTemplate(
        id: "handwriteSimple",
        name: "手写·精简",
        desc: "Formato corto · 货号 + 西语描述 + 单价 + 装箱数 + 体积",
        isBuiltin: true,
        position: "bottom-center",
        widthRatio: 0.42,
        style: TemplateStyle(fontSize: 24, colorHex: "#ffffff", backgroundRGBA: "rgba(0,0,0,0.70)",
                             padding: 14, borderRadius: 10, lineHeight: 1.35),
        fields: [
            TemplateField(key: "modelo", label: "货号 · Modelo", type: .text, placeholder: "如：RL-034"),
            TemplateField(key: "desEs", label: "Descripción ES", type: .textarea,
                          placeholder: "如：3ctn × 48 pcs × 29 rmb · con luz y música", multiline: true),
            TemplateField(key: "precio", label: "单价 · Precio", type: .text, placeholder: "如：¥11"),
            TemplateField(key: "pzs", label: "每箱 · Pzs / caja", type: .text, placeholder: "如：48 pzs / caja"),
            TemplateField(key: "cajas", label: "件数 · Total", type: .text, placeholder: "如：10 cajas"),
            TemplateField(key: "volumen", label: "体积 · Volumen", type: .text, placeholder: "如：0.125 m³")
        ]
    )

    /// 模板默认字段值（datetime 等自动填入当前时间）
    static func defaultValues(for template: WatermarkTemplate) -> [String: String] {
        var values: [String: String] = [:]
        let now = Date()
        for f in template.fields {
            switch f.type {
            case .datetime:
                values[f.key] = formatDateTime(now)
            case .date:
                let df = DateFormatter()
                df.dateFormat = "yyyy-MM-dd"
                values[f.key] = df.string(from: now)
            case .time:
                let tf = DateFormatter()
                tf.dateFormat = "HH:mm:ss"
                values[f.key] = tf.string(from: now)
            case .select:
                values[f.key] = f.options?.first ?? f.defaultValue ?? ""
            default:
                values[f.key] = f.defaultValue ?? ""
            }
        }
        return values
    }

    static func template(withID id: String) -> WatermarkTemplate? {
        if let builtin = all.first(where: { $0.id == id }) { return builtin }
        return StorageManager.shared.customTemplates.first(where: { $0.id == id })
    }
}