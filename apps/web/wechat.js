import { createHmac } from 'node:crypto';

const API = 'https://api.weixin.qq.com';

export function createWechat({ appId, secret, payment, weeklyTemplateId, fetcher = fetch } = {}) {
  if (!appId || !secret) return null;

  async function call(path, query, body) {
    const url = new URL(path, API);
    url.search = new URLSearchParams(query);
    try {
      const response = await fetcher(url, {
        method: body ? 'POST' : 'GET',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(8000)
      });
      const result = await response.json();
      if (response.ok && !result.errcode) return result;
    } catch {
      // Keep upstream URLs and credentials out of client errors.
    }
    throw new Error('微信接口请求失败，请重试');
  }

  let token;
  let expiresAt = 0;
  async function accessToken() {
    if (token && Date.now() < expiresAt) return token;
    const result = await call('/cgi-bin/token', { appid: appId, secret, grant_type: 'client_credential' });
    token = result.access_token;
    expiresAt = Date.now() + Math.max(0, result.expires_in - 120) * 1000;
    if (!token) throw new Error('微信服务认证失败');
    return token;
  }

  async function exchange(code) {
    if (typeof code !== 'string' || !code || code.length > 256) throw new Error('微信登录凭证无效');
    const result = await call('/sns/jscode2session', { appid: appId, secret, js_code: code, grant_type: 'authorization_code' });
    if (!result.openid) throw new Error('未取得微信身份');
    return result;
  }

  const hmac = (key, value) => createHmac('sha256', key).update(value).digest('hex');
  const paymentEnabled = Boolean(payment?.key && payment.offerId && payment.productId &&
    Number.isSafeInteger(payment.priceFen) && payment.priceFen > 0);
  return {
    appId,
    weeklyTemplateId,
    async sendWeekly(openId, letter) {
      await call('/cgi-bin/message/subscribe/send', { access_token: await accessToken() }, {
        touser: openId, template_id: weeklyTemplateId, page: 'pages/records/index?tab=letters',
        data: { time1: { value: letter.week || new Date().toISOString().slice(0, 10) }, thing2: { value: '你的本周信件已准备好' } }
      });
    },
    paymentEnabled,
    paymentPrice: paymentEnabled ? payment.priceFen : null,
    identify: async code => (await exchange(code)).openid,
    async signOrder(code, orderId) {
      if (!paymentEnabled) throw new Error('当前服务器未配置微信支付');
      const session = await exchange(code);
      if (!session.session_key) throw new Error('未取得微信支付会话');
      const signData = JSON.stringify({
        offerId: payment.offerId, productId: payment.productId, env: 0,
        currencyType: 'CNY', buyQuantity: 1, goodsPrice: payment.priceFen, outTradeNo: orderId
      });
      return {
        openId: session.openid, client: {
          mode: 'short_series_goods', signData,
          paySig: hmac(payment.key, 'requestVirtualPayment&' + signData),
          signature: hmac(session.session_key, signData)
        }
      };
    },
    async verifyOrder(order) {
      if (!paymentEnabled || order.offerId !== payment.offerId) return false;
      const path = '/xpay/query_order';
      const body = { openid: order.openId, env: 0, order_id: order.id, offer_id: order.offerId };
      const reply = await call(path, {
        access_token: await accessToken(),
        pay_sig: hmac(payment.key, path + '&' + JSON.stringify(body))
      }, body);
      return [2, 3, 4].includes(Number(reply.order?.status)) && Number(reply.order?.paid_fee) === order.priceFen;
    },
    get offerId() { return payment?.offerId; },
    async phone(code) {
      if (typeof code !== 'string' || !code || code.length > 256) throw new Error('手机号授权凭证无效');
      const result = await call('/wxa/business/getuserphonenumber', { access_token: await accessToken() }, { code });
      const phone = result.phone_info?.phoneNumber;
      if (!/^\+?\d{6,20}$/.test(phone || '') || result.phone_info?.watermark?.appid !== appId) throw new Error('未取得有效手机号');
      return phone;
    }
  };
}
