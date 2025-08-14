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
    chatCollapsed: true, // 聊天默认收起状态
    showPlayerInfoPopup: false, // 玩家信息弹出层显示状态
    selectedPlayer: null, // 当前选中的玩家信息
    showCopyToast: false, // 复制成功提示
    showGameResultPopup: false, // 游戏结果弹窗显示状态
    gameResultMessage: '', // 游戏结果消息
    gameResultScores: [], // 游戏结果积分变化数据
    // 比牌结果提示
    showCompareResult: false,
    comparePlayer1: '',
    comparePlayer2: '',
    compareWin: false,
    // 当前最高下注
    currentMaxBet: 0
  },

  // 复制房间号功能
  copyRoomId: function() {
    wx.setClipboardData({
      data: this.data.roomId,
      success: () => {
        this.setData({
          showCopyToast: true
        });
        // 2秒后隐藏提示
        setTimeout(() => {
          this.setData({
            showCopyToast: false
          });
        }, 2000);
      }
    });
  },

  onLoad: function (options) {
    if (options.roomId) {
      // 初始化时强制设置isReady为false
      this.setData({
        roomId: options.roomId,
        userInfo: app.globalData.userInfo,
        isReady: false // 默认未准备
      })
      // 先获取房间信息，获取初始积分
      wx.cloud.callFunction({
        name: 'roomManage',
        data: {
          type: 'getRoomInfo',
          roomId: options.roomId
        }
      }).then(res => {
        if (res.result && res.result.success && res.result.roomInfo) {
          const initialScore = res.result.roomInfo.initialScore || 0;
          
          // 再次确保在加入房间前设置isReady为false
          this.setData({
            isReady: false
          });
          
          this.joinRoom(initialScore);
          
          // 确保在设置监听前isReady为false
          this.setData({
            isReady: false
          });
          
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
    // 确保房间监听已设置
    if (!this.roomListener && this.data.roomId) {
      this.setupRoomListener();
    }
  },

  onUnload: function () {
    this.autoLeaveIfNeeded('unload');
    if (this._compareResultTimer) {
      clearTimeout(this._compareResultTimer);
      this._compareResultTimer = null;
    }
  },

  // 新增：进入后台或页面隐藏时也自动弃牌并离开，防重复
  //onHide: function () {
  //  this.autoLeaveIfNeeded('hide');
  //},
  
  // 加入房间
  joinRoom: function (initialScore = 1000) {
    wx.showLoading({
      title: '加入房间中',
    })

    // 先确保isReady为false
    this.setData({
      isReady: false
    });
    
    // 确保用户信息中包含头像URL和昵称，并清理URL中的空格、引号和反引号
    let userInfo = this.data.userInfo;
    
    // 确保有昵称
    if (!userInfo.nickName) {
      // 如果没有nickName但有昵称相关字段，尝试使用它
      if (userInfo.nickname) {
        userInfo.nickName = userInfo.nickname;
      } else {
        userInfo.nickName = '玩家';
      }
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
      
      if (res.result && res.result.success) {
        const roomInfo = res.result.roomInfo;
        
        // 强制设置isReady为false
        const formattedPlayers = this.formatPlayers(roomInfo.players);
        
        // 判断当前用户是否是房主
        const isOwner = roomInfo.players.length > 0 && 
                       roomInfo.players[0].openId === this.data.userInfo._openid && 
                       roomInfo.players[0].isOwner;
        
        this.setData({
          roomInfo: roomInfo,
          players: formattedPlayers,
          baseScore: roomInfo.baseScore,
          gameStatus: roomInfo.status,
          isReady: false, // 确保玩家进入房间后不会自动准备
          isCurrentPlayer: isOwner && roomInfo.status === 'waiting' // 如果是房主且房间状态为等待中，则设置为当前玩家
        }, () => {
          // 强制刷新页面
          this.forceUpdate();
        });
        
        // 确保数据库中的isReady也为false
        const myPlayer = roomInfo.players.find(p => p.openId === this.data.userInfo._openid);
        if (myPlayer) {
          // 无论数据库中的isReady是什么值，都强制设置为false
          wx.cloud.callFunction({
            name: 'gameLogic',
            data: {
              action: 'playerReady',
              roomId: this.data.roomId,
              isReady: false
            }
          }).then(res => {
            if (res.result && res.result.success) {
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
    // 防重复调用云函数
    if (this._leftRoom) {
      return;
    }
    this._leftRoom = true;

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
    // 防重复点击
    if (this._leaving) {
      return;
    }

    // 检查当前游戏状态，如果正在游戏中且玩家未弃牌，则提示离开视为放弃
    const isPlaying = this.data.gameStatus === 'playing';
    const myPlayerIndex = this.data.players.findIndex(p => p.openId === this.data.userInfo._openid);
    const hasNotFolded = myPlayerIndex !== -1 && 
                        this.data.players[myPlayerIndex].status === 'playing';
    
    if (isPlaying && hasNotFolded) {
      wx.showModal({
        title: '提示',
        content: '离开房间视为放弃，确定要离开吗？',
        success: (res) => {
          if (res.confirm) {
            // 标记离开进行中并清理监听
            this._leaving = true;
            this.cleanupListeners();
            // 先执行弃牌逻辑
            wx.showLoading({
              title: '处理中...'
            });
            wx.cloud.callFunction({
              name: 'gameLogic',
              data: {
                action: 'foldCards',
                roomId: this.data.roomId,
                isLeaving: true // 标记为离开房间导致的弃牌，绕过轮次校验
              }
            }).then(res => {
              wx.hideLoading();
              // 无论成功与否都继续离开
              this.leaveRoom();
            }).catch(err => {
              wx.hideLoading();
              this.leaveRoom();
            });
          }
        }
      });
    } else {
      // 不在游戏中或已弃牌，直接询问是否离开
      wx.showModal({
        title: '提示',
        content: '确定要离开房间吗？',
        success: (res) => {
          if (res.confirm) {
            // 标记离开进行中并清理监听
            this._leaving = true;
            this.cleanupListeners();
            this.leaveRoom();
          }
        }
      });
    }
  },

  // 新增：统一的自动弃牌并离开处理（用于顶部返回/onUnload、上滑关闭/onHide 等）
  autoLeaveIfNeeded: function (source) {
    // 若已开始离开流程，直接返回
    if (this._leaving) {
      return;
    }
    this._leaving = true;

    // 先清理监听，避免重复触发
    this.cleanupListeners();

    const isPlaying = this.data.gameStatus === 'playing';
    const myPlayerIndex = this.data.players.findIndex(p => p.openId === (this.data.userInfo && this.data.userInfo._openid));
    const hasNotFolded = myPlayerIndex !== -1 && this.data.players[myPlayerIndex].status === 'playing';

    if (isPlaying && hasNotFolded) {
      // 无提示自动弃牌
      wx.cloud.callFunction({
        name: 'gameLogic',
        data: {
          action: 'foldCards',
          roomId: this.data.roomId,
          isLeaving: true
        }
      }).then(() => {
        this.leaveRoom();
      }).catch(() => {
        // 即使弃牌失败也继续离开
        this.leaveRoom();
      });
    } else {
      // 未在游戏或已弃牌，直接离开
      this.leaveRoom();
    }
  },

  // 新增：统一关闭监听
  cleanupListeners: function () {
    try {
      if (this.roomListener) {
        this.roomListener.close();
        this.roomListener = null;
      }
    } catch (e) { }

    try {
      if (this.gameListener) {
        this.gameListener.close();
        this.gameListener = null;
      }
    } catch (e) { }
  },

  // 设置房间数据监听
  setupRoomListener: function () {
    const db = wx.cloud.database();
    // 监听房间信息变化
    this.roomListener = db.collection('rooms')
      .where({ roomId: this.data.roomId })
      .watch({
        onChange: snapshot => {
          // 无论snapshot.type是什么，都尝试处理数据
          // 确保有文档数据
          if (!snapshot.docs || snapshot.docs.length === 0) {
            console.error('房间数据更新: 没有找到文档数据');
            return;
          }
          
          const roomData = snapshot.docs[0];
          if (roomData) {
            const players = roomData.players || [];
              
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

            // 判断当前用户是否是房主
            const isOwner = players.length > 0 && 
                           players[0].openId === this.data.userInfo._openid && 
                           players[0].isOwner;
            
            // 更新页面数据
            this.setData({
              roomInfo: roomData,
              players: formattedPlayers,
              gameStatus: roomData.status,
              baseScore: roomData.baseScore,
              isCurrentPlayer: isOwner && roomData.status === 'waiting' // 如果是房主且房间状态为等待中，则设置为当前玩家
            }, () => {
              // 强制刷新页面
              this.forceUpdate();
            });

            // 获取当前玩家信息
            const myPlayer = players.find(p => p.openId === this.data.userInfo._openid);
            
            // 同步isReady状态
            if (myPlayer && myPlayer.isReady !== this.data.isReady) {
              this.setData({ isReady: myPlayer.isReady });
            }
            
            // 强制重新设置游戏监听，确保数据更新能被捕获
            if (roomData.status === 'playing' && roomData.currentGameId) {
              // 无论是否已有监听器，都重新设置
              this.setupGameListener(roomData.currentGameId);
            }
          } else if (snapshot.type === 'remove') {
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
          
          // 显示错误提示，但不要太频繁打扰用户
          if (retryCount === 0) {
            wx.showToast({
              title: '房间监听连接中断，正在重试...',
              icon: 'none',
              duration: 2000
            });
          }
          
          // 实现重试机制
          if (retryCount < MAX_RETRIES) {
            console.log(`房间监听失败，${RETRY_DELAY/1000}秒后进行第${retryCount + 1}次重试`);
            setTimeout(() => {
              this.setupRoomListener(retryCount + 1);
            }, RETRY_DELAY);
          } else {
            console.error(`房间监听失败，已重试${MAX_RETRIES}次，不再重试`);
            wx.showToast({
              title: '房间连接失败，请退出重进',
              icon: 'none',
              duration: 3000
            });
          }
        }
      });
      
    // 返回监听器实例，方便后续管理
    return this.roomListener;
  },

  // 设置游戏数据监听
  setupGameListener: function (gameId, retryCount = 0) {
    const MAX_RETRIES = 3; // 最大重试次数
    const RETRY_DELAY = 2000; // 重试延迟时间（毫秒）
    
    // 如果已经有监听器，先关闭
    if (this.gameListener) {
      try {
        this.gameListener.close();
        this.gameListener = null;
      } catch (err) {
        console.error('关闭游戏监听器失败:', err);
      }
    }
    
    const db = wx.cloud.database();
    this.gameListener = db.collection('games')
      .where({ gameId: gameId })
      .watch({
        onChange: snapshot => {
          // 修改逻辑，不再严格检查snapshot.type，只要有docs数据就处理
          if (!snapshot.docs || snapshot.docs.length === 0) {
            console.error('游戏数据更新: 没有找到文档数据');
            return;
          }
          
          const gameData = snapshot.docs[0];
          if (gameData) {
            // 更新游戏相关数据
            this.updateGameData(gameData);
          } else {
            console.error('游戏数据为空');
          }
        },
        onError: err => {
          console.error('游戏监听错误:', err.message || err);
          
          // 显示错误提示，但不要太频繁打扰用户
          if (retryCount === 0) {
            wx.showToast({
              title: '游戏数据连接中断，正在重试...',
              icon: 'none',
              duration: 2000
            });
          }
          
          // 实现重试机制
          if (retryCount < MAX_RETRIES) {
            setTimeout(() => {
              this.setupGameListener(gameId, retryCount + 1);
            }, RETRY_DELAY);
          } else {
            console.error(`游戏监听失败，已重试${MAX_RETRIES}次，不再重试`);
            wx.showToast({
              title: '游戏数据连接失败，请退出重进',
              icon: 'none',
              duration: 3000
            });
          }
        }
      });
    
    return this.gameListener;
  },

  // 更新游戏数据
  updateGameData: function (gameData) {
    // 更新总下注池
    try {
      const pot = (gameData.players || []).reduce((acc, p) => acc + (p.totalBet || 0), 0);
      this.setData({ totalPot: pot });
    } catch (e) {
      console.warn('计算总下注失败，回退使用后端字段:', e);
      this.setData({ totalPot: gameData.totalPot || 0 });
    }

    // 计算并更新当前最高下注
    try {
      const maxBet = (gameData.players || [])
        .filter(p => p.status === 'playing')
        .map(p => {
          const bet = p.currentBet || 0;
          return p.hasChecked ? bet / 2 : bet; // 归一到未看牌基准
        })
        .reduce((acc, v) => Math.max(acc, v), 0);
      if (Number.isFinite(maxBet)) {
        this.setData({ currentMaxBet: maxBet });
      }
    } catch (e) {
      console.warn('计算最高下注失败:', e);
    }

    // 更新玩家数据，确保保留手牌可见性
    const updatedPlayers = this.data.players.map(player => {
      // 查找对应的游戏数据
      const playerGameData = gameData.players.find(p => p.openId === player.openId);
      if (playerGameData) {
        // 处理手牌，保留可见性
        const preservedHandCards = [];
        if (player.handCards && player.handCards.length > 0) {
          // 创建一个映射，记录每张牌的可见性
          const visibilityMap = {};
          player.handCards.forEach(card => {
            // 兼容 card.rank 和 card.value 两种情况
            const cardValue = card.rank || card.value;
            const cardKey = `${card.suit}_${cardValue}`;
            visibilityMap[cardKey] = card.isVisible;
          });
          
          // 应用可见性到新的手牌
          if (playerGameData.handCards && playerGameData.handCards.length > 0) {
            preservedHandCards.push(...playerGameData.handCards.map(card => {
              // 兼容 card.rank 和 card.value 两种情况
              const cardValue = card.rank || card.value;
              const cardKey = `${card.suit}_${cardValue}`;
              const isVisible = player.openId === this.data.userInfo._openid && visibilityMap[cardKey] !== undefined ? 
                              visibilityMap[cardKey] : (card.isVisible || false);
              return {
                ...card,
                // 如果是当前玩家且之前看过牌，保持可见性
                isVisible: isVisible
              };
            }));
          } else {
            // 如果游戏数据中没有手牌，保留原有手牌
            preservedHandCards.push(...player.handCards);
          }
        } else if (playerGameData.handCards && playerGameData.handCards.length > 0) {
          // 如果之前没有手牌，使用新的手牌
          preservedHandCards.push(...playerGameData.handCards);
        }
        
        // 确保保留玩家状态和下注信息
        const updatedPlayer = {
          ...player,
          handCards: preservedHandCards.length > 0 ? preservedHandCards : player.handCards,
          // 明确地保留currentBet和totalBet，如果游戏数据中没有这些字段，则使用原有值
          currentBet: playerGameData.currentBet !== undefined ? playerGameData.currentBet : player.currentBet,
          totalBet: playerGameData.totalBet !== undefined ? playerGameData.totalBet : player.totalBet,
          // 确保从游戏数据中获取最新的玩家状态
          status: playerGameData.status || player.status,
          // 添加玩家是否看牌的状态
          hasChecked: playerGameData.hasChecked || false
        };
        
        return updatedPlayer;
      }
      return player
    })

    // 判断当前是否轮到自己操作
    let isCurrentPlayer = false;
    
    // 如果游戏状态为waiting（等待中），且当前用户是房主，则设置为当前玩家
    if (this.data.gameStatus === 'waiting') {
      // 判断当前用户是否是房主
      const isOwner = updatedPlayers.length > 0 && 
                     updatedPlayers[0].isOwner && 
                     updatedPlayers[0].openId === this.data.userInfo._openid;
      
      // 在等待状态下，房主为当前玩家
      isCurrentPlayer = isOwner;
    } else if (gameData.status === 'playing') {
      // 如果游戏已经开始，则根据currentPlayerIndex判断当前玩家
      isCurrentPlayer = gameData.currentPlayerIndex !== undefined && 
                       gameData.players[gameData.currentPlayerIndex]?.openId === this.data.userInfo._openid;
    }

    // 确保当前玩家在数组末尾（与formatPlayers保持一致）
    const myOpenId = this.data.userInfo._openid;
    const myIndex = updatedPlayers.findIndex(p => p.openId === myOpenId);
    if (myIndex !== -1 && myIndex !== updatedPlayers.length - 1) {
      const me = updatedPlayers.splice(myIndex, 1)[0];
      updatedPlayers.push(me);
    }

    // 获取活跃玩家（用于比牌选择）
    const activePlayers = updatedPlayers.filter(p => p.status === 'playing')

    this.setData({
      players: updatedPlayers,
      isCurrentPlayer: isCurrentPlayer,
      activePlayers: activePlayers,
      gameStatus: gameData.status || this.data.gameStatus, // 更新游戏状态
      gameData: gameData // 将游戏数据暴露给视图层，用于显示当前玩家指示器
    }, () => {
      console.log('游戏数据更新完成，当前玩家列表:', JSON.stringify(this.data.players));
      console.log('检查玩家状态和下注信息是否正确保留:');
      this.data.players.forEach(player => {
        console.log(`玩家 ${player.nickname}: 状态=${player.status}, 当前下注=${player.currentBet}, 总下注=${player.totalBet}, 手牌数量=${player.handCards ? player.handCards.length : 0}`);
        if (player.handCards && player.handCards.length > 0) {
          console.log(`玩家 ${player.nickname} 手牌可见性:`, player.handCards.map(card => card.isVisible));
        }
      });
      // 强制刷新页面
      this.forceUpdate();
    })

    // 如果游戏结束，显示结果
    if (gameData.status === 'ended') {
      // 重置所有玩家的isReady状态为false
      const resetPlayers = updatedPlayers.map(p => ({ ...p, isReady: false }));
      // 切换庄家为赢家
      let newRoomInfo = { ...this.data.roomInfo };
      if (gameData.winnerId) {
        newRoomInfo.dealerId = gameData.winnerId;
      }
      // 重置看牌状态标记，确保新一局游戏时看牌状态正确
      this._reportedHasChecked = false;
      
      this.setData({
        players: resetPlayers,
        roomInfo: newRoomInfo
      });
      this.showGameResult(gameData);
    }

    // 广播事件：比牌结果提示（所有客户端）
    try {
      if (gameData.compareEvent && gameData.compareEvent.eventId) {
        if (this._lastCompareEventId !== gameData.compareEvent.eventId) {
          this._lastCompareEventId = gameData.compareEvent.eventId;
          const selfId = gameData.compareEvent.from; // 事件发起者
          const targetId = gameData.compareEvent.to; // 目标
          const winnerId = gameData.compareEvent.winner;
          const isWinFromPerspective = winnerId === selfId; // 以发起者视角决定胜负
          // 但你的需求是两行提示严格“A比牌B”“胜利/失败”，未指定视角差异
          // 因此统一以事件发起者视角：A=selfId, B=targetId
          this.showCompareResultToast(selfId, targetId, isWinFromPerspective);
        }
      }
    } catch (e) {
      console.warn('处理compareEvent失败:', e);
    }
  },

  // 格式化玩家数据
  // 格式化玩家列表，当前用户始终在底部，其他玩家在两侧
  formatPlayers: function (players) {
    if (!players || !Array.isArray(players)) {
      console.log('玩家列表无效');
      return [];
    }
    if (!this.data.userInfo || !this.data.userInfo._openid) {
      console.log('当前用户信息不完整');
      return players.map(p => ({
        ...p,
        avatarUrl: p.avatarUrl || 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
        nickname: p.nickName || p.nickname || '玩家',
        isDealer: false
      }));
    }
    const myOpenId = this.data.userInfo._openid;
    const dealerId = (this.data.roomInfo && this.data.roomInfo.dealerId) ? this.data.roomInfo.dealerId : null;
    console.log('当前用户OpenID:', myOpenId, '庄家ID:', dealerId);
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
        isDealer: dealerId && p.openId === dealerId
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
  
  // 显示玩家信息弹出层
  showPlayerInfo: function(e) {
    const playerId = e.currentTarget.dataset.playerId;
    const player = this.data.players.find(p => p.openId === playerId);
    
    if (player) {
      this.setData({
        selectedPlayer: player,
        showPlayerInfoPopup: true
      });
    }
  },
  
  // 隐藏玩家信息弹出层
  hidePlayerInfo: function() {
    this.setData({
      showPlayerInfoPopup: false,
      selectedPlayer: null
    });
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
    
    // 准备积分变化数据
    const scoreChanges = []
    if (gameData.scoreChanges) {
      gameData.players.forEach(player => {
        const playerInfo = this.data.players.find(p => p.openId === player.openId)
        const nickname = playerInfo ? playerInfo.nickname : '未知玩家'
        const change = gameData.scoreChanges[player.openId] || 0
        const changeText = change > 0 ? `+${change}` : `${change}`
        scoreChanges.push({
          nickname,
          change,
          changeText
        })
      })
    }
    
    // 使用自定义弹窗显示游戏结果
    this.setData({
      showGameResultPopup: true,
      gameResultMessage: resultMessage,
      gameResultScores: scoreChanges,
      isCurrentPlayer: false,
      showRaiseInput: false,
      showCompareSelect: false
    })
  },
  
  // 隐藏游戏结果弹窗
  hideGameResult: function() {
    this.setData({
      showGameResultPopup: false
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
    // 使用一个空的setData来触发页面重新渲染
    this.setData({
      _forceUpdate: Date.now()
    });
  },

  // 准备按钮点击 - 重命名以避免与生命周期函数冲突
  onPlayerReady: function () {
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

  // 新增：点击当前玩家单张牌逐张翻开，首次翻牌上报hasChecked
  onTapMyCard: function (e) {
    const cardIndex = e && e.currentTarget && typeof e.currentTarget.dataset.cardIndex !== 'undefined'
      ? Number(e.currentTarget.dataset.cardIndex)
      : -1;

    // 基本校验
    if (this.data.gameStatus !== 'playing') return;
    const myOpenId = this.data.userInfo && this.data.userInfo._openid;
    const myPlayerIndex = this.data.players.findIndex(p => p.openId === myOpenId);
    if (myPlayerIndex === -1) return;
    const myPlayer = this.data.players[myPlayerIndex];
    if (!myPlayer.handCards || cardIndex < 0 || cardIndex >= myPlayer.handCards.length) return;
    const targetCard = myPlayer.handCards[cardIndex];
    if (!targetCard || targetCard.isVisible) return; // 已可见则不处理

    // 本地更新：将该张牌设为可见
    const updatedPlayers = [...this.data.players];
    const updatedHand = [...updatedPlayers[myPlayerIndex].handCards];
    updatedHand[cardIndex] = { ...targetCard, isVisible: true };
    updatedPlayers[myPlayerIndex] = { ...updatedPlayers[myPlayerIndex], handCards: updatedHand };

    // 首次翻开任意一张牌，视为已看牌：仅上报一次
    const needReport = !this._reportedHasChecked && !updatedPlayers[myPlayerIndex].hasChecked;
    if (needReport) {
      updatedPlayers[myPlayerIndex].hasChecked = true;
      this._reportedHasChecked = true;
    }

    this.setData({ players: updatedPlayers }, () => {
      if (needReport) {
        wx.cloud.callFunction({
          name: 'gameLogic',
          data: { action: 'checkCards', roomId: this.data.roomId }
        }).then(res => {
          // 成功即可，不额外处理牌面（本地已翻开）
        }).catch(err => {
          // 失败也不回滚本地hasChecked，避免影响体验
          console.warn('checkCards failed:', err);
        });
      }
    });
  },

  // 跟注按钮点击
  onFollow: function () {
    wx.showLoading({
      title: '跟注中...'
    })
    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'followBet',
        roomId: this.data.roomId
      }
    }).then(res => {
      wx.hideLoading()
      if (res.result && res.result.success) {
        // 保留当前玩家的卡牌可见性
        const myPlayerIndex = this.data.players.findIndex(p => p.openId === this.data.userInfo._openid);
        if (myPlayerIndex !== -1) {
          const updatedPlayers = [...this.data.players];
          // 确保卡牌的isVisible属性保持不变
          if (updatedPlayers[myPlayerIndex].handCards && updatedPlayers[myPlayerIndex].handCards.length > 0) {
            // 保留原有的isVisible属性
            const preservedCards = updatedPlayers[myPlayerIndex].handCards.map(card => ({
              ...card,
              isVisible: card.isVisible // 保留原有的可见性
            }));
            updatedPlayers[myPlayerIndex].handCards = preservedCards;
          }
          
          this.setData({
            players: updatedPlayers
          }, () => {
            wx.showToast({
              title: '跟注成功',
              icon: 'success'
            });
            console.log('跟注成功，保留卡牌可见性');
          });
        } else {
          wx.showToast({
            title: '跟注成功',
            icon: 'success'
          });
          // 更新界面状态
          this.forceUpdate();
        }
      } else {
        wx.showToast({
          title: res.result.message || '跟注失败',
          icon: 'none'
        })
      }
    }).catch(err => {
      wx.hideLoading()
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
    console.log('=== confirmRaise函数被调用 - 时间:', new Date().toLocaleString(), '===');
    const amount = parseInt(this.data.raiseAmount)
    if (isNaN(amount) || amount <= 0) {
      console.error('下注金额无效:', this.data.raiseAmount);
      wx.showToast({
        title: '请输入有效金额',
        icon: 'none'
      })
      return
    }

    // 前端校验：绝对下注额规则
    const myPlayerIndex = this.data.players.findIndex(p => p.openId === this.data.userInfo._openid);
    const myPlayer = myPlayerIndex !== -1 ? this.data.players[myPlayerIndex] : null;
    const hasChecked = !!(myPlayer && myPlayer.hasChecked);
    const currentMax = this.data.currentMaxBet || 0;

    // 未看牌: amount >= 当前下注；已看牌: amount >= 2 * 当前下注
    if (!hasChecked && amount < currentMax) {
      wx.showToast({ title: '下注需不小于当前下注', icon: 'none' });
      return;
    }
    if (hasChecked && amount < currentMax * 2) {
      wx.showToast({ title: '看牌后下注需不小于当前下注的2倍', icon: 'none' });
      return;
    }

    this.setData({ showRaiseInput: false })

    console.log('准备调用raiseBet云函数，金额(目标下注):', amount, '房间ID:', this.data.roomId);

    wx.showLoading({ title: '下注中...' })
    wx.cloud.callFunction({
      name: 'gameLogic',
      data: { action: 'raiseBet', roomId: this.data.roomId, amount: amount }
    }).then(res => {
      wx.hideLoading()
      if (res.result && res.result.success) {
        // 保留当前玩家的卡牌可见性
        const myIdx = this.data.players.findIndex(p => p.openId === this.data.userInfo._openid);
        if (myIdx !== -1) {
          const updatedPlayers = [...this.data.players];
          if (updatedPlayers[myIdx].handCards && updatedPlayers[myIdx].handCards.length > 0) {
            const preservedCards = updatedPlayers[myIdx].handCards.map(card => ({ ...card, isVisible: card.isVisible }));
            updatedPlayers[myIdx].handCards = preservedCards;
          }
          this.setData({ players: updatedPlayers }, () => {
            wx.showToast({ title: '下注成功', icon: 'success' });
          });
        } else {
          wx.showToast({ title: '下注成功', icon: 'success' });
          this.forceUpdate();
        }
      } else {
        wx.showToast({ title: res.result.message || '下注失败', icon: 'none' })
      }
    }).catch(err => {
      wx.hideLoading()
      wx.showToast({ title: '操作失败: ' + err.message, icon: 'none' })
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
      player.status === 'playing' && player.openId !== this.data.userInfo._openid
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

    // 获取当前玩家是否已看牌
    const myPlayerIndex = this.data.players.findIndex(p => p.openId === this.data.userInfo._openid);
    const myPlayer = myPlayerIndex !== -1 ? this.data.players[myPlayerIndex] : null;
    const hasChecked = !!(myPlayer && myPlayer.hasChecked);
    
    // 计算比牌需要的积分，使用当前基准分而不是初始底分
    const currentBaseScore = this.data.currentMaxBet || this.data.baseScore;
    const compareScore = hasChecked ? currentBaseScore * 2 : currentBaseScore;
    
    // 获取目标玩家昵称
    const targetPlayer = this.data.players.find(p => p.openId === targetPlayerId);
    const targetName = targetPlayer ? (targetPlayer.nickName || targetPlayer.nickname || '对手') : '对手';
    
    // 显示确认弹窗
    wx.showModal({
      title: '比牌确认',
      content: `是否花费 ${compareScore} 积分与 ${targetName} 比牌？${hasChecked ? '(已看牌，2倍最新底注)' : '(未看牌，最新底注)'}`,
      success: (res) => {
        if (res.confirm) {
          // 用户确认比牌
          wx.showLoading({
            title: '比牌中...'
          })
          this.doCompareCards(targetPlayerId);
        } else {
          // 用户取消比牌
          console.log('用户取消比牌');
        }
      }
    });
  },
  
  // 执行比牌操作
  doCompareCards: function(targetPlayerId) {
    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'compareCards',
        roomId: this.data.roomId,
        targetPlayerId: targetPlayerId
      }
    }).then(res => {
      wx.hideLoading()
      if (res.result && res.result.success) {
        // 保留当前玩家的卡牌可见性
        const myPlayerIndex = this.data.players.findIndex(p => p.openId === this.data.userInfo._openid);
        if (myPlayerIndex !== -1) {
          const updatedPlayers = [...this.data.players];
          // 确保卡牌的isVisible属性保持不变
          if (updatedPlayers[myPlayerIndex].handCards && updatedPlayers[myPlayerIndex].handCards.length > 0) {
            // 保留原有的isVisible属性
            const preservedCards = updatedPlayers[myPlayerIndex].handCards.map(card => ({
              ...card,
              isVisible: card.isVisible // 保留原有的可见性
            }));
            updatedPlayers[myPlayerIndex].handCards = preservedCards;
          }
          
          this.setData({
            players: updatedPlayers
          }, () => {
            console.log('比牌成功，保留卡牌可见性');
          });
        } else {
          // 更新界面状态
          this.forceUpdate();
        }
      } else {
        wx.showToast({
          title: res.result.message || '比牌失败',
          icon: 'none'
        })
      }
    }).catch(err => {
      wx.hideLoading()
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
          wx.showLoading({
            title: '弃牌中...'
          })
          wx.cloud.callFunction({
            name: 'gameLogic',
            data: {
              action: 'foldCards',
              roomId: this.data.roomId
            }
          }).then(res => {
            wx.hideLoading()
            if (res.result && res.result.success) {
              // 保留当前玩家的卡牌可见性并更新状态为fold
              const myPlayerIndex = this.data.players.findIndex(p => p.openId === this.data.userInfo._openid);
              if (myPlayerIndex !== -1) {
                const updatedPlayers = [...this.data.players];
                // 确保卡牌的isVisible属性保持不变
                if (updatedPlayers[myPlayerIndex].handCards && updatedPlayers[myPlayerIndex].handCards.length > 0) {
                  // 保留原有的isVisible属性
                  const preservedCards = updatedPlayers[myPlayerIndex].handCards.map(card => ({
                    ...card,
                    isVisible: card.isVisible // 保留原有的可见性
                  }));
                  updatedPlayers[myPlayerIndex].handCards = preservedCards;
                }
                
                // 明确设置当前玩家状态为fold（弃牌）
                updatedPlayers[myPlayerIndex].status = 'fold';
                
                this.setData({
                  players: updatedPlayers
                }, () => {
                  wx.showToast({
                    title: '弃牌成功',
                    icon: 'success'
                  });
                  console.log('弃牌成功，已将玩家状态更新为fold，保留卡牌可见性');
                  
                  // 弃牌后始终重新设置游戏监听器，确保能获取最新游戏状态
                  if (this.data.roomInfo && this.data.roomInfo.currentGameId) {
                    console.log('弃牌后重新设置游戏监听器');
                    this.setupGameListener(this.data.roomInfo.currentGameId);
                  }
                });
              } else {
                wx.showToast({
                  title: '弃牌成功',
                  icon: 'success'
                });
                // 更新界面状态
                this.forceUpdate();
              }
            } else {
              wx.showToast({
                title: res.result.message || '弃牌失败',
                icon: 'none'
              })
            }
          }).catch(err => {
            wx.hideLoading()
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
      openId: userInfo._openid,
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
 
 // 辅助：昵称截断（过长仅显示前若干字符）
 truncateNickname: function (name) {
  if (!name || typeof name !== 'string') return '玩家';
  const trimmed = name.trim();
  const maxLen = 6; // 可按需要调整，确保美观
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
 },

  // 显示比牌结果提示（1.2秒入场动画 + 静态停留至总计3秒，不拦截交互）
  showCompareResultToast: function (selfId, targetPlayerId, isWin) {
    const selfPlayer = this.data.players.find(p => p.openId === selfId);
    const targetPlayer = this.data.players.find(p => p.openId === targetPlayerId);
    const selfName = this.truncateNickname(selfPlayer ? (selfPlayer.nickName || selfPlayer.nickname || '我') : '我');
    const targetName = this.truncateNickname(targetPlayer ? (targetPlayer.nickName || targetPlayer.nickname || '对手') : '对手');

    this.setData({
      showCompareResult: true,
      comparePlayer1: selfName,
      comparePlayer2: targetName,
      compareWin: !!isWin
    });

    if (this._compareResultTimer) {
      clearTimeout(this._compareResultTimer);
    }
    this._compareResultTimer = setTimeout(() => {
      this.setData({
        showCompareResult: false,
        comparePlayer1: '',
        comparePlayer2: '',
        compareWin: false
      });
      this._compareResultTimer = null;
    }, 4000);
  },
})