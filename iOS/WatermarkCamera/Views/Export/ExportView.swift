import SwiftUI
import UIKit

// MARK: - 导出 Excel 视图（多选记录 → 生成 .xlsx → 系统分享）

struct ExportView: View {
    @EnvironmentObject var storage: StorageManager
    @Environment(\.dismiss) private var dismiss

    /// 选择范围：nil = 全部记录
    @State private var filterFolderID: String?
    @State private var selected = Set<String>()
    @State private var fileName = ""
    @State private var isExporting = false
    @State private var progressText = ""
    @State private var shareURL: URL?
    @State private var errorMessage: String?

    private var scopeRecords: [Record] {
        storage.records(inFolder: filterFolderID)
    }

    var body: some View {
        NavigationStack {
            List {
                // 文件名
                Section {
                    TextField("文件名（可自定义）", text: $fileName)
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("导出文件名")
                } footer: {
                    Text("将生成 .xlsx 文件，含照片、双语描述等所有字段；描述空缺时自动尝试翻译补全。")
                }

                // 范围筛选
                Section("导出范围") {
                    Picker("文件夹", selection: $filterFolderID) {
                        Text("全部（\(storage.records.count)）").tag(String?.none)
                        ForEach(storage.folders) { folder in
                            Text("\(folder.name)（\(storage.records(inFolder: folder.id).count)）").tag(String?.some(folder.id))
                        }
                    }
                }

                // 记录选择
                Section {
                    HStack {
                        Text("已选 \(selected.count) / \(scopeRecords.count)")
                        Spacer()
                        Button(selected.count == scopeRecords.count && !scopeRecords.isEmpty ? "取消全选" : "全选") {
                            toggleSelectAll()
                        }
                        .disabled(scopeRecords.isEmpty)
                    }
                    .font(.footnote)

                    if scopeRecords.isEmpty {
                        Text("该范围暂无记录")
                            .foregroundColor(.secondary)
                    } else {
                        ForEach(scopeRecords) { rec in
                            selectionRow(rec)
                        }
                    }
                }
            }
            .navigationTitle("导出 Excel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("导出") { startExport() }
                        .fontWeight(.semibold)
                        .disabled(selected.isEmpty || isExporting)
                }
            }
            .overlay {
                if isExporting {
                    exportingOverlay
                }
            }
            .alert("提示", isPresented: .constant(errorMessage != nil)) {
                Button("好") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
            .sheet(item: $shareURL) { url in
                ShareSheet(items: [url]) { _ in
                    dismiss()
                }
            }
            .onAppear {
                if fileName.isEmpty {
                    fileName = Self.defaultFileName()
                }
            }
        }
    }

    // MARK: - 行

    private func selectionRow(_ rec: Record) -> some View {
        Button {
            toggle(rec.id)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: selected.contains(rec.id) ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundColor(selected.contains(rec.id) ? .accentColor : .secondary)
                PhotoThumbnail(record: rec, size: 44)
                VStack(alignment: .leading, spacing: 3) {
                    Text(rec.values["modelo"]?.isEmpty == false ? "记录 · \(rec.values["modelo"] ?? "")" : "记录 \(Int(Date(timeIntervalSince1970: rec.createdAt)))")
                        .font(.subheadline)
                        .lineLimit(1)
                    Text(formatDateTime(Date(timeIntervalSince1970: rec.createdAt)))
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - 导出中浮层

    private var exportingOverlay: some View {
        ZStack {
            Color.black.opacity(0.25).ignoresSafeArea()
            VStack(spacing: 14) {
                ProgressView()
                    .controlSize(.large)
                Text(progressText.isEmpty ? "正在准备..." : progressText)
                    .font(.subheadline)
            }
            .padding(24)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color(.systemBackground)))
        }
    }

    // MARK: - 逻辑

    private func toggle(_ id: String) {
        if selected.contains(id) {
            selected.remove(id)
        } else {
            selected.insert(id)
        }
    }

    private func toggleSelectAll() {
        if selected.count == scopeRecords.count {
            selected = []
        } else {
            selected = Set(scopeRecords.map(\.id))
        }
    }

    private func startExport() {
        guard !selected.isEmpty else { return }
        let records = scopeRecords.filter { selected.contains($0.id) }
        isExporting = true
        progressText = "正在准备 \(records.count) 条记录..."
        Task {
            do {
                let url = try await ExportService.shared.exportToXlsx(records: records, customFileName: fileName.isEmpty ? Self.defaultFileName() : fileName) { text in
                    Task { @MainActor in
                        progressText = text
                    }
                }
                await MainActor.run {
                    isExporting = false
                    shareURL = url
                }
            } catch {
                await MainActor.run {
                    isExporting = false
                    errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                }
            }
        }
    }

    private static func defaultFileName() -> String {
        let f = DateFormatter()
        f.dateFormat = "export_yyyyMMdd_HHmm"
        return f.string(from: Date())
    }
}

extension URL: Identifiable {
    public var id: String { absoluteString }
}