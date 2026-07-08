Component({
  properties: {
    title: {
      type: String,
      value: ''
    },
    showHome: {
      type: Boolean,
      value: true
    }
  },
  data: {
    statusBarHeight: 0,
    navBarHeight: 0,
    menuBtnRightPadding: 0,
    totalNavBarHeight: 0
  },
  attached() {
    this.calcNavSize();
  },
  methods: {
    calcNavSize() {
      var winInfo = wx.getWindowInfo();
      var menuBtn = wx.getMenuButtonBoundingClientRect();
      var statusBarHeight = winInfo.statusBarHeight;

      // 导航栏主体高度 = (胶囊顶部 - 状态栏高度) * 2 + 胶囊高度
      // 确保左侧按钮与右上角胶囊垂直居中对齐
      var navBarHeight = (menuBtn.top - statusBarHeight) * 2 + menuBtn.height;
      var totalNavBarHeight = statusBarHeight + navBarHeight;

      // 右侧防遮挡宽度 = 屏幕宽度 - 胶囊左边缘坐标
      var menuBtnRightPadding = winInfo.windowWidth - menuBtn.left;

      this.setData({
        statusBarHeight: statusBarHeight,
        navBarHeight: navBarHeight,
        menuBtnRightPadding: menuBtnRightPadding,
        totalNavBarHeight: totalNavBarHeight
      });

      // 抛出总高度，供页面设置 margin-top
      this.triggerEvent('navReady', { totalNavBarHeight: totalNavBarHeight });
    },

    onBack() {
      var pageList = getCurrentPages();
      if (pageList.length > 1) {
        wx.navigateBack({ delta: 1 });
      } else {
        wx.reLaunch({ url: '/pages/index/index' });
      }
    },

    toHome() {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  }
})
