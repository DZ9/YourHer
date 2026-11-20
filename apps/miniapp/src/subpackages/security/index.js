const { request, clearSession } = require('../../services/http');
Page({
  data: { busy: false },
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
          wx.reLaunch({url: '/pages/chat/index'});
        } catch (e) { wx.showToast({title: e.message || '删除失败', icon: 'none'}); }
        finally { this.setData({busy: false}); }
      }});
  }
});
