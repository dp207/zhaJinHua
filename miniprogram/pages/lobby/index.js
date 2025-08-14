Page({
  data: {
    userInfo: {},
    matching: false,
    countdown: 30,
    timeout: false,
    timer: null,
    showCreateRoomModal: false,
    showJoinRoomModal: false,
    showRulesModal: false, // 游戏规则弹窗
    showUserInfoModal: false, // 玩家信息弹窗
    roomType: 'private', // 默认私人房间
    baseScore: 10, // 默认底分
    initialScore: 1000, // 默认初始积分
    inputRoomId: '' // 输入的房间号
  },
  onLoad() {
    const userInfo = wx.getStorageSync('userInfo');
    console.log('userInfo111111111', userInfo);
    if (userInfo) {
      // 如果没有积分信息，默认设置为1000
      if (!userInfo.score) {
        userInfo.score = 10000;
      }
      // 确保有昵称信息，如果没有则设置默认昵称
      if (!userInfo.nickname) {
        userInfo.nickname = '玩家';
      }
      this.setData({ userInfo });
    }
  },
  
  // 显示玩家信息
  showUserInfo() {
    this.setData({
      showUserInfoModal: true
    });
  },
  
  // 隐藏玩家信息
  hideUserInfo() {
    this.setData({
      showUserInfoModal: false
    });
  },
  onMatchTap() {
    // 直接提示暂未开放
    wx.showToast({
      title: '暂未开放',
      icon: 'none',
      duration: 2000
    });
    return;
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
    // 始终保持私人类型
    this.setData({
      roomType: 'private'
    });
    
    // 如果尝试选择公开类型，提示用户
    if (e.detail.value === 'public') {
      wx.showToast({
        title: '公开房间暂不可用',
        icon: 'none',
        duration: 2000
      });
    }
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

  doNothing(e) {
    // 阻止事件冒泡
    e.stopPropagation();
  },

  // 显示游戏规则
  showGameRules() {
    this.setData({
      showRulesModal: true
    });
  },
  
  // 隐藏游戏规则
  hideGameRules() {
    this.setData({
      showRulesModal: false
    });
  },

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
    // 强制使用私人类型
    const { baseScore, initialScore, userInfo } = this.data;
    const roomType = 'private';

    if (!baseScore || baseScore <= 0) {
      wx.showToast({
        title: '底分不能为0或负数',
        icon: 'none'
      });
      return;
    }

    console.log('confirmCreateRoom+++:', roomType, baseScore, initialScore, userInfo)
    if (!initialScore || initialScore <= 0) {
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
