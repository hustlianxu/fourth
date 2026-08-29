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
                         values: values)
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
        storage.updateRecord(rec)

        if autoSaveAlbum {
            UIImageWriteToSavedPhotosAlbum(wmImage, nil, nil, nil)
        }
        return true
    }
}