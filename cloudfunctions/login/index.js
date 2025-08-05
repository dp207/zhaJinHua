const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { code, nickname, avatarUrl } = event;
    try {
      // 1. 调用微信官方接口换取 openid
      const wxContext = cloud.getWXContext();
      const openid = wxContext.OPENID;

      // 2. 查询 users 数据库集合，判断用户是否存在
      const userRes = await db.collection('users').where({
        _openid: openid
      }).get();

      let userInfo;
      if (userRes.data.length > 0) {
        // 用户存在，更新用户信息
        userInfo = userRes.data[0];
        await db.collection('users').doc(userInfo._id).update({
          data: {
            nickname: nickname,
            avatarUrl: avatarUrl,
            updatedAt: db.serverDate()
          }
        });
        userInfo = { ...userInfo, nickname, avatarUrl }; // 更新返回的userInfo
      } else {
        // 用户不存在，创建新用户记录
        const addRes = await db.collection('users').add({
          data: {
            _openid: openid,
            nickname: nickname,
            avatarUrl: avatarUrl,
            score: 1000, // 初始积分
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
        userInfo = {
          _id: addRes._id,
          _openid: openid,
          nickname: nickname,
          avatarUrl: avatarUrl,
          score: 1000,
          createdAt: new Date(), // 这里需要注意，db.serverDate() 返回的是一个特殊对象，前端可能需要处理
          updatedAt: new Date()
        };
      }

      return {
        code: 0,
        data: userInfo,
        message: '登录成功'
      };

    } catch (e) {
      console.error('登录云函数错误:', e);
      return {
        code: 1002, // 微信接口调用失败或数据库操作失败
        message: '登录失败，服务器内部错误'
      };
    }
};