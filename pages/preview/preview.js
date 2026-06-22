// pages/preview/preview.js
const templates = require('../../utils/templates.js');
const storage = require('../../utils/storage.js');
const watermark = require('../../utils/watermark.js');

const QUICK_POS = [
  { id: 'tl', label: '左上', x: '10%', y: '10%' },
  { id: 'tc', label: '上中', x: '50%', y: '10%' },
  { id: 'tr', label: '右上', x: '90%', y: '10%' },
  { id: 'cl', label: '左中', x: '10%', y: '50%' },
  { id: 'cc', label: '居中', x: '50%', y: '50%' },
  { id: 'cr', label: '右中', x: '90%', y: '50%' },
  { id: 'bl', label: '左下', x: '10%', y: '90%' },
  { id: 'bc', label: '下中', x: '50%', y: '90%' },
  { id: 'br', label: '右下', x: '90%', y: '90%' }
];

Page({
  data: {
    photo: '',
    photoInfo: {},
    template: {},
    values: {},
    wmX: 100,
    wmY: 100,
    wmScale: 1,
    wmOpacity: 0.85,
    scaleLabel: '100%',
    opacityLabel: '85%',
    displayFields: [],
    QUICK_POS: QUICK_POS,
    currentPos: 'br',
    imgDisplayWidth: 300,
    imgDisplayHeight: 400
  },

  ctx2d: null,
  canvas: null,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  wmStartX: 0,
  wmStartY: 0,
  isPinching: false,
  lastPinchDist: 0,
  imageWidth: 0,
  imageHeight: 0,
  screenWidth: 0,
  screenHeight: 0,
  wmWidth: 0,
  wmHeight: 0,

  onLoad(options) {
    const sysInfo = wx.getSystemInfoSync();
    this.screenWidth = sysInfo.windowWidth;
    this.screenHeight = sysInfo.windowHeight;

    // 从全局变量获取参数（避免 URL 长度限制问题）
    const app = getApp();
    const previewData = app.globalData && app.globalData.previewData;
    
    let photo = '';
    let photoInfo = { width: 1080, height: 1440 };
    let template = {};
    let values = {};

    if (previewData) {
      photo = previewData.photo || '';
      try {
        photoInfo = JSON.parse(previewData.photoInfo || '{"width":1080,"height":1440}');
      } catch (e) {}
      try {
        template = JSON.parse(previewData.template || '{}');
      } catch (e) {}
      try {
        values = JSON.parse(previewData.values || '{}');
      } catch (e) {}
      // 清空临时数据
      app.globalData.previewData = null;
    } else {
      // 降级使用 URL 参数
      photo = options.photo || '';
      try {
        photoInfo = JSON.parse(options.photoInfo || '{"width":1080,"height":1440}');
      } catch (e) {}
      try {
        template = JSON.parse(options.template || '{}');
      } catch (e) {}
      try {
        values = JSON.parse(options.values || '{}');
      } catch (e) {}
    }

    console.log('preview photo:', photo);
    console.log('preview photoInfo:', photoInfo);

    this.setData({
      photo: photo,
      photoInfo: photoInfo,
      template: template,
      values: values
    });

    // 计算显示字段
    this._calcDisplayFields();

    // 计算图片显示尺寸
    this._calcImgDisplaySize();

    // 初始化水印位置（右下角）
    this.wmWidth = this.screenWidth * 0.42;
    this.wmHeight = 200;
    this.setData({
      wmX: this.screenWidth - this.wmWidth - 20,
      wmY: this.screenHeight - 400 - this.wmHeight
    });
  },

  // 计算图片显示尺寸
  _calcImgDisplaySize() {
    const imgW = this.data.photoInfo.width || 1080;
    const imgH = this.data.photoInfo.height || 1440;
    const ratio = imgW / imgH;
    
    // 可用区域（减去顶部工具栏和底部面板）
    const availableHeight = this.screenHeight - 200 - 100;
    const availableWidth = this.screenWidth - 40;
    
    let displayW, displayH;
    if (ratio > availableWidth / availableHeight) {
      displayW = availableWidth;
      displayH = displayW / ratio;
    } else {
      displayH = availableHeight;
      displayW = displayH * ratio;
    }
    
    this.setData({
      imgDisplayWidth: displayW,
      imgDisplayHeight: displayH
    });
  },

  onReady() {
    wx.createSelectorQuery().select('#wmCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (res && res[0] && res[0].node) {
          this.canvas = res[0].node;
          this.ctx2d = res[0].node.getContext('2d');
        }
      });
  },

  // 计算显示字段
  _calcDisplayFields() {
    const fields = this.data.template.fields || [];
    const values = this.data.values || {};
    const display = fields.map(f => ({
      key: f.key,
      label: f.label || f.key,
      value: values[f.key] || ''
    })).filter(f => f.value);
    this.setData({ displayFields: display });
  },

  // 图片加载成功
  onImgLoad(e) {
    console.log('图片加载成功', e.detail);
  },

  // 图片加载失败
  onImgError(e) {
    console.error('图片加载失败', e.detail);
    wx.showToast({ title: '图片加载失败', icon: 'none' });
  },

  // 触摸开始
  onTouchStart(e) {
    if (e.touches.length === 1) {
      this.isDragging = true;
      this.dragStartX = e.touches[0].clientX;
      this.dragStartY = e.touches[0].clientY;
      this.wmStartX = this.data.wmX;
      this.wmStartY = this.data.wmY;
    } else if (e.touches.length === 2) {
      this.isPinching = true;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      this.lastPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    }
  },

  // 触摸移动
  onTouchMove(e) {
    if (this.isDragging && e.touches.length === 1) {
      const dx = e.touches[0].clientX - this.dragStartX;
      const dy = e.touches[0].clientY - this.dragStartY;
      let newX = this.wmStartX + dx;
      let newY = this.wmStartY + dy;

      // 边界限制
      newX = Math.max(0, Math.min(newX, this.screenWidth - this.wmWidth));
      newY = Math.max(0, Math.min(newY, this.screenHeight - 350 - this.wmHeight));

      this.setData({ wmX: newX, wmY: newY });
    } else if (this.isPinching && e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const scale = dist / this.lastPinchDist;
      let newScale = this.data.wmScale * scale;
      newScale = Math.max(0.5, Math.min(newScale, 1.5));
      this.lastPinchDist = dist;
      this.setData({ wmScale: newScale });
    }
  },

  // 触摸结束
  onTouchEnd() {
    this.isDragging = false;
    this.isPinching = false;
  },

  // 水印层触摸开始（防止穿透）
  onWmTouchStart(e) {
    e.stopPropagation();
    this.onTouchStart(e);
  },

  onWmTouchMove(e) {
    e.stopPropagation();
    this.onTouchMove(e);
  },

  onWmTouchEnd(e) {
    e.stopPropagation();
    this.onTouchEnd();
  },

  // 缩放滑块
  onScaleChange(e) {
    const v = e.detail.value;
    this.setData({ wmScale: v, scaleLabel: Math.round(v * 100) + '%' });
  },

  // 透明度滑块
  onOpacityChange(e) {
    const v = e.detail.value;
    this.setData({ wmOpacity: v, opacityLabel: Math.round(v * 100) + '%' });
  },

  // 快速定位
  onQuickPos(e) {
    const x = e.currentTarget.dataset.x;
    const y = e.currentTarget.dataset.y;
    const posId = e.currentTarget.dataset.id;
    let newX, newY;

    if (x === '10%') newX = 20;
    else if (x === '50%') newX = (this.screenWidth - this.wmWidth) / 2;
    else newX = this.screenWidth - this.wmWidth - 20;

    if (y === '10%') newY = 40;
    else if (y === '50%') newY = (this.screenHeight - 350 - this.wmHeight) / 2;
    else newY = this.screenHeight - 350 - this.wmHeight - 20;

    this.setData({ wmX: newX, wmY: newY, currentPos: posId });
  },

  // 返回
  onBack() {
    wx.navigateBack();
  },

  // 保存（不直接保存到相册，只保存记录）
  async onSave() {
    if (!this.ctx2d || !this.canvas) {
      wx.showToast({ title: 'Canvas 未就绪', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '生成水印...', mask: true });

    try {
      const imgW = this.data.photoInfo.width || 1080;
      const imgH = this.data.photoInfo.height || 1440;
      
      // 计算实际位置和缩放（相对于原图）
      const ratio = imgW / this.screenWidth;
      const actualX = this.data.wmX * ratio;
      const actualY = this.data.wmY * ratio;
      const actualScale = this.data.wmScale;

      console.log('开始绘制水印:', {
        imgW, imgH, actualX, actualY, actualScale,
        canvasWidth: this.canvas.width,
        canvasHeight: this.canvas.height
      });

      await watermark.drawWatermark({
        ctx: this.ctx2d,
        canvas: this.canvas,
        imagePath: this.data.photo,
        template: this.data.template,
        values: this.data.values,
        imgW: imgW,
        imgH: imgH,
        customX: actualX,
        customY: actualY,
        customScale: actualScale,
        opacity: this.data.wmOpacity
      });

      // 使用原始图片尺寸导出，确保高质量
      const outPath = await watermark.canvasToTempFilePath(this.canvas, {
        destWidth: this.canvas.width,
        destHeight: this.canvas.height
      });

      const record = {
        id: storage.genId(),
        templateId: this.data.template.id,
        templateName: this.data.template.name,
        watermarkPosition: 'custom',
        watermarkX: actualX,
        watermarkY: actualY,
        watermarkScale: actualScale,
        watermarkOpacity: this.data.wmOpacity,
        values: this.data.values,
        imagePath: outPath,
        originalPath: this.data.photo,
        width: this.canvas.width,
        height: this.canvas.height,
        createdAt: Date.now(),
        ocr: null,
        verifyIssues: []
      };

      storage.add(record);

      wx.hideLoading();
      wx.showToast({ title: '已保存到记录', icon: 'success' });
      
      // 跳转到详情页
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/detail/detail?id=' + record.id });
      }, 500);

    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '生成失败', icon: 'none' });
      console.error(e);
    }
  }
});
