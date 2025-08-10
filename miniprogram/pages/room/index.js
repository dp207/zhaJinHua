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
    gameResultScores: [] // 游戏结果积分变化数据
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
          console.log('页面数据更新完成, players:', JSON.stringify(this.data.players));
          console.log('当前玩家状态:', this.data.isCurrentPlayer ? '是当前玩家' : '不是当前玩家');
          // 强制刷新页面
          this.forceUpdate();
        });
        
        // 确保数据库中的isReady也为false
        const myPlayer = roomInfo.players.find(p => p.openId === this.data.userInfo._openid);
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
            // 先执行弃牌逻辑
            wx.showLoading({
              title: '处理中...'
            });
            wx.cloud.callFunction({
              name: 'gameLogic',
              data: {
                action: 'foldCards',
                roomId: this.data.roomId
              }
            }).then(res => {
              wx.hideLoading();
              if (res.result && res.result.success) {
                console.log('离开房间前弃牌成功');
                // 弃牌成功后离开房间
                this.leaveRoom();
              } else {
                console.error('弃牌失败:', res.result.message);
                // 即使弃牌失败也离开房间
                this.leaveRoom();
              }
            }).catch(err => {
              wx.hideLoading();
              console.error('弃牌操作失败:', err);
              // 出错也离开房间
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
            this.leaveRoom();
          }
        }
      });
    }
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
                console.log('页面数据更新完成，当前玩家列表:', JSON.stringify(this.data.players));
                // 强制刷新页面
                this.forceUpdate();
              });

              // 获取当前玩家信息
              const myPlayer = players.find(p => p.openId === this.data.userInfo._openid);
              console.log('当前玩家信息:', myPlayer ? JSON.stringify(myPlayer) : '未找到当前玩家');
              
              // 同步isReady状态
              if (myPlayer && myPlayer.isReady !== this.data.isReady) {
                console.log('同步isReady状态:', myPlayer.isReady);
                this.setData({ isReady: myPlayer.isReady });
              }
              // 如果游戏状态变为playing，则设置游戏监听
              console.log('=== 检查是否需要设置游戏监听 - 时间:', new Date().toLocaleString(), '===');
              console.log('游戏状态:', roomData.status);
              console.log('当前游戏ID:', roomData.currentGameId);
              console.log('是否已有监听:', !!this.gameListener);
              console.log('房间状态:', roomData.status);
              console.log('房间玩家数量:', roomData.players ? roomData.players.length : 0);
              
              // 强制重新设置游戏监听，确保数据更新能被捕获
              if (roomData.status === 'playing' && roomData.currentGameId) {
                console.log('游戏状态为playing且有currentGameId，设置游戏监听');
                // 无论是否已有监听器，都重新设置
                this.setupGameListener(roomData.currentGameId);
              } else {
                console.log('不满足设置游戏监听条件，跳过');
                if (roomData.status !== 'playing') {
                  console.log('游戏状态不是playing，不设置监听');
                }
                if (!roomData.currentGameId) {
                  console.log('没有currentGameId，不设置监听');
                }
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
    console.log('=== 设置游戏数据监听 - 时间:', new Date().toLocaleString(), '===');
    console.log('设置游戏数据监听, gameId:', gameId);
    
    // 如果已经有监听器，先关闭
    if (this.gameListener) {
      console.log('关闭已存在的游戏监听器');
      try {
        this.gameListener.close();
      } catch (err) {
        console.error('关闭游戏监听器失败:', err);
      }
    }
    
    const db = wx.cloud.database();
    this.gameListener = db.collection('games')
      .where({ gameId: gameId })
      .watch({
        onChange: snapshot => {
          console.log('=== 收到游戏数据变化 - 时间:', new Date().toLocaleString(), '===');
          console.log('收到游戏数据变化, type:', snapshot.type);
          console.log('snapshot.docChanges长度:', snapshot.docChanges ? snapshot.docChanges.length : 0);
          
          // 检查是否有docChanges数据
          if (snapshot.docChanges && snapshot.docChanges.length > 0) {
            console.log('检测到docChanges数据变化，长度:', snapshot.docChanges.length);
            snapshot.docChanges.forEach((change, index) => {
              console.log(`docChange[${index}].dataType:`, change.dataType);
              console.log(`docChange[${index}].queueType:`, change.queueType);
              console.log(`docChange[${index}].docId:`, change.docId);
              console.log(`docChange[${index}].updatedFields:`, JSON.stringify(change.updatedFields));
            });
          }
          
          // 修改逻辑，不再严格检查snapshot.type，只要有docs数据就处理
          console.log('游戏数据变化, type:', snapshot.type || 'undefined');
          if (!snapshot.docs || snapshot.docs.length === 0) {
            console.error('游戏数据更新: 没有找到文档数据');
            return;
          }
          
          console.log('snapshot.docs长度:', snapshot.docs.length);
          const gameData = snapshot.docs[0];
          if (gameData) {
            console.log('游戏数据更新，准备调用updateGameData函数');
            console.log('游戏数据ID:', gameData._id);
            console.log('游戏状态:', gameData.status);
            console.log('当前玩家索引:', gameData.currentPlayerIndex);
            console.log('玩家数量:', gameData.players ? gameData.players.length : 0);
            
            // 更新游戏相关数据
            this.updateGameData(gameData);
          } else {
            console.error('游戏数据为空');
          }
        },
        onError: err => {
          console.error('游戏监听错误:', err);
        }
      });
    console.log('游戏数据监听设置完成, gameListener:', this.gameListener ? '已设置' : '设置失败');
  },

  // 更新游戏数据
  updateGameData: function (gameData) {
    console.log('=== updateGameData函数被调用 - 时间:', new Date().toLocaleString(), '===');
    console.log('更新游戏数据:', JSON.stringify(gameData));
    console.log('游戏状态:', gameData.status, '当前玩家索引:', gameData.currentPlayerIndex);
    console.log('游戏玩家数据:', JSON.stringify(gameData.players));
    
    // 更新总下注池
    this.setData({
      totalPot: gameData.totalPot || 0
    })
    console.log('更新总下注池:', gameData.totalPot || 0);

    // 更新玩家数据（手牌、下注等）
    console.log('开始更新玩家数据，当前玩家数量:', this.data.players.length);
    const updatedPlayers = this.data.players.map(player => {
      console.log(`处理玩家 ${player.nickname}(${player.openId})`);
      const playerGameData = gameData.players.find(p => p.openId === player.openId);
      if (playerGameData) {
        console.log(`找到玩家 ${player.nickname} 的游戏数据`);
        console.log(`玩家 ${player.nickname} 原始数据:`, JSON.stringify(player));
        console.log(`玩家 ${player.nickname} 的游戏数据:`, JSON.stringify(playerGameData));
        console.log(`玩家 ${player.nickname} 原始数据详情:`, 
                  `状态=${player.status}, ` +
                  `当前下注=${player.currentBet}, ` +
                  `总下注=${player.totalBet}, ` +
                  `手牌数量=${player.handCards ? player.handCards.length : 0}`);
        console.log(`玩家 ${player.nickname} 游戏数据详情:`, 
                  `状态=${playerGameData.status}, ` +
                  `当前下注=${playerGameData.currentBet}, ` +
                  `总下注=${playerGameData.totalBet}, ` +
                  `手牌数量=${playerGameData.handCards ? playerGameData.handCards.length : 0}`);
        
        // 保存原有手牌的可见性状态
        const preservedHandCards = [];
        if (player.handCards && player.handCards.length > 0) {
          console.log(`玩家 ${player.nickname} 有原始手牌，数量:`, player.handCards.length);
          // 创建一个映射，记录每张牌的可见性
          const visibilityMap = {};
          player.handCards.forEach(card => {
            // 兼容 card.rank 和 card.value 两种情况
            const cardValue = card.rank || card.value;
            const cardKey = `${card.suit}_${cardValue}`;
            visibilityMap[cardKey] = card.isVisible;
            console.log(`记录手牌可见性: ${cardKey} = ${card.isVisible}`);
          });
          
          // 应用可见性到新的手牌
          if (playerGameData.handCards && playerGameData.handCards.length > 0) {
            console.log(`玩家 ${player.nickname} 游戏数据中有手牌，数量:`, playerGameData.handCards.length);
            preservedHandCards.push(...playerGameData.handCards.map(card => {
              // 兼容 card.rank 和 card.value 两种情况
              const cardValue = card.rank || card.value;
              const cardKey = `${card.suit}_${cardValue}`;
              const isVisible = player.openId === this.data.userInfo._openid && visibilityMap[cardKey] !== undefined ? 
                              visibilityMap[cardKey] : (card.isVisible || false);
              console.log(`应用手牌可见性: ${cardKey} = ${isVisible}`);
              return {
                ...card,
                // 如果是当前玩家且之前看过牌，保持可见性
                isVisible: isVisible
              };
            }));
          } else {
            // 如果游戏数据中没有手牌，保留原有手牌
            console.log(`玩家 ${player.nickname} 游戏数据中没有手牌，保留原有手牌`);
            preservedHandCards.push(...player.handCards);
          }
        } else if (playerGameData.handCards && playerGameData.handCards.length > 0) {
          // 如果之前没有手牌，使用新的手牌
          console.log(`玩家 ${player.nickname} 没有原始手牌，使用游戏数据中的手牌`);
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
          status: playerGameData.status || player.status
        };
        
        console.log(`更新后的玩家 ${player.nickname} 数据:`, 
                  `状态=${updatedPlayer.status}, ` +
                  `当前下注=${updatedPlayer.currentBet}, ` +
                  `总下注=${updatedPlayer.totalBet}, ` +
                  `手牌数量=${updatedPlayer.handCards ? updatedPlayer.handCards.length : 0}`);
                  
        return updatedPlayer;
      } else {
        console.log(`未找到玩家 ${player.nickname} 的游戏数据，保持原样`);
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

    console.log('准备更新页面数据，玩家数量:', updatedPlayers.length);
    this.setData({
      players: updatedPlayers,
      isCurrentPlayer: isCurrentPlayer,
      activePlayers: activePlayers,
      gameStatus: gameData.status || this.data.gameStatus // 更新游戏状态
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
      this.setData({
        players: resetPlayers,
        roomInfo: newRoomInfo
      });
      this.showGameResult(gameData);
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
    console.log('onPlayerReady函数被调用 - 时间:', new Date().toLocaleString());
    
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
    wx.showLoading({
      title: '看牌中...'
    })
    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'checkCards',
        roomId: this.data.roomId
      }
    }).then(res => {
      wx.hideLoading()
      if (res.result && res.result.success) {
        // 更新卡牌可见性
        const myPlayerIndex = this.data.players.findIndex(p => p.openId === this.data.userInfo._openid);
        if (myPlayerIndex !== -1 && res.result.cards) {
          const updatedPlayers = [...this.data.players];
          // 设置卡牌为可见
          updatedPlayers[myPlayerIndex].handCards = res.result.cards.map(card => ({
            ...card,
            isVisible: true // 设置卡牌为可见
          }));
          
          this.setData({
            players: updatedPlayers
          }, () => {
            wx.showToast({
              title: '看牌成功',
              icon: 'success'
            });
            console.log('卡牌已设置为可见');
          });
        } else {
          wx.showToast({
            title: '看牌成功',
            icon: 'success'
          });
          // 更新界面状态
          this.forceUpdate();
        }
      } else {
        wx.showToast({
          title: res.result.message || '看牌失败',
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
      console.error('加注金额无效:', this.data.raiseAmount);
      wx.showToast({
        title: '请输入有效金额',
        icon: 'none'
      })
      return
    }

    this.setData({
      showRaiseInput: false
    })

    console.log('准备调用raiseBet云函数，金额:', amount, '房间ID:', this.data.roomId);
    console.log('当前玩家状态:', this.data.players.map(p => {
      return {
        nickname: p.nickname,
        openId: p.openId,
        status: p.status,
        currentBet: p.currentBet,
        totalBet: p.totalBet,
        handCardsCount: p.handCards ? p.handCards.length : 0
      };
    }));
    
    wx.showLoading({
      title: '加注中...'
    })
    wx.cloud.callFunction({
      name: 'gameLogic',
      data: {
        action: 'raiseBet',
        roomId: this.data.roomId,
        amount: amount
      }
    }).then(res => {
      wx.hideLoading()
      console.log('=== raiseBet云函数返回结果 - 时间:', new Date().toLocaleString(), '===');
      console.log('raiseBet云函数返回结果:', JSON.stringify(res.result));
      if (res.result && res.result.success) {
        console.log('加注成功，检查是否触发updateGameData函数');
        console.log('当前游戏状态:', this.data.gameStatus);
        console.log('当前游戏ID:', this.data.roomInfo ? this.data.roomInfo.currentGameId : 'undefined');
        console.log('当前游戏监听器状态:', this.gameListener ? '已设置' : '未设置');
        
        // 保留当前玩家的卡牌可见性
        const myPlayerIndex = this.data.players.findIndex(p => p.openId === this.data.userInfo._openid);
        console.log('当前玩家openId:', this.data.userInfo._openid);
        console.log('查找当前玩家结果:', myPlayerIndex !== -1 ? '找到' : '未找到');
        
        if (myPlayerIndex !== -1) {
          console.log('找到当前玩家，索引:', myPlayerIndex);
          console.log('当前玩家数据:', JSON.stringify(this.data.players[myPlayerIndex]));
          
          const updatedPlayers = [...this.data.players];
          // 确保卡牌的isVisible属性保持不变
          if (updatedPlayers[myPlayerIndex].handCards && updatedPlayers[myPlayerIndex].handCards.length > 0) {
            console.log('当前玩家有手牌，数量:', updatedPlayers[myPlayerIndex].handCards.length);
            console.log('手牌详情:', JSON.stringify(updatedPlayers[myPlayerIndex].handCards));
            
            // 保留原有的isVisible属性
            const preservedCards = updatedPlayers[myPlayerIndex].handCards.map(card => {
              const cardValue = card.rank || card.value;
              const cardKey = `${card.suit}_${cardValue}`;
              console.log(`保留手牌可见性: ${cardKey} = ${card.isVisible}`);
              return {
                ...card,
                isVisible: card.isVisible // 保留原有的可见性
              };
            });
            updatedPlayers[myPlayerIndex].handCards = preservedCards;
            console.log('保留可见性后的手牌:', JSON.stringify(preservedCards));
          } else {
            console.log('当前玩家没有手牌或手牌为空');
          }
          
          console.log('更新前的玩家数据:', JSON.stringify(this.data.players));
          this.setData({
            players: updatedPlayers
          }, () => {
            console.log('更新后的玩家数据:', JSON.stringify(this.data.players));
            wx.showToast({
              title: '加注成功',
              icon: 'success'
            });
            console.log('加注成功，保留卡牌可见性');
          });
        } else {
          console.log('未找到当前玩家，直接更新界面');
          wx.showToast({
            title: '加注成功',
            icon: 'success'
          });
          // 更新界面状态
          this.forceUpdate();
        }
      } else {
        console.error('加注失败:', res.result.message);
        wx.showToast({
          title: res.result.message || '加注失败',
          icon: 'none'
        })
      }
    }).catch(err => {
      console.error('调用raiseBet云函数失败:', err);
      wx.hideLoading()
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

    wx.showLoading({
      title: '比牌中...'
    })
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
            wx.showToast({
              title: '比牌成功',
              icon: 'success'
            });
            console.log('比牌成功，保留卡牌可见性');
          });
        } else {
          wx.showToast({
            title: '比牌成功',
            icon: 'success'
          });
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
})