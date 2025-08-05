// 获取应用实例
const app = getApp()
const db = wx.cloud.database()
const _ = db.command

Page({
  data: {
    userInfo: null,
    roomId: '',
    roomInfo: null,
    baseScore: 0,
    totalPot: 0,
    players: [],
    gameStatus: 'waiting', // waiting, playing, ended
    isReady: false,
    isCurrentPlayer: false,
    showRaiseInput: false,
    raiseAmount: '',
    showCompareSelect: false,
    activePlayers: [],
    chatMessages: [],
    chatInput: '',
    canSendChat: true,
    lastChatTime: 0,
    chatCollapsed: false // 聊天收起状态
  },

  onLoad: function (options) {
    if (options.roomId) {
      // 初始化时强制设置isReady为false
      this.setData({
        roomId: options.roomId,
        userInfo: app.globalData.userInfo,
        isReady: false // 默认未准备
      })
      console.log('页面加载，设置isReady为false');
      
      // 先获取房间信息，获取初始积分
      wx.cloud.callFunction({
        name: 'roomManage',
        data: {
          type: 'getRoomInfo',
          roomId: options.roomId
        }
      }).then(res => {
        if (res.result && res.result.success && res.result.roomInfo) {
          console.log('getRoomInfo返回:', res.result.roomInfo);
          const initialScore = res.result.roomInfo.initialScore || 0;
          
          // 再次确保在加入房间前设置isReady为false
          this.setData({
            isReady: false
          });
          console.log('加入房间前，再次设置isReady为false');
          
          this.joinRoom(initialScore);
          
          // 确保在设置监听前isReady为false
          this.setData({
            isReady: false
          });
          console.log('设置监听前，再次设置isReady为false');
          
          this.setupRoomListener();
        } else {
        wx.showToast({
          title: '房间信息获取失败',
          icon: 'none'
        })
        setTimeout(() => {
          wx.navigateBack()
        }, 1500)
        }
      }).catch(err => {
      wx.showToast({
        title: '房间信息获取失败: ' + err.message,
        icon: 'none'
      })
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
      })
    } else {
      wx.showToast({
        title: '房间号不存在',
        icon: 'none'
      })
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
    }
  },

  // 页面生命周期函数--监听页面初次渲染完成
  onReady: function() {
    console.log('页面生命周期函数onReady被调用 - 时间:', new Date().toLocaleString());
    console.log('当前页面状态 - isReady:', this.data.isReady, '- gameStatus:', this.data.gameStatus);
    
    // 确保房间监听已设置
    if (!this.roomListener && this.data.roomId) {
      console.log('onReady中设置房间监听');
      this.setupRoomListener();
    } else {
      console.log('房间监听已设置或房间ID不存在');
    }
  },

  onUnload: function () {
    // 离开页面时取消监听
    if (this.roomListener) {
      this.roomListener.close()
    }
    if (this.gameListener) {
      this.gameListener.close()
    }
    // 调用云函数离开房间
    this.leaveRoom()
  },

  // 加入房间
  joinRoom: function (initialScore) {
    wx.showLoading({
      title: '加入房间中',
    })

    // 先确保isReady为false
    this.setData({
      isReady: false
    });
    
    // 确保用户信息中包含头像URL和昵称，并清理URL中的空格、引号和反引号
    let userInfo = this.data.userInfo;
    console.log('原始用户信息:', JSON.stringify(userInfo));
    
    // 确保有昵称
    if (!userInfo.nickName) {
      // 如果没有nickName但有昵称相关字段，尝试使用它
      if (userInfo.nickname) {
        userInfo.nickName = userInfo.nickname;
      } else {
        userInfo.nickName = '玩家';
      }
      console.log('设置用户昵称:', userInfo.nickName);
    }
    
    // 确保有头像
    if (!userInfo.avatarUrl) {
      userInfo.avatarUrl = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0';
    } else {
      // 清理头像URL
      // 移除所有空格
      userInfo.avatarUrl = userInfo.avatarUrl.replace(/\s+/g, '');
      // 移除URL两端可能存在的引号和反引号
      if ((userInfo.avatarUrl.startsWith('"') || userInfo.avatarUrl.startsWith('\'') || userInfo.avatarUrl.startsWith('`')) && 
          (userInfo.avatarUrl.endsWith('"') || userInfo.avatarUrl.endsWith('\'') || userInfo.avatarUrl.endsWith('`'))) {
        userInfo.avatarUrl = userInfo.avatarUrl.substring(1, userInfo.avatarUrl.length - 1);
      }
      // 移除URL中间可能存在的反引号
      userInfo.avatarUrl = userInfo.avatarUrl.replace(/`/g, '');
    }
    
    console.log('准备加入房间:', this.data.roomId);
    console.log('初始积分:', initialScore);
    console.log('用户信息:', JSON.stringify(userInfo));
    console.log('准备状态:', this.data.isReady);
    wx.cloud.callFunction({
      name: 'roomManage',
      data: {
        type: 'joinRoom',
        roomId: this.data.roomId,
        initialScore: initialScore,
        userInfo: userInfo
      }
    }).then(res => {
      wx.hideLoading();
      console.log('joinRoom 云函数返回:', JSON.stringify(res.result));
      
      if (res.result && res.result.success) {
        const roomInfo = res.result.roomInfo;
        console.log('获取到的房间信息:', JSON.stringify(roomInfo));
        
        // 强制设置isReady为false
        const formattedPlayers = this.formatPlayers(roomInfo.players);
        console.log('加入房间后，格式化的玩家列表:', JSON.stringify(formattedPlayers));
        
        this.setData({
          roomInfo: roomInfo,
          players: formattedPlayers,
          baseScore: roomInfo.baseScore,
          gameStatus: roomInfo.status,
          isReady: false // 确保玩家进入房间后不会自动准备
        }, () => {
          console.log('页面数据更新完成, players:', JSON.stringify(this.data.players));
          // 强制刷新页面
          this.forceUpdate();
        });
        
        // 确保数据库中的isReady也为false
        const myPlayer = roomInfo.players.find(p => p.openId === this.data.userInfo.openId);
        if (myPlayer) {
          console.log('加入房间后，检查isReady状态 - 数据库:', myPlayer.isReady, '前端:', this.data.isReady);
          
          // 无论数据库中的isReady是什么值，都强制设置为false
          console.log('加入房间后，强制设置数据库中isReady为false');
          wx.cloud.callFunction({
            name: 'gameLogic',
            data: {
              action: 'playerReady',
              roomId: this.data.roomId,
              isReady: false
            }
          }).then(res => {
            if (res.result && res.result.success) {
              console.log('成功更新数据库中的isReady状态为false');
              // 再次确认前端状态为false
              this.setData({
                isReady: false
              }, () => {
                // 在回调中再次验证状态
                console.log('playerReady回调后，再次确认前端isReady为false:', this.data.isReady);
              });
            } else {
              console.error('更新数据库中的isReady状态失败:', res.result.message);
            }
          }).catch(err => {
            console.error('调用playerReady云函数失败:', err);
          });
        }
        console.log('玩家加入房间，设置isReady为false');
        // 如果是“您已在房间中”的成功，则不返回大厅
        if (res.result.message === '您已在房间中') {
          wx.showToast({
            title: '您已在房间中，已更新信息',
            icon: 'success'
          });
        } else {
          wx.showToast({
            title: '加入房间成功',
            icon: 'success'
          });
        }
      } else {
        wx.showToast({
          title: res.result.message || '加入房间失败',
          icon: 'none'
        })
        setTimeout(() => {
          wx.navigateBack()
        }, 1500)
      }
    }).catch(err => {
      wx.hideLoading()
      wx.showToast({
        title: '加入房间失败: ' + err.message,
        icon: 'none'
      })
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
    })
  },

  // 离开房间
  leaveRoom: function () {
    wx.showLoading({
      title: '离开房间中',
    })

    wx.cloud.callFunction({
      name: 'roomManage',
      data: {
        type: 'leaveRoom',
        roomId: this.data.roomId
      }
    }).then(res => {
      wx.hideLoading()
      if (res.result && res.result.success) {
        wx.showToast({
          title: res.result.message || '已离开房间',
          icon: 'success'
        })
        // 无论什么情况，都返回大厅
        setTimeout(() => {
          wx.navigateBack()
        }, 1000)
      } else {
        wx.showToast({
          title: res.result.message || '离开房间失败',
          icon: 'none'
        })
      }
    }).catch(err => {
      wx.hideLoading()
      wx.showToast({
        title: '离开房间失败: ' + err.message,
        icon: 'none'
      })
    })
  },
  
  // 离开房间按钮点击事件
  onLeaveRoom: function () {
    wx.showModal({
      title: '提示',
      content: '确定要离开房间吗？',
      success: (res) => {
        if (res.confirm) {
          this.leaveRoom()
        }
      }
    })
  },

  // 设置房间数据监听
  setupRoomListener: function () {
    console.log('设置房间监听, roomId:', this.data.roomId);
    const db = wx.cloud.database();
    // 监听房间信息变化
    this.roomListener = db.collection('rooms')
      .where({ roomId: this.data.roomId })
      .watch({
        onChange: snapshot => {
          console.log('收到房间数据变化, type:', snapshot.type);
          console.log('snapshot.docChanges:', JSON.stringify(snapshot.docChanges));
          
          // 确保能处理所有类型的数据变化，包括type为undefined的情况
          console.log('处理房间数据变化，snapshot.type:', snapshot.type);
          
          // 检查是否有docChanges数据
          if (snapshot.docChanges && snapshot.docChanges.length > 0) {
            console.log('检测到docChanges数据变化，长度:', snapshot.docChanges.length);
            snapshot.docChanges.forEach((change, index) => {
              console.log(`docChange[${index}]:`, JSON.stringify(change));
            });
          }
          
          // 无论snapshot.type是什么，都尝试处理数据
          // 确保有文档数据
          if (!snapshot.docs || snapshot.docs.length === 0) {
            console.error('房间数据更新: 没有找到文档数据');
            return;
          }
          
          const roomData = snapshot.docs[0];
          if (roomData) {
            console.log('房间数据更新:', JSON.stringify(roomData));
            const players = roomData.players || [];
            console.log('房间玩家列表:', JSON.stringify(players));
            console.log('玩家昵称列表:', players.map(p => p.nickname).join(', '));
              
              // 确保所有玩家都有头像URL和昵称，并清理URL中的空格、引号和反引号
              players.forEach(player => {
                // 处理昵称
                if (!player.nickName && player.nickname) {
                  player.nickName = player.nickname;
                } else if (!player.nickname && player.nickName) {
                  player.nickname = player.nickName;
                } else if (!player.nickname && !player.nickName) {
                  player.nickname = '玩家';
                  player.nickName = '玩家';
                }
                
                console.log(`处理玩家 ${player.openId} 的昵称:`, JSON.stringify({
                  nickName: player.nickName,
                  nickname: player.nickname
                }));
                
                // 处理头像
                if (!player.avatarUrl) {
                  player.avatarUrl = 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0';
                } else {
                  // 清理头像URL
                  // 移除所有空格
                  player.avatarUrl = player.avatarUrl.replace(/\s+/g, '');
                  // 移除URL两端可能存在的引号和反引号
                  if ((player.avatarUrl.startsWith('"') || player.avatarUrl.startsWith('\'') || player.avatarUrl.startsWith('`')) && 
                      (player.avatarUrl.endsWith('"') || player.avatarUrl.endsWith('\'') || player.avatarUrl.endsWith('`'))) {
                    player.avatarUrl = player.avatarUrl.substring(1, player.avatarUrl.length - 1);
                  }
                  // 移除URL中间可能存在的反引号
                  player.avatarUrl = player.avatarUrl.replace(/`/g, '');
                }
              });
              
              const formattedPlayers = this.formatPlayers(players);
              console.log('格式化后的玩家列表:', JSON.stringify(formattedPlayers));

              // 更新页面数据
              this.setData({
                roomInfo: roomData,
                players: formattedPlayers,
                gameStatus: roomData.status,
                baseScore: roomData.baseScore
              }, () => {
                console.log('页面数据更新完成，当前玩家列表:', JSON.stringify(this.data.players));
                // 强制刷新页面
                this.forceUpdate();
              });

              // 获取当前玩家信息
              const myPlayer = players.find(p => p.openId === this.data.userInfo.openId);
              console.log('当前玩家信息:', myPlayer ? JSON.stringify(myPlayer) : '未找到当前玩家');
              
              // 同步isReady状态
              if (myPlayer && myPlayer.isReady !== this.data.isReady) {
                console.log('同步isReady状态:', myPlayer.isReady);
                this.setData({ isReady: myPlayer.isReady });
              }
              // 如果游戏状态变为playing，则设置游戏监听
              if (roomData.status === 'playing' && roomData.currentGameId && !this.gameListener) {
                this.setupGameListener(roomData.currentGameId)
              }
          } else if (snapshot.type === 'remove') {
            console.log('房间被删除');
            // 房间被删除
            wx.showToast({
              title: '房间已被解散',
              icon: 'none'
            });
            // 返回大厅
            setTimeout(() => {
              wx.navigateBack();
            }, 1500);
          }
        },
        onError: err => {
          console.error('房间监听错误:', err.code, err.message, err);
          wx.showToast({
            title: '房间监听失败: ' + (err.message || err.code),
            icon: 'none',
            duration: 3000
          });
        }
      })
  },

  // 设置游戏数据监听
  setupGameListener: function (gameId) {
    this.gameListener = db.collection('games')
      .where({ gameId: gameId })
      .watch({
        onChange: snapshot => {
          if (snapshot.type === 'init' || snapshot.type === 'update') {
            const gameData = snapshot.docs[0]
            if (gameData) {
              // 更新游戏相关数据
              this.updateGameData(gameData)
            }
          }
        },
        onError: err => {
          console.error('游戏监听错误:', err)
        }
      })
  },

  // 更新游戏数据
  updateGameData: function (gameData) {
    // 更新总下注池
    this.setData({
      totalPot: gameData.totalPot || 0
    })

    // 更新玩家数据（手牌、下注等）
    const updatedPlayers = this.data.players.map(player => {
      const playerGameData = gameData.players.find(p => p.openId === player.openId)
      if (playerGameData) {
        return {
          ...player,
          handCards: playerGameData.handCards || [],
          currentBet: playerGameData.currentBet || 0,
          totalBet: playerGameData.totalBet || 0,
          status: playerGameData.status || player.status
        }
      }
      return player
    })

    // 判断当前是否轮到自己操作
    const isCurrentPlayer = gameData.currentPlayerIndex !== undefined && 
                           gameData.players[gameData.currentPlayerIndex]?.openId === this.data.userInfo.openId

    // 获取活跃玩家（用于比牌选择）
    const activePlayers = updatedPlayers.filter(p => p.status === 'playing')

    this.setData({
      players: updatedPlayers,
      isCurrentPlayer: isCurrentPlayer,
      activePlayers: activePlayers
    })

    // 如果游戏结束，显示结果
    if (gameData.status === 'ended') {
      this.showGameResult(gameData)
    }
  },

  // 格式化玩家数据
  // 格式化玩家列表，当前用户始终在底部，其他玩家在两侧
  formatPlayers: function (players) {
    if (!players || !Array.isArray(players)) {
      console.log('玩家列表无效');
      return [];
    }
    if (!this.data.userInfo || !this.data.userInfo.openId) {
      console.log('当前用户信息不完整');
      return players.map(p => ({
        ...p,
        avatarUrl: p.avatarUrl || 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
        nickname: p.nickName || p.nickname || '玩家',
        isCurrentPlayer: false
      }));
    }
    const myOpenId = this.data.userInfo.openId;
    console.log('当前用户OpenID:', myOpenId);
    // 只保留基础映射，不做任何 fileID 转换和字符串清理
    const processedPlayers = players.map(p => {
      let displayName = '玩家';
      if (p.nickName) {
        displayName = p.nickName;
      } else if (p.nickname) {
        displayName = p.nickname;
      }
      return {
        ...p,
        avatarUrl: p.avatarUrl || 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
        nickname: displayName,
        isCurrentPlayer: p.openId === myOpenId
      };
    });
    const myIndex = processedPlayers.findIndex(p => p.openId === myOpenId);
    if (myIndex === -1) {
      return processedPlayers;
    }
    const me = processedPlayers.splice(myIndex, 1)[0];
    processedPlayers.push(me);
    return processedPlayers;
  },

  // 检查玩家是否已准备
  checkPlayerReady: function (players, openId) {
    const player = players.find(p => p.openId === openId)
    return player ? player.isReady : false
  },

  // 显示游戏结果
  showGameResult: function (gameData) {
    // 构建结果消息
    let resultMessage = '游戏结束\n'
    
    gameData.players.forEach(player => {
      if (player.handCards && player.handCards.length > 0) {
        const playerInfo = this.data.players.find(p => p.openId === player.openId)
        const nickname = playerInfo ? playerInfo.nickname : '未知玩家'
        
        // 构建牌型描述
        let cardsDesc = player.handCards.map(card => `${card.suit}${card.value}`).join(' ')
        let typeDesc = this.getCardTypeDesc(player.cardType)
        
        resultMessage += `${nickname}: ${cardsDesc} (${typeDesc})\n`
      }
    })
    
    // 显示赢家
    if (gameData.winnerId) {
      const winner = this.data.players.find(p => p.openId === gameData.winnerId)
      if (winner) {
        resultMessage += `\n赢家: ${winner.nickname}, 获得 ${gameData.totalPot} 积分`
      }
    }
    
    wx.showModal({
      title: '游戏结果',
      content: resultMessage,
      showCancel: false,
      success: () => {
        // 重置游戏相关数据
        this.setData({
          isCurrentPlayer: false,
          showRaiseInput: false,
          showCompareSelect: false
        })
      }
    })
  },

  // 获取牌型描述
  getCardTypeDesc: function (cardType) {
    const typeMap = {
      'high_card': '散牌',
      'pair': '对子',
      'straight': '顺子',
      'flush': '同花',
      'straight_flush': '同花顺',
      'three_of_a_kind': '豹子'
    }
    return typeMap[cardType] || '未知牌型'
  },
  
  // 强制刷新页面
  forceUpdate: function() {
    console.log('强制刷新页面');
    // 使用一个空的setData来触发页面重新渲染
    this.setData({
      _forceUpdate: Date.now()
    }, () => {
      console.log('页面强制刷新完成');
    });
  },

  // 准备按钮点击 - 重命名以避免与生命周期函数冲突
  onPlayerReady: function () {
    console.log('onPlayerReady函数被调用 - 时间:', new Date().toLocaleString(), '- 调用堆栈:', new Error().stack);
    
    // 如果已经准备，则取消准备
    if (this.data.isReady) {
      wx.cloud.callFunction({
        name: 'gameLogic',
        data: {
          action: 'playerReady',
          roomId: this.data.roomId,
          isReady: false
        }
      }).then(res => {
        if (res.result && res.result.success) {
          this.setData({
            isReady: false
          })
          console.log('取消准备成功')
        } else {
          wx.showToast({
            title: res.result.message || '取消准备失败',
            icon: 'none'
          })
        }
      }).catch(err => {
        wx.showToast({
          title: '取消准备失败: ' + err.message,
          icon: 'none'
        })
      })
    } else {
      // 如果未准备，则准备
      wx.cloud.callFunction({
        name: 'gameLogic',
        data: {
          action: 'playerReady',
          roomId: this.data.roomId,
          isReady: true
        }
      }).then(res => {
        if (res.result && res.result.success) {
          this.setData({
            isReady: true
          })
          console.log('准备成功')
        } else {
          wx.showToast({
            title: res.result.message || '准备失败',
            icon: 'none'
          })
        }
      }).catch(err => {
        wx.showToast({
          title: '准备失败: ' + err.message,
          icon: 'none'
        })
      })
    }
  },

  // 看牌按钮点击
  onCheck: function () {
    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'checkCards',
        roomId: this.data.roomId
      }
    }).catch(err => {
      wx.showToast({
        title: '操作失败: ' + err.message,
        icon: 'none'
      })
    })
  },

  // 跟注按钮点击
  onFollow: function () {
    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'followBet',
        roomId: this.data.roomId
      }
    }).catch(err => {
      wx.showToast({
        title: '操作失败: ' + err.message,
        icon: 'none'
      })
    })
  },

  // 加注按钮点击
  onRaise: function () {
    this.setData({
      showRaiseInput: true,
      raiseAmount: ''
    })
  },

  // 加注输入变化
  onRaiseInputChange: function (e) {
    this.setData({
      raiseAmount: e.detail.value
    })
  },

  // 确认加注
  confirmRaise: function () {
    const amount = parseInt(this.data.raiseAmount)
    if (isNaN(amount) || amount <= 0) {
      wx.showToast({
        title: '请输入有效金额',
        icon: 'none'
      })
      return
    }

    this.setData({
      showRaiseInput: false
    })

    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'raiseBet',
        roomId: this.data.roomId,
        amount: amount
      }
    }).catch(err => {
      wx.showToast({
        title: '操作失败: ' + err.message,
        icon: 'none'
      })
    })
  },

  // 取消加注
  cancelRaise: function () {
    this.setData({
      showRaiseInput: false
    })
  },

  // 比牌按钮点击
  onCompare: function () {
    // 获取可比牌的玩家（状态为playing且不是自己）
    const comparablePlayers = this.data.players.filter(player => 
      player.status === 'playing' && player.openId !== this.data.userInfo.openId
    )

    if (comparablePlayers.length === 0) {
      wx.showToast({
        title: '没有可比牌的玩家',
        icon: 'none'
      })
      return
    }

    this.setData({
      showCompareSelect: true,
      activePlayers: comparablePlayers
    })
  },

  // 确认比牌
  confirmCompare: function (e) {
    const targetPlayerId = e.currentTarget.dataset.playerId

    this.setData({
      showCompareSelect: false
    })

    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'compareCards',
        roomId: this.data.roomId,
        targetPlayerId: targetPlayerId
      }
    }).catch(err => {
      wx.showToast({
        title: '操作失败: ' + err.message,
        icon: 'none'
      })
    })
  },

  // 取消比牌
  cancelCompare: function () {
    this.setData({
      showCompareSelect: false
    })
  },

  // 弃牌按钮点击
  onFold: function () {
    wx.showModal({
      title: '确认弃牌',
      content: '确定要弃牌吗？弃牌后将退出本局游戏。',
      success: (res) => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'gameLogic',
            data: {
              action: 'foldCards',
              roomId: this.data.roomId
            }
          }).catch(err => {
            wx.showToast({
              title: '操作失败: ' + err.message,
              icon: 'none'
            })
          })
        }
      }
    })
  },

  // 聊天输入变化
  onChatInputChange: function (e) {
    this.setData({
      chatInput: e.detail.value
    })
  },

  // 聊天收起/展开
  toggleChatCollapse: function () {
    this.setData({
      chatCollapsed: !this.data.chatCollapsed
    })
  },

  // 发送聊天消息
  sendChatMessage: function () {
    if (!this.data.canSendChat) return;
    const now = Date.now();
    if (now - this.data.lastChatTime < 1000) {
      wx.showToast({ title: '发送过快', icon: 'none' });
      return;
    }
    const content = this.data.chatInput.trim();
    if (!content) return;
    const userInfo = this.data.userInfo;
    const newMsg = {
      nickname: userInfo.nickName,
      avatarUrl: userInfo.avatarUrl,
      openId: userInfo.openId,
      content: content,
      time: now
    };
    // 这里假设chatMessages同步到云端，简化为本地追加
    this.setData({
      chatMessages: this.data.chatMessages.concat(newMsg),
      chatInput: '',
      lastChatTime: now
    });
    // 可根据实际需求同步到云端
  },
})