Page({
  data: {
    userInfo: {},
    matching: false,
    countdown: 30,
    timeout: false,
    timer: null,
    showCreateRoomModal: false,
    showJoinRoomModal: false,
    roomType: 'public', // 默认公开房间
    baseScore: 10, // 默认底分
    initialScore: 1000, // 默认初始积分
    inputRoomId: '' // 输入的房间号
  },
  onLoad() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({ userInfo });
    }
  },
  onMatchTap() {
    if (this.data.matching) return;
    this.setData({ matching: true, countdown: 30, timeout: false });
    this.startCountdown();
  },
  startCountdown() {
    const timer = setInterval(() => {
      let c = this.data.countdown - 1;
      if (c <= 0) {
        clearInterval(this.data.timer);
        this.setData({ matching: false, timeout: true, timer: null });
      } else {
        this.setData({ countdown: c });
      }
    }, 1000);
    this.setData({ timer });
  },
  onUnload() {
    if (this.data.timer) clearInterval(this.data.timer);
  },

  onCreateRoomTap() {
    console.log('onCreateRoomTap triggered');
    this.setData({
      showCreateRoomModal: true
    });
  },

  hideCreateRoomModal() {
    console.log('hideCreateRoomModal triggered');
    this.setData({
      showCreateRoomModal: false
    });
  },
  
  onJoinRoomTap() {
    console.log('onJoinRoomTap triggered');
    this.setData({
      showJoinRoomModal: true,
      inputRoomId: ''
    });
  },

  hideJoinRoomModal() {
    console.log('hideJoinRoomModal triggered');
    this.setData({
      showJoinRoomModal: false
    });
  },
  
  onRoomIdInput(e) {
    this.setData({
      inputRoomId: e.detail.value
    });
  },

  onRoomTypeChange(e) {
    this.setData({
      roomType: e.detail.value
    });
  },

  onBaseScoreInput(e) {
    const value = parseInt(e.detail.value) || 0;
    console.log('onBaseScoreInput:', value);
    this.setData({
      baseScore: value
    });
  },

  onInitialScoreInput(e) {
    const value = parseInt(e.detail.value) || 0;
    console.log('onInitialScoreInput:', value);
    this.setData({
      initialScore: value
    });
  },

  doNothing() {},

  async confirmJoinRoom() {
    const { inputRoomId, userInfo } = this.data;
    
    if (!inputRoomId || inputRoomId.length !== 6) {
      wx.showToast({
        title: '请输入6位房间号',
        icon: 'none'
      });
      return;
    }
    
    wx.showLoading({
      title: '加入房间中',
    });
    
    try {
    
      const res = await wx.cloud.callFunction({
        name: 'roomManage',
        data: {
          type: 'joinRoom',
          roomId: inputRoomId,
          userInfo: userInfo,
        }
      });
      
      wx.hideLoading();
      
      if (res.result && res.result.success) {
        wx.showToast({
          title: '加入房间成功',
          icon: 'success'
        });
        this.hideJoinRoomModal();
        // 跳转到房间页面，使用navigateTo，以便可以返回到大厅
        wx.navigateTo({
          url: `/pages/room/index?roomId=${res.result.roomId}`
        });
      } else {
        wx.showToast({
          title: res.result.message || '加入房间失败',
          icon: 'none'
        });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({
        title: '加入房间失败，请重试',
        icon: 'none'
      });
      console.error('加入房间失败', err);
    }
  },
  
  async confirmCreateRoom() {
    const { roomType, baseScore, initialScore, userInfo } = this.data;

    if (!baseScore || baseScore <= 0) {
      wx.showToast({
        title: '底分不能为0或负数',
        icon: 'none'
      });
      return;
    }

    console.log('confirmCreateRoom+++:', roomType, baseScore, initialScore, userInfo)
    if (roomType === 'private' && (!initialScore || initialScore <= 0)) {
      wx.showToast({
        title: '私人房间初始积分不能为0或负数',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({
      title: '创建房间中',
    });

    try {
      const res = await wx.cloud.callFunction({
        name: 'roomManage',
        data: {
          type: 'createRoom',
          roomType,
          baseScore,
          initialScore: roomType === 'private' ? initialScore : undefined,
          userInfo: userInfo
        }
      });

      wx.hideLoading();

      if (res.result.success) {
        wx.showToast({
          title: '房间创建成功',
          icon: 'success'
        });
        this.hideCreateRoomModal();
        // 跳转到房间页面，使用navigateTo，以便可以返回到大厅
        wx.navigateTo({
          url: `/pages/room/index?roomId=${res.result.roomId}`
        });
      } else {
        wx.showToast({
          title: res.result.message || '房间创建失败',
          icon: 'none'
        });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({
        title: '创建房间失败，请重试',
        icon: 'none'
      });
      console.error('创建房间失败', err);
    }
  }
});
