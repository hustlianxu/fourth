// pages/camera/camera.js
const templates = require('../../utils/templates.js');
const storage = require('../../utils/storage.js');
const watermark = require('../../utils/watermark.js');
const ocr = require('../../utils/ocr.js');

Page({
  data: {
    template: null,
    templates: [],
    values: {},
    photo: null,
    photoInfo: null,
    stage: 'camera',
    ocrResult: null,
    verifyIssues: [],
    showTplPicker: false
  },

  ctx: null,
  canvas: null,

  onLoad(options) {
    const tplId = options.templateId || 'simple';
    const tpl = templates.getTemplateById(tplId);
    this.setData({
      template: tpl,
      templates: templates.TEMPLATES,
      values: templates.getDefaultValues(tpl)
    });

    // 获取相机 context（旧版兼容）
    this.ctx = wx.createCameraContext();
  },

  onReady() {
    const query = wx.createSelectorQuery();
    query.select('#wmCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (res && res[0] && res[0].node) {
          this.canvas = res[0].node;
          this.ctx2d = res[0].node.getContext('2d');
        }
      });
  },

  // 切换模板
  onTplTap() {
    this.setData({ showTplPicker: true });
  },

  onPickTemplate(e) {
    const id = e.currentTarget.dataset.id;
    const tpl = templates.getTemplateById(id);
    this.setData({
      template: tpl,
      values: templates.getDefaultValues(tpl, { location: this.data.values.location }),
      showTplPicker: false
    });
  },

  closePicker() {
    this.setData({ showTplPicker: false });
  },

  // 字段输入
  onFieldInput(e) {
    const key = e.currentTarget.dataset.key;
    const val = e.detail.value;
    const values = Object.assign({}, this.data.values, { [key]: val });
    this.setData({ values });
  },

  onSelectChange(e) {
    const key = e.currentTarget.dataset.key;
    const range = e.currentTarget.dataset.range;
    const idx = e.detail.value;
    const values = Object.assign({}, this.data.values, { [key]: range[idx] });
    this.setData({ values });
  },

  // 获取定位
  onGetLocation() {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        // 简单地把经纬度拼到 location；如需精确地址，可接入地图 SDK
        const location = '定位 ' + res.latitude.toFixed(4) + ',' + res.longitude.toFixed(4);
        const values = Object.assign({}, this.data.values, { location });
        this.setData({ values });
        wx.showToast({ title: '已获取定位', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '获取定位失败', icon: 'none' });
      }
    });
  },

  // 使用当前时间刷新
  onRefreshTime() {
    const now = new Date();
    const values = Object.assign({}, this.data.values);
    const fields = this.data.template.fields || [];
    fields.forEach((f) => {
      if (f.type === 'datetime') values[f.key] = templates.formatDateTime(now);
      if (f.type === 'date') values[f.key] = templates.formatDate(now);
      if (f.type === 'time') values[f.key] = templates.formatTime(now);
    });
    this.setData({ values });
  },

  // 拍照
  onTakePhoto() {
    if (!this.validate()) return;
    this.ctx.takePhoto({
      quality: 'high',
      success: (res) => {
        wx.getImageInfo({
          src: res.tempImagePath,
          success: (info) => {
            this.setData({
              photo: res.tempImagePath,
              photoInfo: { width: info.width, height: info.height },
              stage: 'preview'
            });
          },
          fail: () => {
            this.setData({
              photo: res.tempImagePath,
              photoInfo: { width: 1080, height: 1440 },
              stage: 'preview'
            });
          }
        });
      },
      fail: () => {
        wx.showToast({ title: '拍照失败', icon: 'none' });
      }
    });
  },

  // 从相册选择
  onPickImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: (res) => {
        const file = res.tempFiles[0];
        wx.getImageInfo({
          src: file.tempFilePath,
          success: (info) => {
            this.setData({
              photo: file.tempFilePath,
              photoInfo: { width: info.width, height: info.height },
              stage: 'preview'
            });
          }
        });
      }
    });
  },

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

  // 返回重拍
  onRetake() {
    this.setData({
      photo: null,
      photoInfo: null,
      stage: 'camera',
      ocrResult: null,
      verifyIssues: []
    });
  },

  // 合成水印并保存
  async onSave() {
    if (!this.ctx2d || !this.canvas) {
      wx.showToast({ title: 'Canvas 未就绪', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '生成水印...', mask: true });
    try {
      await watermark.drawWatermark({
        ctx: this.ctx2d,
        canvas: this.canvas,
        imagePath: this.data.photo,
        template: this.data.template,
        values: this.data.values,
        imgW: this.data.photoInfo.width,
        imgH: this.data.photoInfo.height
      });
      const outPath = await watermark.canvasToTempFilePath(this.canvas);
      // 尝试识别 OCR（若云函数可用），失败则跳过
      let ocrResult = null;
      try {
        ocrResult = await ocr.recognize(outPath);
      } catch (e) {
        ocrResult = null;
      }
      const issues = ocr.verify(this.data.values, ocrResult);

      // 保存到本地存储
      const record = {
        id: storage.genId(),
        templateId: this.data.template.id,
        templateName: this.data.template.name,
        values: this.data.values,
        imagePath: outPath,
        originalPath: this.data.photo,
        width: this.canvas.width,
        height: this.canvas.height,
        createdAt: Date.now(),
        ocr: ocrResult || null,
        verifyIssues: issues || []
      };
      storage.add(record);

      // 保存到相册
      try {
        await new Promise((resolve, reject) => {
          wx.saveImageToPhotosAlbum({
            filePath: outPath,
            success: resolve,
            fail: reject
          });
        });
      } catch (e) {
        // 用户拒绝或无权限不阻塞
      }

      wx.hideLoading();
      const hasIssues = issues && issues.length > 0;
      wx.showModal({
        title: hasIssues ? '已保存，请确认' : '保存成功',
        content: hasIssues
          ? '已入库。' + issues.map((i) => '· ' + i.message).join('\n')
          : '照片已带水印并与数据关联入库。',
        showCancel: false,
        success: () => {
          wx.redirectTo({ url: '/pages/detail/detail?id=' + record.id });
        }
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '生成失败', icon: 'none' });
      console.error(e);
    }
  }
});
