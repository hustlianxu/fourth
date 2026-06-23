// pages/camera/camera.js
const templates = require('../../utils/templates.js');
const storage = require('../../utils/storage.js');
const watermark = require('../../utils/watermark.js');
const ocr = require('../../utils/ocr.js');

// 水印位置选项（9个：左上/中上/右上 + 左中/正中/右中 + 左下/中下/右下）
const POSITIONS = [
  { id: 'top-left',     grid: '1 / 1', label: '左上' },
  { id: 'top-center',   grid: '1 / 2', label: '上中' },
  { id: 'top-right',    grid: '1 / 3', label: '右上' },
  { id: 'center-left',  grid: '2 / 1', label: '左中' },
  { id: 'center',       grid: '2 / 2', label: '正中' },
  { id: 'center-right', grid: '2 / 3', label: '右中' },
  { id: 'bottom-left',  grid: '3 / 1', label: '左下' },
  { id: 'bottom-center',grid: '3 / 2', label: '下中' },
  { id: 'bottom-right', grid: '3 / 3', label: '右下' }
];

Page({
  data: {
    template: null,
    templates: [],
    values: {},
    photo: null,
    photoInfo: null,
    stage: 'camera',
    showTplPicker: false,
    formOpen: false,      // 表单是否展开
    wPos: 'bottom-left',  // 当前选中的水印位置
    POSITIONS: POSITIONS,
    filledSummary: []
  },

  onLoad(options) {
    const tplId = options.templateId || 'handwrite';
    const tpl = templates.getTemplateById(tplId);
    const defaultVals = templates.getDefaultValues(tpl);
    this.setData({
      template: tpl,
      templates: templates.TEMPLATES,
      values: defaultVals,
      wPos: (tpl && tpl.position) || 'bottom-left'
    });
    this._updateSummary();
    this.ctx = wx.createCameraContext();
  },

  // 切换表单展开/收起
  toggleForm() {
    this.setData({ formOpen: !this.data.formOpen });
  },

  // 设置水印位置
  onSetPos(e) {
    const pos = e.currentTarget.dataset.pos;
    this.setData({ wPos: pos });
  },

  // 更新概要标签行（已填字段显示为标签）
  _updateSummary() {
    const fields = (this.data.template && this.data.template.fields) || [];
    const vals = this.data.values || {};
    const summary = [];
    fields.forEach((f) => {
      const v = vals[f.key];
      if (v && String(v).trim()) {
        // 截取前 12 个字符
        const short = String(v).trim().slice(0, 12);
        summary.push(short);
      }
    });
    this.setData({ filledSummary: summary });
  },

  // 字段输入
  onFieldInput(e) {
    const key = e.currentTarget.dataset.key;
    const val = e.detail.value;
    const values = Object.assign({}, this.data.values, { [key]: val });
    this.setData({ values });
    this._updateSummary();
  },

  onSelectChange(e) {
    const key = e.currentTarget.dataset.key;
    const range = e.currentTarget.dataset.range;
    const idx = e.detail.value;
    const values = Object.assign({}, this.data.values, { [key]: range[idx] });
    this.setData({ values });
    this._updateSummary();
  },

  // 获取定位
  onGetLocation() {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        const location = 'Loc ' + res.latitude.toFixed(4) + ',' + res.longitude.toFixed(4);
        const values = Object.assign({}, this.data.values, { location });
        this.setData({ values });
        this._updateSummary();
        wx.showToast({ title: '已定位', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '定位失败', icon: 'none' });
      }
    });
  },

  // 刷新时间
  onRefreshTime() {
    const now = new Date();
    const values = Object.assign({}, this.data.values);
    (this.data.template.fields || []).forEach((f) => {
      if (f.type === 'datetime') values[f.key] = templates.formatDateTime(now);
      if (f.type === 'date') values[f.key] = templates.formatDate(now);
      if (f.type === 'time') values[f.key] = templates.formatTime(now);
    });
    this.setData({ values });
    this._updateSummary();
  },

  // 模板选择
  onTplTap() {
    this.setData({ showTplPicker: true });
  },

  onPickTemplate(e) {
    const id = e.currentTarget.dataset.id;
    const tpl = templates.getTemplateById(id);
    this.setData({
      template: tpl,
      values: templates.getDefaultValues(tpl, { location: this.data.values.location }),
      wPos: (tpl && tpl.position) || 'bottom-left',
      formOpen: false
    });
    this._updateSummary();
  },

  closePicker() {
    this.setData({ showTplPicker: false });
  },

  // 校验
  validate() {
    const fields = this.data.template.fields || [];
    const values = this.data.values || {};
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.required && (!values[f.key] || !String(values[f.key]).trim())) {
        wx.showToast({ title: f.label + ' 不能为空', icon: 'none' });
        return false;
      }
    }
    return true;
  },

  // 拍照
  onTakePhoto() {
    if (!this.validate()) return;
    this.ctx.takePhoto({
      quality: 'high',
      success: (res) => {
        console.log('拍照成功，临时文件路径:', res.tempImagePath);
        
        // 获取拍照后的文件信息
        wx.getFileInfo({
          filePath: res.tempImagePath,
          success: (fileInfo) => {
            console.log('拍照文件大小:', fileInfo.size, '字节', (fileInfo.size / 1024).toFixed(2) + 'KB');
          },
          fail: (err) => {
            console.error('获取文件信息失败:', err);
          }
        });
        
        wx.getImageInfo({
          src: res.tempImagePath,
          success: (info) => {
            console.log('拍照图片尺寸:', info.width, 'x', info.height);
            this._goPreview(res.tempImagePath, { width: info.width, height: info.height });
          },
          fail: () => {
            this._goPreview(res.tempImagePath, { width: 1080, height: 1440 });
          }
        });
      },
      fail: () => wx.showToast({ title: '拍照失败', icon: 'none' })
    });
  },

  // 高清拍摄：调用系统相机，保留原始分辨率
  onTakeHighQualityPhoto() {
    if (!this.validate()) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      sizeType: ['original'],
      success: (res) => {
        const file = res.tempFiles[0];
        console.log('高清拍摄成功, 大小:', (file.size / 1024).toFixed(1) + 'KB');
        wx.getImageInfo({
          src: file.tempFilePath,
          success: (info) => {
            console.log('高清拍摄分辨率:', info.width + 'x' + info.height);
            this._goPreview(file.tempFilePath, { width: info.width, height: info.height });
          },
          fail: () => {
            this._goPreview(file.tempFilePath, { width: 2736, height: 3648 });
          }
        });
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '拍摄失败', icon: 'none' });
        }
      }
    });
  },

  // 跳转到预览页
  _goPreview(photo, photoInfo) {
    try {
      const params = {
        photo: photo,
        photoInfo: JSON.stringify(photoInfo),
        template: JSON.stringify(this.data.template),
        values: JSON.stringify(this.data.values)
      };
      // 使用全局变量临时存储数据（必须在 navigateTo 之前设置，避免竞态）
      getApp().globalData.previewData = params;
      wx.navigateTo({
        url: `/pages/preview/preview`,
        success: () => {
          console.log('navigateTo success');
        },
        fail: (err) => {
          console.error('navigateTo failed:', err);
          // 导航失败时清理全局数据
          getApp().globalData.previewData = null;
        }
      });
    } catch (e) {
      console.error('_goPreview error:', e);
      wx.showToast({ title: '跳转失败', icon: 'none' });
    }
  },

  // 相册
  onPickImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: (res) => {
        wx.getImageInfo({
          src: res.tempFiles[0].tempFilePath,
          success: (info) => {
            this._goPreview(info.path, { width: info.width, height: info.height });
          },
          fail: () => {
            this._goPreview(res.tempFiles[0].tempFilePath, { width: 1080, height: 1440 });
          }
        });
      }
    });
  },

});
