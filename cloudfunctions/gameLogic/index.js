const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

// 主函数入口
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;
  
  console.log('gameLogic 云函数调用:', event);
  
  try {
    switch (event.action) {
      case 'playerReady':
        return await playerReady(event, openId);
      case 'checkCards':
        return await checkCards(event, openId);
      case 'followBet':
        return await followBet(event, openId);
      case 'raiseBet':
        return await raiseBet(event, openId);
      case 'compareCards':
        return await compareCards(event, openId);
      case 'foldCards':
        return await foldCards(event, openId);
      default:
        return { success: false, message: '未知操作类型' };
    }
  } catch (error) {
    console.error('游戏逻辑错误:', error);
    return { success: false, message: error.message };
  }
};

// 玩家准备
async function playerReady(event, openId) {
  const { roomId, isReady = true } = event;
  
  try {
    // 获取房间信息
    const roomRes = await db.collection('rooms').where({ roomId: roomId }).get();
    if (roomRes.data.length === 0) {
      return { success: false, message: '房间不存在' };
    }
    
    const room = roomRes.data[0];
    
    // 检查游戏状态
    if (room.status === 'playing') {
      return { success: false, message: '游戏已经开始' };
    }
    
    // 查找玩家在房间中的索引
    const playerIndex = room.players.findIndex(p => p.openId === openId);
    if (playerIndex === -1) {
      return { success: false, message: '您不在该房间中' };
    }
    
    // 检查玩家积分是否足够
    if (isReady && room.players[playerIndex].score < room.baseScore) {
      return { success: false, message: '积分不足，无法开始游戏' };
    }
    
    // 更新玩家准备状态
    const updatedPlayers = [...room.players];
    updatedPlayers[playerIndex].isReady = isReady;
    
    await db.collection('rooms').where({ roomId: roomId }).update({
      data: {
        players: updatedPlayers
      }
    });
    
    console.log(`playerReady: 玩家 ${openId} 准备状态更新为 ${isReady}`);
    
    // 只有当玩家准备时，才检查是否可以开始游戏
    if (isReady) {
      // 检查是否所有玩家都已准备
      console.log('playerReady: 当前players isReady状态', updatedPlayers.map(p => ({openId: p.openId, isReady: p.isReady})));
      const allReady = updatedPlayers.every(p => p.isReady);
      // 如果所有玩家都已准备且人数大于等于2，则开始游戏
      if (allReady && updatedPlayers.length >= 2) {
        console.log('playerReady: 所有玩家已准备，调用startGame');
        await startGame(roomId, updatedPlayers, room.baseScore);
      }
    }
    
    return { success: true, message: isReady ? '准备成功' : '取消准备成功' };
  } catch (error) {
    console.error('玩家准备错误:', error);
    return { success: false, message: error.message };
  }
}

// 开始游戏
async function startGame(roomId, players, baseScore) {
  try {
    // 创建新的游戏记录
    const gameId = `game_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    // 生成并洗牌
    const deck = generateDeck();
    const shuffledDeck = shuffleDeck(deck);
    
    // 为每个玩家发牌
    const gamePlayers = [];
    let totalPot = 0;
    
    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      
      // 扣除底分
      if (player.score < baseScore) {
        throw new Error(`玩家 ${player.nickname} 积分不足，无法开始游戏`);
      }
      
      // 发牌
      const handCards = [
        shuffledDeck.pop(),
        shuffledDeck.pop(),
        shuffledDeck.pop()
      ];
      
      // 计算牌型
      const cardType = evaluateHand(handCards);
      
      gamePlayers.push({
        openId: player.openId,
        handCards: handCards,
        hasChecked: false,
        currentBet: baseScore,
        totalBet: baseScore,
        status: 'playing',
        cardType: cardType
      });
      
      totalPot += baseScore;
      
      // 更新玩家积分
      await db.collection('rooms').where({ roomId: roomId }).update({
        data: {
          [`players.${i}.score`]: _.inc(-baseScore)
        }
      });
    }
    
    // 获取房间信息以确定庄家
    const roomRes = await db.collection('rooms').where({ roomId: roomId }).get();
    const room = roomRes.data[0];
    
    // 确定庄家索引，如果没有庄家或找不到庄家，则默认为0
    let dealerIndex = 0;
    if (room.dealerId) {
      const dealerPlayerIndex = gamePlayers.findIndex(p => p.openId === room.dealerId);
      if (dealerPlayerIndex !== -1) {
        dealerIndex = dealerPlayerIndex;
      }
    }
    
    console.log('开始游戏: 庄家ID =', room.dealerId, '庄家索引 =', dealerIndex);
    
    // 创建游戏记录
    await db.collection('games').add({
      data: {
        roomId: roomId,
        gameId: gameId,
        players: gamePlayers,
        totalPot: totalPot,
        currentPlayerIndex: dealerIndex, // 从庄家开始
        round: 1,
        status: 'playing',
        createTime: db.serverDate(),
        lastActionTime: db.serverDate(),
        winner: {},
        winnerId: null
      }
    });
    
    // 更新房间状态
    await db.collection('rooms').where({ roomId: roomId }).update({
      data: {
        status: 'playing',
        currentGameId: gameId
      }
    });
    
    return { success: true, message: '游戏开始' };
  } catch (error) {
    console.error('开始游戏错误:', error);
    throw error;
  }
}

// 看牌
async function checkCards(event, openId) {
  const { roomId } = event;
  
  try {
    // 获取房间信息
    const roomRes = await db.collection('rooms').where({ roomId: roomId }).get();
    if (roomRes.data.length === 0) {
      return { success: false, message: '房间不存在' };
    }
    
    const room = roomRes.data[0];
    
    // 检查游戏状态
    if (room.status !== 'playing' || !room.currentGameId) {
      return { success: false, message: '游戏未开始' };
    }
    
    // 获取游戏信息
    const gameRes = await db.collection('games').where({ gameId: room.currentGameId }).get();
    if (gameRes.data.length === 0) {
      return { success: false, message: '游戏数据不存在' };
    }
    
    const game = gameRes.data[0];
    
    // 查找玩家
    const playerIndex = game.players.findIndex(p => p.openId === openId);
    if (playerIndex === -1) {
      return { success: false, message: '您不在该游戏中' };
    }
    
    // 检查玩家状态
    if (game.players[playerIndex].status !== 'playing') {
      return { success: false, message: '您已经弃牌或出局' };
    }
    
    // 更新玩家看牌状态
    await db.collection('games').where({ gameId: room.currentGameId }).update({
      data: {
        [`players.${playerIndex}.hasChecked`]: true
      }
    });
    
    return { 
      success: true, 
      message: '看牌成功',
      cards: game.players[playerIndex].handCards,
      cardType: game.players[playerIndex].cardType
    };
  } catch (error) {
    console.error('看牌错误:', error);
    return { success: false, message: error.message };
  }
}

// 跟注
async function followBet(event, openId) {
  const { roomId } = event;
  
  try {
    // 获取房间信息
    const roomRes = await db.collection('rooms').where({ roomId: roomId }).get();
    if (roomRes.data.length === 0) {
      return { success: false, message: '房间不存在' };
    }
    
    const room = roomRes.data[0];
    
    // 检查游戏状态
    if (room.status !== 'playing' || !room.currentGameId) {
      return { success: false, message: '游戏未开始' };
    }
    
    // 获取游戏信息
    const gameRes = await db.collection('games').where({ gameId: room.currentGameId }).get();
    if (gameRes.data.length === 0) {
      return { success: false, message: '游戏数据不存在' };
    }
    
    const game = gameRes.data[0];
    
    // 检查是否轮到该玩家
    if (game.players[game.currentPlayerIndex].openId !== openId) {
      return { success: false, message: '现在不是您的回合' };
    }
    
    // 查找玩家
    const playerIndex = game.currentPlayerIndex;
    const player = game.players[playerIndex];
    
    // 检查玩家状态
    if (player.status !== 'playing') {
      return { success: false, message: '您已经弃牌或出局' };
    }
    
    // 计算需要跟注的金额
    const maxBet = Math.max(...game.players.filter(p => p.status === 'playing').map(p => p.currentBet));
    const betAmount = maxBet - player.currentBet;
    
    if (betAmount <= 0) {
      return { success: false, message: '当前没有需要跟注的金额' };
    }
    
    // 查找玩家在房间中的索引
    const roomPlayerIndex = room.players.findIndex(p => p.openId === openId);
    if (roomPlayerIndex === -1) {
      return { success: false, message: '您不在该房间中' };
    }
    
    // 检查玩家积分是否足够
    if (room.players[roomPlayerIndex].score < betAmount) {
      return { success: false, message: '您的积分不足' };
    }
    
    // 更新玩家积分
    await db.collection('rooms').where({ roomId: roomId }).update({
      data: {
        [`players.${roomPlayerIndex}.score`]: _.inc(-betAmount)
      }
    });
    
    // 更新游戏数据
    // 计算下一个有效玩家的索引（排除状态为fold的玩家）
    const nextPlayerIndex = getNextValidPlayerIndex(game.players, playerIndex);
    
    await db.collection('games').where({ gameId: room.currentGameId }).update({
      data: {
        [`players.${playerIndex}.currentBet`]: maxBet,
        [`players.${playerIndex}.totalBet`]: player.totalBet + betAmount,
        totalPot: _.inc(betAmount),
        currentPlayerIndex: nextPlayerIndex,
        lastActionTime: db.serverDate()
      }
    });
    
    // 检查是否需要结束游戏
    await checkGameEnd(room.currentGameId);
    
    return { success: true, message: '跟注成功' };
  } catch (error) {
    console.error('跟注错误:', error);
    return { success: false, message: error.message };
  }
}

// 加注
async function raiseBet(event, openId) {
  const { roomId, amount } = event;
  const raiseAmount = parseInt(amount);
  
  if (isNaN(raiseAmount) || raiseAmount <= 0) {
    return { success: false, message: '加注金额无效' };
  }
  
  try {
    // 获取房间信息
    const roomRes = await db.collection('rooms').where({ roomId: roomId }).get();
    if (roomRes.data.length === 0) {
      return { success: false, message: '房间不存在' };
    }
    
    const room = roomRes.data[0];
    
    // 检查游戏状态
    if (room.status !== 'playing' || !room.currentGameId) {
      return { success: false, message: '游戏未开始' };
    }
    
    // 获取游戏信息
    const gameRes = await db.collection('games').where({ gameId: room.currentGameId }).get();
    if (gameRes.data.length === 0) {
      return { success: false, message: '游戏数据不存在' };
    }
    
    const game = gameRes.data[0];
    
    // 检查是否轮到该玩家
    if (game.players[game.currentPlayerIndex].openId !== openId) {
      return { success: false, message: '现在不是您的回合' };
    }
    
    // 查找玩家
    const playerIndex = game.currentPlayerIndex;
    const player = game.players[playerIndex];
    
    // 检查玩家状态
    if (player.status !== 'playing') {
      return { success: false, message: '您已经弃牌或出局' };
    }
    
    // 计算当前最高下注
    const maxBet = Math.max(...game.players.filter(p => p.status === 'playing').map(p => p.currentBet));
    
    // 检查加注金额是否合法（必须大于当前最高下注）
    const newBet = player.currentBet + raiseAmount;
    if (newBet <= maxBet) {
      return { success: false, message: '加注金额必须大于当前最高下注' };
    }
    
    // 查找玩家在房间中的索引
    const roomPlayerIndex = room.players.findIndex(p => p.openId === openId);
    if (roomPlayerIndex === -1) {
      return { success: false, message: '您不在该房间中' };
    }
    
    // 检查玩家积分是否足够
    if (room.players[roomPlayerIndex].score < raiseAmount) {
      return { success: false, message: '您的积分不足' };
    }
    
    // 更新玩家积分
    await db.collection('rooms').where({ roomId: roomId }).update({
      data: {
        [`players.${roomPlayerIndex}.score`]: _.inc(-raiseAmount)
      }
    });
    
    // 更新游戏数据
    // 计算下一个有效玩家的索引（排除状态为fold的玩家）
    const nextPlayerIndex = getNextValidPlayerIndex(game.players, playerIndex);
    
    await db.collection('games').where({ gameId: room.currentGameId }).update({
      data: {
        [`players.${playerIndex}.currentBet`]: newBet,
        [`players.${playerIndex}.totalBet`]: player.totalBet + raiseAmount,
        totalPot: _.inc(raiseAmount),
        currentPlayerIndex: nextPlayerIndex,
        lastActionTime: db.serverDate()
      }
    });
    
    // 检查是否需要结束游戏
    await checkGameEnd(room.currentGameId);
    
    return { success: true, message: '加注成功' };
  } catch (error) {
    console.error('加注错误:', error);
    return { success: false, message: error.message };
  }
}

// 比牌
async function compareCards(event, openId) {
  const { roomId, targetPlayerId } = event;
  
  if (!targetPlayerId) {
    return { success: false, message: '请选择要比牌的玩家' };
  }
  
  try {
    // 获取房间信息
    const roomRes = await db.collection('rooms').where({ roomId: roomId }).get();
    if (roomRes.data.length === 0) {
      return { success: false, message: '房间不存在' };
    }
    
    const room = roomRes.data[0];
    
    // 检查游戏状态
    if (room.status !== 'playing' || !room.currentGameId) {
      return { success: false, message: '游戏未开始' };
    }
    
    // 获取游戏信息
    const gameRes = await db.collection('games').where({ gameId: room.currentGameId }).get();
    if (gameRes.data.length === 0) {
      return { success: false, message: '游戏数据不存在' };
    }
    
    const game = gameRes.data[0];
    
    // 检查是否轮到该玩家
    if (game.players[game.currentPlayerIndex].openId !== openId) {
      return { success: false, message: '现在不是您的回合' };
    }
    
    // 查找当前玩家
    const playerIndex = game.currentPlayerIndex;
    const player = game.players[playerIndex];
    
    // 检查玩家状态
    if (player.status !== 'playing') {
      return { success: false, message: '您已经弃牌或出局' };
    }
    
    // 查找目标玩家
    const targetPlayerIndex = game.players.findIndex(p => p.openId === targetPlayerId);
    if (targetPlayerIndex === -1) {
      return { success: false, message: '目标玩家不存在' };
    }
    
    const targetPlayer = game.players[targetPlayerIndex];
    
    // 检查目标玩家状态
    if (targetPlayer.status !== 'playing') {
      return { success: false, message: '目标玩家已经弃牌或出局' };
    }
    
    // 比较牌型
    const compareResult = compareHands(player.handCards, targetPlayer.handCards);
    
    // 确定输家
    const loserIndex = compareResult > 0 ? targetPlayerIndex : playerIndex;
    const loser = game.players[loserIndex];
    
    // 更新游戏数据，将输家状态设为out
    // 先更新玩家状态
    const updatedPlayers = [...game.players];
    updatedPlayers[loserIndex].status = 'out';
    
    // 计算下一个有效玩家的索引（排除状态为fold和out的玩家）
    const nextPlayerIndex = getNextValidPlayerIndex(updatedPlayers, playerIndex);
    
    await db.collection('games').where({ gameId: room.currentGameId }).update({
      data: {
        [`players.${loserIndex}.status`]: 'out',
        currentPlayerIndex: nextPlayerIndex,
        lastActionTime: db.serverDate()
      }
    });
    
    // 检查是否需要结束游戏
    await checkGameEnd(room.currentGameId);
    
    return { 
      success: true, 
      message: `比牌结果: ${compareResult > 0 ? '您赢了' : '您输了'}`,
      winner: compareResult > 0 ? openId : targetPlayerId,
      loser: compareResult > 0 ? targetPlayerId : openId
    };
  } catch (error) {
    console.error('比牌错误:', error);
    return { success: false, message: error.message };
  }
}

// 弃牌
async function foldCards(event, openId) {
  const { roomId } = event;
  
  try {
    // 获取房间信息
    const roomRes = await db.collection('rooms').where({ roomId: roomId }).get();
    if (roomRes.data.length === 0) {
      return { success: false, message: '房间不存在' };
    }
    
    const room = roomRes.data[0];
    
    // 检查游戏状态
    if (room.status !== 'playing' || !room.currentGameId) {
      return { success: false, message: '游戏未开始' };
    }
    
    // 获取游戏信息
    const gameRes = await db.collection('games').where({ gameId: room.currentGameId }).get();
    if (gameRes.data.length === 0) {
      return { success: false, message: '游戏数据不存在' };
    }
    
    const game = gameRes.data[0];
    
    // 检查是否轮到该玩家
    if (game.players[game.currentPlayerIndex].openId !== openId) {
      return { success: false, message: '现在不是您的回合' };
    }
    
    // 查找玩家
    const playerIndex = game.currentPlayerIndex;
    const player = game.players[playerIndex];
    
    // 检查玩家状态
    if (player.status !== 'playing') {
      return { success: false, message: '您已经弃牌或出局' };
    }
    
    // 更新游戏数据
    // 先将当前玩家状态设为fold
    const updatedPlayers = [...game.players];
    updatedPlayers[playerIndex].status = 'fold';
    
    // 计算下一个有效玩家的索引（排除状态为fold的玩家）
    const nextPlayerIndex = getNextValidPlayerIndex(updatedPlayers, playerIndex);
    
    await db.collection('games').where({ gameId: room.currentGameId }).update({
      data: {
        [`players.${playerIndex}.status`]: 'fold',
        currentPlayerIndex: nextPlayerIndex,
        lastActionTime: db.serverDate()
      }
    });
    
    // 检查是否需要结束游戏
    await checkGameEnd(room.currentGameId);
    
    return { success: true, message: '弃牌成功' };
  } catch (error) {
    console.error('弃牌错误:', error);
    return { success: false, message: error.message };
  }
}

// 获取下一个有效玩家的索引（排除状态为fold或out的玩家）
function getNextValidPlayerIndex(players, currentIndex) {
  const playerCount = players.length;
  let nextIndex = (currentIndex + 1) % playerCount;
  
  // 循环查找下一个状态是playing的玩家
  let loopCount = 0;
  while (loopCount < playerCount) {
    if (players[nextIndex].status === 'playing') {
      return nextIndex;
    }
    nextIndex = (nextIndex + 1) % playerCount;
    loopCount++;
  }
  
  // 如果没有找到状态为playing的玩家，检查游戏是否应该结束
  // 这种情况通常不会发生，因为checkGameEnd函数会在适当的时候结束游戏
  // 但为了安全起见，我们返回原索引
  return currentIndex;
}

// 检查游戏是否结束
async function checkGameEnd(gameId) {
  try {
    console.log('检查游戏是否结束', gameId);
    // 获取游戏信息
    const gameRes = await db.collection('games').where({ gameId: gameId }).get();
    if (gameRes.data.length === 0) {
      return;
    }
    
    const game = gameRes.data[0];
    console.log('检查游戏是否结束____game', game);
    // 检查剩余玩家数量
    const activePlayers = game.players.filter(p => p.status === 'playing');
    
    // 如果只剩一名玩家，游戏结束
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      console.log('检查游戏是否结束____winner', winner);
      console.log('检查游戏是否结束____winner.cardType', winner.cardType);

      // 确保 winner 对象有 cardType 字段
      if (!winner.cardType) {
        winner.cardType = evaluateHand(winner.handCards);
      }
      
      // 计算每个玩家的积分变化
      const scoreChanges = {};
      game.players.forEach(player => {
        if (player.openId === winner.openId) {
          scoreChanges[player.openId] = game.totalPot;
        } else {
          scoreChanges[player.openId] = -player.totalBet;
        }
      });
      
      // 更新游戏状态
      await db.collection('games').where({ gameId: gameId }).update({
        data: {
          status: 'ended',
          winner: winner,
          winnerId: winner.openId,
          endTime: db.serverDate(),
          scoreChanges: scoreChanges
        }
      });
      
      // 更新房间状态，并重置所有玩家isReady为false，切换庄家为赢家
      const roomRes2 = await db.collection('rooms').where({ roomId: game.roomId }).get();
      if (roomRes2.data.length > 0) {
        const room2 = roomRes2.data[0];
        const resetPlayers = room2.players.map(p => ({ ...p, isReady: false }));
        await db.collection('rooms').where({ roomId: game.roomId }).update({
          data: {
            status: 'waiting',
            currentGameId: null,
            dealerId: winner.openId,
            players: resetPlayers
          }
        });
        // 更新赢家积分
        const winnerIndex = resetPlayers.findIndex(p => p.openId === winner.openId);
        if (winnerIndex !== -1) {
          await db.collection('rooms').where({ roomId: game.roomId }).update({
            data: {
              [`players.${winnerIndex}.score`]: _.inc(game.totalPot)
            }
          });
        }
      }
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('检查游戏结束错误:', error);
    return false;
  }
}

// 生成一副牌
function generateDeck() {
  const suits = ['♠', '♥', '♣', '♦'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
  }
  
  return deck;
}

// 洗牌
function shuffleDeck(deck) {
  const shuffled = [...deck];
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

// 评估手牌
function evaluateHand(cards) {
  // 检查是否是同花顺
  if (isStraightFlush(cards)) {
    return 'straight_flush';
  }
  
  // 检查是否是豹子（三条）
  if (isThreeOfAKind(cards)) {
    return 'three_of_a_kind';
  }
  
  // 检查是否是同花
  if (isFlush(cards)) {
    return 'flush';
  }
  
  // 检查是否是顺子
  if (isStraight(cards)) {
    return 'straight';
  }
  
  // 检查是否是对子
  if (isPair(cards)) {
    return 'pair';
  }
  
  // 散牌
  return 'high_card';
}

// 检查是否是同花顺
function isStraightFlush(cards) {
  return isFlush(cards) && isStraight(cards);
}

// 检查是否是豹子（三条）
function isThreeOfAKind(cards) {
  const values = cards.map(card => card.value);
  return values[0] === values[1] && values[1] === values[2];
}

// 检查是否是同花
function isFlush(cards) {
  const suits = cards.map(card => card.suit);
  return suits[0] === suits[1] && suits[1] === suits[2];
}

// 检查是否是顺子
function isStraight(cards) {
  const valueMap = {
    'A': 1,
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    '7': 7,
    '8': 8,
    '9': 9,
    '10': 10,
    'J': 11,
    'Q': 12,
    'K': 13
  };
  
  const values = cards.map(card => valueMap[card.value]).sort((a, b) => a - b);
  
  // 特殊情况：A-2-3
  if (values[0] === 1 && values[1] === 2 && values[2] === 3) {
    return true;
  }
  
  // 特殊情况：Q-K-A
  if (values[0] === 1 && values[1] === 12 && values[2] === 13) {
    return true;
  }
  
  // 一般情况
  return values[1] === values[0] + 1 && values[2] === values[1] + 1;
}

// 检查是否是对子
function isPair(cards) {
  const values = cards.map(card => card.value);
  return values[0] === values[1] || values[1] === values[2] || values[0] === values[2];
}

// 比较两手牌
function compareHands(hand1, hand2) {
  const type1 = evaluateHand(hand1);
  const type2 = evaluateHand(hand2);
  
  const typeRank = {
    'high_card': 1,
    'pair': 2,
    'straight': 3,
    'flush': 4,
    'straight_flush': 5,
    'three_of_a_kind': 6
  };
  
  // 比较牌型大小
  if (typeRank[type1] !== typeRank[type2]) {
    return typeRank[type1] > typeRank[type2] ? 1 : -1;
  }
  
  // 牌型相同，比较具体大小
  switch (type1) {
    case 'three_of_a_kind':
      return compareValues(hand1[0].value, hand2[0].value);
    case 'pair':
      return comparePairs(hand1, hand2);
    default:
      return compareHighCards(hand1, hand2);
  }
}

// 比较对子
function comparePairs(hand1, hand2) {
  const values1 = hand1.map(card => card.value);
  const values2 = hand2.map(card => card.value);
  
  // 找出对子的值
  let pair1, pair2;
  
  if (values1[0] === values1[1]) {
    pair1 = values1[0];
  } else if (values1[1] === values1[2]) {
    pair1 = values1[1];
  } else {
    pair1 = values1[0]; // values1[0] === values1[2]
  }
  
  if (values2[0] === values2[1]) {
    pair2 = values2[0];
  } else if (values2[1] === values2[2]) {
    pair2 = values2[1];
  } else {
    pair2 = values2[0]; // values2[0] === values2[2]
  }
  
  return compareValues(pair1, pair2);
}

// 比较散牌
function compareHighCards(hand1, hand2) {
  const valueMap = {
    'A': 14, // 这里A当作最大
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    '7': 7,
    '8': 8,
    '9': 9,
    '10': 10,
    'J': 11,
    'Q': 12,
    'K': 13
  };
  
  const values1 = hand1.map(card => valueMap[card.value]).sort((a, b) => b - a);
  const values2 = hand2.map(card => valueMap[card.value]).sort((a, b) => b - a);
  
  for (let i = 0; i < values1.length; i++) {
    if (values1[i] !== values2[i]) {
      return values1[i] > values2[i] ? 1 : -1;
    }
  }
  
  return 0; // 完全相同
}

// 比较牌面值大小
function compareValues(value1, value2) {
  const valueMap = {
    'A': 14, // 这里A当作最大
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    '7': 7,
    '8': 8,
    '9': 9,
    '10': 10,
    'J': 11,
    'Q': 12,
    'K': 13
  };
  
  const v1 = valueMap[value1];
  const v2 = valueMap[value2];
  
  if (v1 > v2) return 1;
  if (v1 < v2) return -1;
  return 0;
}