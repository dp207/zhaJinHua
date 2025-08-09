// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  switch (event.type) {
    case 'createRoom':
      return createRoom(event, context);
    case 'joinRoom':
      return joinRoom(event, context);
    case 'leaveRoom':
      return leaveRoom(event, context);
    case 'dismissRoom':
      return dismissRoom(event, context);
    case 'getRoomInfo':
      return getRoomInfo(event, context);
    case 'updatePlayerReady':
      return updatePlayerReady(event, context);
    default:
      return { success: false, message: '未知操作类型' };
  }
};

async function createRoom(event, context) {
  const { roomType, baseScore, initialScore, userInfo } = event;
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;

  // 生成唯一的房间号
  let roomId = '';
  const characters = '0123456789';
  //const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let i = 0; i < 6; i++) {
    roomId += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  // 检查房间号是否已存在，简单起见，这里不循环检查，实际应用中可能需要更健壮的检查机制
  const existingRoom = await db.collection('rooms').where({ roomId: roomId }).get();
  if (existingRoom.data.length > 0) {
    return { success: false, message: '房间号已存在，请重试' };
  }

  // 创建房间数据
  const roomData = {
      roomId: roomId,
      roomType: roomType,
      baseScore: baseScore,
      initialScore: initialScore, // 新增字段，确保房间信息包含初始积分
      owner: openId,
      dealerId: openId, // 新增字段，庄家初始为房主
      players: [{
        openId: openId,
        nickname: userInfo ? userInfo.nickName : '玩家',
        avatarUrl: userInfo ? userInfo.avatarUrl : 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
        score: (roomType === 'private' && initialScore !== undefined) ? initialScore : 0,
        isOwner: true,
        isReady: false // 房主默认未准备
      }],
      status: 'waiting',
      createTime: db.serverDate()
    };

  try {
    const result = await db.collection('rooms').add({
      data: roomData
    });
    
    // 获取房间ID
    const roomDocId = result._id;

    // 如果是私人房间，为房主分配初始积分
   // if (roomType === 'private' && initialScore !== undefined) {
    //  await db.collection('users').where({ openId: openId }).update({
    //    data: {
    //      score: _.inc(initialScore)
     //   }
    //  });
    //}

    // 获取创建后的房间信息
    const createdRoomRes = await db.collection('rooms').doc(roomDocId).get();
    return { success: true, roomId: roomId, roomInfo: createdRoomRes.data };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

async function joinRoom(event, context) {
  const { roomId, initialScore, userInfo } = event;
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;

  try {
    const roomRes = await db.collection('rooms').where({ roomId: roomId }).get();
    if (roomRes.data.length === 0) {
      return { success: false, message: '房间不存在' };
    }

    const room = roomRes.data[0];

    // 检查玩家是否已在房间中
    const playerIndex = room.players.findIndex(player => player.openId === openId);
    if (playerIndex > -1) {
      // 玩家已存在，检查并更新信息
      const player = room.players[playerIndex];
      let needsUpdate = false;
      const updatedPlayer = { ...player };

      if (userInfo) {
        // 记录用户信息日志
        await cloud.logger().info({
          tag: 'joinRoom-updatePlayer',
          userInfo: userInfo,
          nickName: userInfo.nickName,
          nickname: userInfo.nickname,
          playerNickname: player.nickname,
          playerNickName: player.nickName
        });
        
        // 清理头像URL
        let cleanAvatarUrl = userInfo.avatarUrl;
        if (cleanAvatarUrl) {
          // 移除所有空格
          cleanAvatarUrl = cleanAvatarUrl.replace(/\s+/g, '');
          // 移除URL两端可能存在的引号和反引号
          if ((cleanAvatarUrl.startsWith('"') || cleanAvatarUrl.startsWith('\'') || cleanAvatarUrl.startsWith('`')) && 
              (cleanAvatarUrl.endsWith('"') || cleanAvatarUrl.endsWith('\'') || cleanAvatarUrl.endsWith('`'))) {
            cleanAvatarUrl = cleanAvatarUrl.substring(1, cleanAvatarUrl.length - 1);
          }
          // 移除URL中间可能存在的反引号
          cleanAvatarUrl = cleanAvatarUrl.replace(/`/g, '');
        }
        
        // 确保有昵称，优先使用 nickName
        let displayName = player.nickname;
        if (userInfo.nickName) {
          displayName = userInfo.nickName;
        } else if (userInfo.nickname) {
          displayName = userInfo.nickname;
        }
        
        // 更新昵称
        if (player.nickname !== displayName) {
          updatedPlayer.nickname = displayName;
          updatedPlayer.nickName = displayName; // 同时设置两个字段以确保兼容性
          needsUpdate = true;
        }
        
        // 更新头像
        if (player.avatarUrl !== cleanAvatarUrl) {
          updatedPlayer.avatarUrl = cleanAvatarUrl || player.avatarUrl;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        const updatedPlayers = [...room.players];
        updatedPlayers[playerIndex] = updatedPlayer;
        await db.collection('rooms').doc(room._id).update({
          data: { players: updatedPlayers }
        });
        room.players = updatedPlayers;
      }
      return { success: true, message: '您已在房间中', roomInfo: room };
    }

    // 检查房间是否已满 (假设最多4人)
    if (room.players.length >= 4) {
      return { success: false, message: '房间已满' };
    }

    // 检查房间状态，如果房间已开始游戏，则不允许新玩家加入，但允许已在房间中的玩家重新加入
    if (room.status === 'playing' ) {
      return { success: false, message: '房间已开始游戏，无法加入新玩家' };
    } else if (room.status === 'ended') {
      return { success: false, message: '房间已结束' };
    }
     // 日志：参数检查
    await cloud.logger().info({
      tag: 'joinRoom-param-2',
      openId,
      roomType: room.roomType,
      initialScore,
      eventInitialScore: (room.roomType === 'private' && room.initialScore !== undefined) ? room.initialScore : 0, 
      initialScoreType: typeof initialScore
    });

    // 添加新玩家到房间
    // 清理头像URL
    let cleanAvatarUrl = userInfo?.avatarUrl;
    if (cleanAvatarUrl) {
      // 移除所有空格
      cleanAvatarUrl = cleanAvatarUrl.replace(/\s+/g, '');
      // 移除URL两端可能存在的引号和反引号
      if ((cleanAvatarUrl.startsWith('"') || cleanAvatarUrl.startsWith('\'') || cleanAvatarUrl.startsWith('`')) && 
          (cleanAvatarUrl.endsWith('"') || cleanAvatarUrl.endsWith('\'') || cleanAvatarUrl.endsWith('`'))) {
        cleanAvatarUrl = cleanAvatarUrl.substring(1, cleanAvatarUrl.length - 1);
      }
      // 移除URL中间可能存在的反引号
      cleanAvatarUrl = cleanAvatarUrl.replace(/`/g, '');
    }
    
    // 记录用户信息日志
    await cloud.logger().info({
      tag: 'joinRoom-userInfo',
      userInfo: userInfo,
      nickName: userInfo?.nickName,
      nickname: userInfo?.nickname
    });
    
    // 确保有昵称，优先使用 nickName
    let displayName = '玩家';
    if (userInfo?.nickName) {
      displayName = userInfo.nickName;
    } else if (userInfo?.nickname) {
      displayName = userInfo.nickname;
    }
    
    const newPlayer = {
      openId: openId,
      nickname: displayName,
      nickName: displayName, // 同时设置两个字段以确保兼容性
      avatarUrl: cleanAvatarUrl || 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
      score: (room.roomType === 'private' && room.initialScore !== undefined) ? room.initialScore : 0,
      isOwner: false,
      isReady: false // 新加入的玩家默认未准备
    };
    
    await db.collection('rooms').where({ roomId: roomId }).update({
      data: {
        players: _.push(newPlayer)
      }
    });

    // 如果是私人房间，为新加入的玩家分配初始积分
   // if (room.roomType === 'private' && initialScore !== undefined) {
     // await db.collection('users').where({ openId: openId }).update({
       // data: {
         // score: _.inc(initialScore)
     //   }
     // });
    //}

    // 同步用户表头像昵称
    if (userInfo) {
      await db.collection('users').where({ openId: openId }).update({
        data: {
          nickName: userInfo.nickName,
          avatarUrl: userInfo.avatarUrl
        }
      });
    }

    // 获取更新后的房间信息
    const updatedRoomRes = await db.collection('rooms').where({ roomId: roomId }).get();
    const updatedRoom = updatedRoomRes.data[0];
    return { success: true, roomId: roomId, roomInfo: updatedRoom };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

async function leaveRoom(event, context) {
  const { roomId } = event;
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;

  try {
    const roomRes = await db.collection('rooms').where({ roomId: roomId }).get();
    if (roomRes.data.length === 0) {
      return { success: false, message: '房间不存在' };
    }

    const room = roomRes.data[0];

    // 检查玩家是否在房间中
    const playerIndex = room.players.findIndex(player => player.openId === openId);
    if (playerIndex === -1) {
      return { success: false, message: '您不在该房间中' };
    }

    // 如果是房主离开，解散房间
    if (room.players[playerIndex].isOwner) {
      await db.collection('rooms').where({ roomId: roomId }).remove();
      return { success: true, message: '房主离开，房间已解散' };
    }

    // 移除玩家
    const updatedPlayers = room.players.filter(player => player.openId !== openId);
    
    // 移除玩家
    await db.collection('rooms').where({ roomId: roomId }).update({
      data: {
        players: updatedPlayers
      }
    });

    // 如果房间内没有玩家了，将房间状态重置为等待中
    if (updatedPlayers.length === 0) {
      await db.collection('rooms').where({ roomId: roomId }).update({
        data: {
          status: 'waiting' // 重置房间状态
        }
      });
      return { success: true, message: '已离开房间，房间状态已重置' };
    } else {
      return { success: true, message: '已离开房间' };
    }
  } catch (e) {
    return { success: false, message: e.message };
  }
}

async function dismissRoom(event, context) {
  // 待实现
  return { success: false, message: 'dismissRoom 待实现' };
}

async function getRoomInfo(event, context) {
  const { roomId } = event;
  
  try {
    const roomRes = await db.collection('rooms').where({ roomId: roomId }).get();
    if (roomRes.data.length === 0) {
      return { success: false, message: '房间不存在' };
    }
    
    return { success: true, roomInfo: roomRes.data[0] };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

async function updatePlayerReady(event, context) {
  const { roomId, isReady } = event;
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;
  
  try {
    // 获取房间信息
    const roomRes = await db.collection('rooms').where({ roomId: roomId }).get();
    if (roomRes.data.length === 0) {
      return { success: false, message: '房间不存在' };
    }
    
    const room = roomRes.data[0];
    
    // 允许在任何状态下更改准备状态，包括游戏已开始的状态
    console.log('updatePlayerReady: 房间状态:', room.status, '玩家准备状态将更新为:', isReady);
    
    // 查找玩家
    const playerIndex = room.players.findIndex(p => p.openId === openId);
    if (playerIndex === -1) {
      return { success: false, message: '您不在该房间中' };
    }
    
    // 更新玩家准备状态
    const updatedPlayers = [...room.players];
    updatedPlayers[playerIndex].isReady = isReady;
    
    await db.collection('rooms').where({ roomId: roomId }).update({
      data: {
        players: updatedPlayers
      }
    });
    
    // 获取更新后的房间信息
    const updatedRoomRes = await db.collection('rooms').where({ roomId: roomId }).get();
    
    return { 
      success: true, 
      message: isReady ? '已准备' : '已取消准备', 
      roomInfo: updatedRoomRes.data[0] 
    };
  } catch (error) {
    console.error('更新玩家准备状态错误:', error);
    return { success: false, message: error.message };
  }
}