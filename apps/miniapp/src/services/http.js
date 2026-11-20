const config = require('../config');
const KEY = 'yourher:http-session:' + config.baseUrl;
let initializing;

function nativeRequest(path, data, method = 'POST') {
  return new Promise((resolve, reject) => {
    const cookie = wx.getStorageSync(KEY) || '';
    wx.request({
      url: config.baseUrl.replace(/\/$/, '') + path,
      method, data, timeout: 120000,
      header: { 'Content-Type': 'application/json', Cookie: cookie },
      success(response) {
        const headers = response.header || {};
        const value = headers['Set-Cookie'] || headers['set-cookie'] || (response.cookies || []).join(';');
        const match = String(value || '').match(/cike_session=([A-Za-z0-9_-]+)/);
        if (match) wx.setStorageSync(KEY, 'cike_session=' + match[1]);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(response.data && response.data.error || 'YourHer server request failed'));
        } else resolve(response.data);
      },
      fail: reject
    });
  });
}

async function request(path, options = {}) {
  if (!initializing) initializing = nativeRequest('/api/state', undefined, 'GET').catch(error => { initializing = null; throw error; });
  await initializing;
  return nativeRequest('/api/miniapp', {
    path, method: options.method || 'GET', data: options.data || {},
    locale: config.locale,
    consent: Boolean(wx.getStorageSync('privacy:consent-at:' + config.baseUrl))
  });
}

async function loginWechat(code) {
  await request('/api/me');
  return nativeRequest('/api/miniapp/wechat-login', { code });
}

function clearSession() {
  wx.removeStorageSync(KEY);
  initializing = null;
}

module.exports = { request, clearSession, loginWechat };
