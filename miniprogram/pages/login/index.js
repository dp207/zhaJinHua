const app = getApp();
// 使用空白头像作为默认值，让我们的自定义背景图案显示出来
const defaultAvatarUrl = ''

Page({
  data: {
    userInfo: {
      avatarUrl: defaultAvatarUrl,
      nickName: '',
    },
    hasUserInfo: false,
    canIUseGetUserProfile: wx.canIUse('getUserProfile'),
    canIUseNicknameComp: wx.canIUse('input.type.nickname'),
  },
  onLoad: function () {},

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail
    const { nickName } = this.data.userInfo
    // 判断是否为本地临时路径（wxfile:// 或 http://tmp/）
    if (/^(wxfile:|http:\/\/tmp)/.test(avatarUrl)) {
      wx.showLoading({ title: '上传头像中...' })
      wx.cloud.uploadFile({
        cloudPath: `avatar-${Date.now()}.png`,
        filePath: avatarUrl,
      }).then(res => {
        // 上传成功后，获取可访问的 http(s) 临时链接
        wx.cloud.getTempFileURL({
          fileList: [res.fileID]
        }).then(urlRes => {
          const tempUrl = urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL ? urlRes.fileList[0].tempFileURL : res.fileID;
          this.setData({
            "userInfo.avatarUrl": tempUrl,
            hasUserInfo: nickName && tempUrl && tempUrl !== defaultAvatarUrl,
          })
        }).catch(() => {
          // 若获取临时链接失败，仍使用 fileID 兜底
          this.setData({
            "userInfo.avatarUrl": res.fileID,
            hasUserInfo: nickName && res.fileID && res.fileID !== defaultAvatarUrl,
          })
        })
      }).catch(() => {
        wx.showToast({ title: '头像上传失败', icon: 'none' })
      }).finally(() => {
        wx.hideLoading()
      })
    } else {
      this.setData({
        "userInfo.avatarUrl": avatarUrl,
        hasUserInfo: nickName && avatarUrl && avatarUrl !== defaultAvatarUrl,
      })
    }
  },
  onInputChange(e) {
    const nickName = e.detail.value
    const { avatarUrl } = this.data.userInfo
    this.setData({
      "userInfo.nickName": nickName,
      hasUserInfo: nickName && avatarUrl && avatarUrl !== defaultAvatarUrl,
    })
  },
  getUserProfile: function (e) {
    wx.getUserProfile({
      desc: '用于完善会员资料',
      success: (res) => {
        this.setData({
          userInfo: res.userInfo,
          hasUserInfo: true
        })
      },
      fail: () => {
        wx.showModal({
          title: '授权失败',
          content: '您拒绝了授权，将无法使用部分功能。',
          showCancel: false,
          confirmText: '确定'
        });
      }
    });
  },
  login: function() {
    const { nickName, avatarUrl } = this.data.userInfo;
    if (!nickName || !avatarUrl || avatarUrl === defaultAvatarUrl) {
      wx.showToast({
        title: '请先完善头像和昵称',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    wx.login({
      success: loginRes => {
        if (loginRes.code) {
          wx.cloud.callFunction({
            name: 'login',
            data: {
              code: loginRes.code,
              nickname: nickName,
              avatarUrl: avatarUrl
            },
            success: cloudRes => {
              if (cloudRes.result.code === 0) {
                app.globalData.userInfo = cloudRes.result.data;
                wx.setStorageSync('userInfo', cloudRes.result.data);
                wx.showToast({
                  title: '登录成功',
                  icon: 'success',
                  duration: 1000
                });
                setTimeout(() => {
                  wx.reLaunch({
                    url: '/pages/lobby/index',
                  });
                }, 1000);
              } else {
                wx.showToast({
                  title: cloudRes.result.message || '登录失败',
                  icon: 'none',
                  duration: 2000
                });
              }
            },
            fail: err => {
              console.error('[云函数] [login] 调用失败', err);
              wx.showToast({
                title: '登录失败，请稍后再试',
                icon: 'none',
                duration: 2000
              });
            }
          });
        } else {
          console.log('登录失败！' + loginRes.errMsg);
          wx.showToast({
            title: '登录失败，请重试',
            icon: 'none',
            duration: 2000
          });
        }
      }
    });
  }
});