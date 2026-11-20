const { request, clearSession, loginWechat } = require('../../services/http');
Page({
  data: { busy: false },
  async onShow() {
    try { this.setData({ account: await request('/api/me/security'), pendingOrder: wx.getStorageSync('yourher:pending-order') || '' }); }
    catch (error) { this.setData({ error: error.message || '无法读取账号状态' }); }
  },
  async handleWechatLogin() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const { code } = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }));
      await loginWechat(code);
      // Leave the new session cookie intact and discard views cached under the guest identity.
      for (const key of wx.getStorageInfoSync().keys) {
        if (!key.startsWith('yourher:http-session:')) wx.removeStorageSync(key);
      }
      require('../../services/api').resetAccountCache();
      wx.reLaunch({ url: '/pages/home/index' });
    } catch (error) {
      this.setData({ error: error.message || '微信登录失败' });
    } finally {
      this.setData({ busy: false });
    }
  },
  async handleBindPhone(event) {
    if (!event.detail.code || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      this.setData({ account: await request('/api/me/phone', { method: 'POST', data: { code: event.detail.code } }) });
    } catch (error) {
      this.setData({ error: error.message || '绑定失败' });
    } finally {
      this.setData({ busy: false });
    }
  },
  async handlePurchase() {
    if (this.data.busy || !this.data.account?.paymentAvailable) return;
    if (!wx.requestVirtualPayment) { this.setData({ error: '当前微信版本不支持支付' }); return; }
    this.setData({ busy: true, error: '' });
    try {
      const { code } = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }));
      const { orderId, ...params } = await request('/api/pay/order', { method: 'POST', data: { code } });
      this.setData({ pendingOrder: orderId });
      wx.setStorageSync('yourher:pending-order', orderId);
      await new Promise((resolve, reject) => wx.requestVirtualPayment({ ...params, success: resolve, fail: reject }));
      await this.confirmPurchase(orderId);
    } catch (error) {
      this.setData({ error: error.message || '支付未完成，可查询订单' });
    } finally {
      this.setData({ busy: false });
    }
  },
  async confirmPurchase(orderId) {
    const result = await request('/api/pay/confirm', { method: 'POST', data: { orderId } });
    if (!result.ok) {
      this.setData({ error: '微信尚未确认付款，请稍后查询' });
      return;
    }
    wx.removeStorageSync('yourher:pending-order');
    this.setData({ account: result.user, pendingOrder: '', error: '' });
  },
  async handleConfirmPurchase() {
    if (this.data.busy || !this.data.pendingOrder) return;
    this.setData({ busy: true });
    try { await this.confirmPurchase(this.data.pendingOrder); }
    catch (error) { this.setData({ error: error.message || '订单查询失败' }); }
    finally { this.setData({ busy: false }); }
  },
  handleSubscribe() {
    const templateId = this.data.account?.weeklyTemplateId;
    if (!templateId || !wx.requestSubscribeMessage) return;
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: async result => {
        if (result[templateId] !== 'accept') return;
        try {
          await request('/api/me/weekly-subscription', { method: 'POST', data: { templateId } });
          wx.showToast({ title: '已订阅下次信件通知', icon: 'success' });
        } catch (error) {
          this.setData({ error: error.message || '无法保存订阅' });
        }
      },
      fail: () => this.setData({ error: '微信未完成订阅授权' })
    });
  },
  handleDismissOrder() {
    wx.removeStorageSync('yourher:pending-order');
    this.setData({ pendingOrder: '' });
  },
  handleBack() { wx.navigateBack(); },
  async handleExport() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const data = await request('/api/export');
      const filePath = wx.env.USER_DATA_PATH + '/YourHer-data.json';
      wx.getFileSystemManager().writeFile({filePath, data: JSON.stringify(data, null, 2), encoding: 'utf8',
        success: () => {
          if (typeof wx.shareFileMessage === 'function') wx.shareFileMessage({filePath, fileName: 'YourHer-data.json', fail: () => wx.showModal({title: '文件已保存', content: filePath, showCancel: false})});
          else wx.showModal({title: '数据已导出', content: filePath, showCancel: false});
        },
        fail: () => wx.showToast({title: '导出失败', icon: 'none'})});
    } catch (e) { wx.showToast({ title: e.message || '导出失败', icon: 'none' }); }
    finally { this.setData({ busy: false }); }
  },
  handleDelete() {
    if (this.data.busy) return;
    wx.showModal({title: '删除全部数据', content: '将永久删除当前设备会话的对话、记忆、心情和信件。请输入 DELETE ALL MY DATA 确认。', editable: true,
      success: async result => {
        if (!result.confirm || result.content !== 'DELETE ALL MY DATA') return;
        this.setData({busy: true});
        try {
          await request('/api/account', {method: 'DELETE', data: {confirm: result.content}});
          clearSession();
          wx.clearStorageSync();
          require('../../services/api').resetAccountCache();
          wx.reLaunch({url: '/pages/home/index'});
        } catch (e) { wx.showToast({title: e.message || '删除失败', icon: 'none'}); }
        finally { this.setData({busy: false}); }
      }});
  }
});
