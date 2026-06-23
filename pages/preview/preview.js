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
    wmWidthRatio: 0.42,
    imgScale: 1,
    scaleLabel: '100%',
    opacityLabel: '85%',
    widthLabel: '42%',
    displayFields: [],
    QUICK_POS: QUICK_POS,
    currentPos: 'br',
    panelCollapsed: false,
    imgDisplayWidth: 300,
    imgDisplayHeight: 400,
    saveBtnStyle: '',   // 保存按钮动态定位样式
    backBtnStyle: ''    // 返回按钮动态定位样式（与保存按钮水平对齐）
  },

  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  wmStartX: 0,
  wmStartY: 0,
  isPinching: false,       // 水印缩放
  isImagePinching: false,  // 图片缩放
  lastPinchDist: 0,
  lastImagePinchDist: 0,
  screenWidth: 0,
  screenHeight: 0,
  wmWidth: 0,
  wmHeight: 0,

  onLoad(options) {
    const sysInfo = wx.getSystemInfoSync();
    this.screenWidth = sysInfo.windowWidth;
    this.screenHeight = sysInfo.windowHeight;

    // 获取微信原生胶囊按钮位置，避免保存按钮被遮挡
    try {
      const capsule = wx.getMenuButtonBoundingClientRect();
      // 保存按钮放在胶囊左侧，间距 12px
      const saveRight = sysInfo.windowWidth - capsule.left + 12;
      const saveTop = capsule.top;
      const btnLineHeight = capsule.height; // 与胶囊同高，保证对齐
      this.setData({
        saveBtnStyle: 'right: ' + saveRight + 'px; top: ' + saveTop + 'px; height: ' + btnLineHeight + 'px; line-height: ' + btnLineHeight + 'px;',
        backBtnStyle: 'left: 12px; top: ' + saveTop + 'px; height: ' + btnLineHeight + 'px; line-height: ' + btnLineHeight + 'px;'
      });
    } catch (e) {
      this.setData({
        saveBtnStyle: 'right: 100px; top: 48px;',
        backBtnStyle: 'left: 12px; top: 48px;'
      });
    }

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

    // 计算图片显示尺寸（必须先计算，后续初始化依赖此值）
    this._calcImgDisplaySize();

    // 初始化水印位置（右中，确保在各种屏幕上都可见）
    const containerW = this.data.imgDisplayWidth;
    const containerH = this.data.imgDisplayHeight;
    this.wmWidth = containerW * 0.42;
    this.wmHeight = 60; // 初始高度较小，水印层实际高度由内容决定
    this.setData({
      wmX: containerW - this.wmWidth - 10,
      wmY: (containerH - this.wmHeight) / 2,
      currentPos: 'cr'
    });
  },

  // 计算图片显示尺寸
  _calcImgDisplaySize() {
    const imgW = this.data.photoInfo.width || 1080;
    const imgH = this.data.photoInfo.height || 1440;
    const ratio = imgW / imgH;

    // 可用区域：顶部工具栏 ~100px，底部面板折叠时 ~50px，展开时 ~180px
    // 以折叠状态计算，让图片尽量铺满；展开后面板会浮在图片上方
    const availableHeight = this.screenHeight - 150;
    const availableWidth = this.screenWidth - 20;

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
    // 使用离屏 Canvas 渲染，无需初始化 DOM Canvas
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

  // === 触摸拖拽（容器级别，覆盖整个图片区域） ===

  // 触摸开始（容器级别 — 图片缩放、水印拖拽）
  onTouchStart(e) {
    if (e.touches.length === 1) {
      this.isDragging = true;
      this.isImagePinching = false;
      this.dragStartX = e.touches[0].clientX;
      this.dragStartY = e.touches[0].clientY;
      this.wmStartX = this.data.wmX;
      this.wmStartY = this.data.wmY;
    } else if (e.touches.length === 2) {
      this.isDragging = false;
      this.isImagePinching = true;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      this.lastImagePinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    }
  },

  // 触摸移动
  onTouchMove(e) {
    if (this.isDragging && e.touches.length === 1) {
      const dx = e.touches[0].clientX - this.dragStartX;
      const dy = e.touches[0].clientY - this.dragStartY;
      let newX = this.wmStartX + dx;
      let newY = this.wmStartY + dy;

      const margin = -20;
      newX = Math.max(margin, Math.min(newX, this.data.imgDisplayWidth - this.wmWidth * 0.3));
      newY = Math.max(margin, Math.min(newY, this.data.imgDisplayHeight - this.wmHeight * 0.3));

      this.setData({ wmX: newX, wmY: newY });
    } else if (this.isPinching && e.touches.length === 2) {
      // 水印缩放（优先于图片缩放）
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      if (this.lastPinchDist > 0) {
        const scale = dist / this.lastPinchDist;
        let newScale = this.data.wmScale * scale;
        newScale = Math.max(0.5, Math.min(newScale, 1.5));
        this.setData({ wmScale: newScale });
      }
      this.lastPinchDist = dist;
    } else if (this.isImagePinching && e.touches.length === 2) {
      // 图片缩放
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      if (this.lastImagePinchDist > 0) {
        const scale = dist / this.lastImagePinchDist;
        let newImgScale = this.data.imgScale * scale;
        newImgScale = Math.max(0.5, Math.min(newImgScale, 3.0));
        this.setData({ imgScale: newImgScale });
      }
      this.lastImagePinchDist = dist;
    }
  },

  // 触摸结束
  onTouchEnd() {
    this.isDragging = false;
    this.isPinching = false;
    this.isImagePinching = false;
    this.lastPinchDist = 0;
    this.lastImagePinchDist = 0;
  },

  // 水印层上的触摸（catch 已阻止冒泡）
  onWmTouchStart(e) {
    if (e.touches.length === 2) {
      // 双指 → 水印缩放（不委托给 onTouchStart，避免被误判为图片缩放）
      this.isPinching = true;
      this.isImagePinching = false;
      this.isDragging = false;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      this.lastPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      return;
    }
    // 单指 → 水印拖拽，委托给容器级处理
    this.onTouchStart(e);
  },

  onWmTouchMove(e) {
    this.onTouchMove(e);
  },

  onWmTouchEnd(e) {
    this.onTouchEnd();
  },

  // 水印缩放滑块
  onScaleChange(e) {
    const v = e.detail.value;
    this.setData({ wmScale: v, scaleLabel: Math.round(v * 100) + '%' });
  },

  // 透明度滑块
  onOpacityChange(e) {
    const v = e.detail.value;
    this.setData({ wmOpacity: v, opacityLabel: Math.round(v * 100) + '%' });
  },

  // 水印宽度滑块
  onWidthChange(e) {
    const v = e.detail.value;
    this.wmWidth = this.data.imgDisplayWidth * v;
    this.setData({ wmWidthRatio: v, widthLabel: Math.round(v * 100) + '%' });
  },

  // 快速定位
  onQuickPos(e) {
    const x = e.currentTarget.dataset.x;
    const y = e.currentTarget.dataset.y;
    const posId = e.currentTarget.dataset.id;
    const cw = this.data.imgDisplayWidth;
    const ch = this.data.imgDisplayHeight;
    let newX, newY;

    if (x === '10%') newX = 10;
    else if (x === '50%') newX = (cw - this.wmWidth) / 2;
    else newX = cw - this.wmWidth - 10;

    if (y === '10%') newY = 10;
    else if (y === '50%') newY = (ch - this.wmHeight) / 2;
    else newY = ch - this.wmHeight - 10;

    this.setData({ wmX: newX, wmY: newY, currentPos: posId });
  },

  // 折叠/展开底部设置面板
  togglePanel() {
    this.setData({ panelCollapsed: !this.data.panelCollapsed });
  },

  // 将临时照片持久化到用户目录，防止被微信回收
  _persistOriginalPhoto(tempPath) {
    return new Promise((resolve) => {
      const fs = wx.getFileSystemManager();
      // 优先用 saveFile（移动并持久化）
      fs.saveFile({
        tempFilePath: tempPath,
        success: (res) => {
          console.log('[Preview] saveFile 成功:', res.savedFilePath);
          resolve(res.savedFilePath);
        },
        fail: (err) => {
          console.warn('[Preview] saveFile 失败，尝试 copyFile:', err);
          // 降级：手动复制到用户目录
          const dest = wx.env.USER_DATA_PATH + '/photo_' + Date.now() + '.jpg';
          fs.copyFile({
            srcPath: tempPath,
            destPath: dest,
            success: () => {
              console.log('[Preview] copyFile 成功:', dest);
              resolve(dest);
            },
            fail: (err2) => {
              console.error('[Preview] 持久化失败，使用临时路径:', err2);
              resolve(tempPath); // 最终降级：保留临时路径
            }
          });
        }
      });
    });
  },

  // 返回
  onBack() {
    wx.navigateBack();
  },

  // 保存（生成水印图片并存入本地记录）
  async onSave() {
    console.log('[Preview] onSave 开始');
    wx.showLoading({ title: '生成水印...', mask: true });

    try {
      const imgW = this.data.photoInfo.width || 1080;
      const imgH = this.data.photoInfo.height || 1440;
      const displayW = this.data.imgDisplayWidth || 300;
      const displayH = this.data.imgDisplayHeight || 400;

      // 坐标转换：容器坐标 → 原图坐标
      const ratioX = imgW / displayW;
      const ratioY = imgH / displayH;
      const actualX = Math.round(this.data.wmX * ratioX);
      const actualY = Math.round(this.data.wmY * ratioY);

      console.log('[Preview] 坐标转换:', { wmX: this.data.wmX, wmY: this.data.wmY, actualX, actualY });

      // 使用离屏 Canvas 渲染水印图片（无需 DOM Canvas）
      const outPath = await watermark.renderWatermarkedImage({
        imagePath: this.data.photo,
        template: this.data.template,
        values: this.data.values,
        imgW: imgW,
        imgH: imgH,
        customX: actualX,
        customY: actualY,
        customScale: this.data.wmScale,
        opacity: this.data.wmOpacity,
        widthRatio: this.data.wmWidthRatio
      });

      console.log('[Preview] 渲染完成:', outPath);

      // 将原始照片从临时路径持久化，防止后续编辑时被微信回收
      const persistentPath = await this._persistOriginalPhoto(this.data.photo);
      console.log('[Preview] 原始照片持久化:', persistentPath);

      const record = {
        id: storage.genId(),
        templateId: this.data.template.id,
        templateName: this.data.template.name,
        watermarkPosition: 'custom',
        watermarkX: actualX,
        watermarkY: actualY,
        watermarkScale: this.data.wmScale,
        watermarkOpacity: this.data.wmOpacity,
        watermarkWidthRatio: this.data.wmWidthRatio,
        values: this.data.values,
        imagePath: outPath,
        originalPath: persistentPath,
        width: imgW,
        height: imgH,
        createdAt: Date.now(),
        ocr: null,
        verifyIssues: []
      };

      storage.add(record);
      console.log('[Preview] 记录已保存:', record.id);

      wx.hideLoading();
      wx.showToast({ title: '已保存到记录', icon: 'success' });

      setTimeout(() => {
        wx.redirectTo({ url: '/pages/detail/detail?id=' + record.id });
      }, 500);

    } catch (e) {
      console.error('[Preview] 保存失败:', e);
      wx.hideLoading();
      wx.showToast({ title: '生成失败: ' + (e.message || '未知错误'), icon: 'none' });
    }
  }
});
