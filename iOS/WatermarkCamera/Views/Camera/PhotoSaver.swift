import UIKit

// MARK: - 照片保存助手（渲染水印 → 落盘 → 建立记录 → 可选存相册/云端）

enum PhotoSaver {
    /// 把原图渲染水印后保存为新记录
    /// - Parameters:
    ///   - image: 正向原图
    ///   - canvasPoints: 预览画布显示尺寸（浮层坐标系）
    @MainActor
    static func save(image: UIImage,
                     template: WatermarkTemplate,
                     values: [String: String],
                     placement: OverlayPlacement,
                     canvasPoints: CGSize,
                     folderId: String?,
                     storage: StorageManager,
                     autoSaveAlbum: Bool) -> Record? {
        let imagePixels = CGSize(width: image.size.width, height: image.size.height)
        let params = OverlayMapper.renderParams(template: template, values: values,
                                                placement: placement,
                                                canvasPoints: canvasPoints,
                                                imagePixels: imagePixels)
        guard let p = params,
              let wmImage = WatermarkRenderer.render(template: template, values: values,
                                                     image: image,
                                                     customX: p.customX,
                                                     customY: p.customY,
                                                     customScale: p.scale)
        else { return nil }

        let id = genId(prefix: "r")
        let dir = storage.recordDir(for: id)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let origURL = dir.appendingPathComponent(StorageManager.origFile)
        let wmURL = dir.appendingPathComponent(StorageManager.wmFile)

        if let j = image.jpegData(compressionQuality: 0.9) {
            try? j.write(to: origURL)
        }
        if let j = wmImage.jpegData(compressionQuality: 0.9) {
            try? j.write(to: wmURL)
        }

        let now = Date().timeIntervalSince1970
        let rec = Record(id: id,
                         folderId: folderId,
                         customName: nil,
                         createdAt: now,
                         updatedAt: now,
                         imagePath: "\(id)/\(StorageManager.wmFile)",
                         originalPath: "\(id)/\(StorageManager.origFile)",
                         width: Int(wmImage.size.width.rounded()),
                         height: Int(wmImage.size.height.rounded()),
                         values: values,
                         deletedAt: nil,
                         wmTemplateID: template.id,
                         wmPlacement: placement)
        storage.addRecord(rec)

        if autoSaveAlbum {
            UIImageWriteToSavedPhotosAlbum(wmImage, nil, nil, nil)
        }

        // 云端扩展点：仅在已配置（OSS/NAS）时上传
        if CloudSyncManager.shared.isConfigured {
            Task {
                try? await CloudSyncManager.shared.provider.upload(localURL: wmURL,
                                                                   remotePath: "watermark/\(id)/\(StorageManager.wmFile)")
            }
        }
        return rec
    }

    /// 编辑已有记录：重新渲染水印并覆盖 wm.jpg，保留原图
    @MainActor
    static func update(recordID: String,
                       image: UIImage,
                       template: WatermarkTemplate,
                       values: [String: String],
                       placement: OverlayPlacement,
                       canvasPoints: CGSize,
                       storage: StorageManager,
                       autoSaveAlbum: Bool) -> Bool {
        guard let i = storage.records.firstIndex(where: { $0.id == recordID }) else { return false }
        var rec = storage.records[i]
        let imagePixels = CGSize(width: image.size.width, height: image.size.height)
        let params = OverlayMapper.renderParams(template: template, values: values,
                                                placement: placement,
                                                canvasPoints: canvasPoints,
                                                imagePixels: imagePixels)
        guard let p = params,
              let wmImage = WatermarkRenderer.render(template: template, values: values,
                                                     image: image,
                                                     customX: p.customX,
                                                     customY: p.customY,
                                                     customScale: p.scale)
        else { return false }

        let wmURL = storage.imageFileURL(recordID: recordID, name: StorageManager.wmFile)
        if let j = wmImage.jpegData(compressionQuality: 0.9) {
            try? j.write(to: wmURL)
        }
        rec.values = values
        rec.width = Int(wmImage.size.width.rounded())
        rec.height = Int(wmImage.size.height.rounded())
        rec.updatedAt = Date().timeIntervalSince1970
        rec.wmTemplateID = template.id
        rec.wmPlacement = placement
        storage.updateRecord(rec)

        if autoSaveAlbum {
            UIImageWriteToSavedPhotosAlbum(wmImage, nil, nil, nil)
        }
        return true
    }

    /// 详情编辑后的重渲染：不改水印位置/模板/缩放，仅按新 values 重绘 wm.jpg
    /// （详情编辑与「重新编辑水印」两条路径行为一致的关键）
    @MainActor
    static func rerenderValues(recordID: String,
                               values: [String: String],
                               storage: StorageManager) -> Bool {
        guard let i = storage.records.firstIndex(where: { $0.id == recordID }) else { return false }
        var rec = storage.records[i]

        // 模板：优先记录里存的水印模板，其次当前激活模板
        let template = (rec.wmTemplateID.flatMap { BuiltinTemplates.template(withID: $0) }
                         ?? storage.customTemplates.first { $0.id == rec.wmTemplateID })
                        ?? (BuiltinTemplates.template(withID: AppSettings.activeTemplateID) ?? BuiltinTemplates.handwrite)

        // 基础图：优先干净原图；缺失时只能放弃（用水印图重绘会水印叠水印）
        guard let origRel = rec.originalPath,
              let origURL = storage.url(forRelativePath: origRel),
              let image = UIImage(contentsOfFile: origURL.path) else { return false }

        let imagePixels = CGSize(width: image.size.width, height: image.size.height)
        // 位置：记录里存的 placement；旧记录没有时按模板预设
        let placement = rec.wmPlacement
            ?? OverlayMapper.defaultPlacement(for: template, canvasPoints: imagePixels)
        // placement 的 dx/dy 是相对预览画布的归一化偏移，直接按图片像素为画布换算
        let params = OverlayMapper.renderParams(template: template, values: values,
                                                placement: placement,
                                                canvasPoints: imagePixels,
                                                imagePixels: imagePixels)
        guard let p = params,
              let wmImage = WatermarkRenderer.render(template: template, values: values,
                                                     image: image,
                                                     customX: p.customX,
                                                     customY: p.customY,
                                                     customScale: p.scale) else { return false }

        let wmURL = storage.imageFileURL(recordID: recordID, name: StorageManager.wmFile)
        if let j = wmImage.jpegData(compressionQuality: 0.9) {
            try? j.write(to: wmURL)
        }
        rec.values = values
        rec.width = Int(wmImage.size.width.rounded())
        rec.height = Int(wmImage.size.height.rounded())
        rec.updatedAt = Date().timeIntervalSince1970
        rec.wmTemplateID = template.id
        rec.wmPlacement = placement
        storage.updateRecord(rec)
        return true
    }
}