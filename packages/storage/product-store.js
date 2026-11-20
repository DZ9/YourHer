import { randomUUID, randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { FileStore } from '../memory/file-store.js';
import { MemoryEngine } from '../memory/index.js';
import { localDate } from '../conversation/protocol.js';

const scrypt = promisify(scryptCallback);
const hashToken = value => createHash('sha256').update(value).digest('hex');
import { DEFAULT_PROFILE } from '../companion-core/profile.js';
import { recordMood } from '../companion-core/mood.js';
export { DEFAULT_PROFILE };

export class ProductStore {
  constructor(path, { clock = Date.now } = {}) { this.db = new FileStore(path); this.clock = clock; this.defaults = {}; this.locales = ['en', 'zh-CN']; this.timeZone = 'UTC'; }
  async read(kind, userId) { return (await this.db.read()).filter(r => r.kind === kind && r.userId === userId); }
  async user(id) { return (await this.db.read()).find(r => r.kind === 'user' && r.id === id); }
  async session(token) {
    if (!token || token.length > 200) return null;
    return (await this.db.read()).find(r => r.kind === 'session' && r.digest === hashToken(token) && r.expiresAt > this.clock());
  }
  async startSession(userId) {
    const token = randomBytes(32).toString('base64url');
    await this.db.transact(rows => {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].kind === 'session' && rows[i].expiresAt <= this.clock()) rows.splice(i, 1);
      rows.push({ kind: 'session', id: randomUUID(), userId, digest: hashToken(token), expiresAt: this.clock() + 30 * 86400000 });
    });
    return token;
  }
  async guest() {
    const user = { kind: 'user', id: randomUUID(), createdAt: new Date(this.clock()).toISOString(), email: null, profile: { ...structuredClone(DEFAULT_PROFILE), ...this.defaults } };
    await this.db.transact(rows => rows.push(user));
    return { user, token: await this.startSession(user.id) };
  }
  matchesWechat(user, appId, openId) {
    return user.wechatIdentity === hashToken(JSON.stringify([appId, openId]));
  }
  async linkWechat(id, appId, openId) {
    const key = hashToken(JSON.stringify([appId, openId]));
    return this.db.transact(rows => {
      const current = rows.find(row => row.kind === 'user' && row.id === id);
      if (!current) throw new Error('当前会话已失效');
      if (current.wechatIdentity && current.wechatIdentity !== key) throw new Error('当前会话已绑定其他微信');
      const existing = rows.find(row => row.kind === 'user' && row.wechatIdentity === key);
      if (existing) {
        existing.wechatOpenId = openId;
        existing.wechatAppId = appId;
        return existing.id;
      }
      current.wechatIdentity = key;
      current.wechatOpenId = openId;
      current.wechatAppId = appId;
      return id;
    });
  }
  async bindWechatPhone(id, phone) {
    const digest = hashToken(phone);
    return this.db.transact(rows => {
      const current = rows.find(row => row.kind === 'user' && row.id === id && row.wechatIdentity);
      if (!current) throw new Error('请先关联微信账号');
      if (rows.some(row => row.kind === 'user' && row.id !== id && row.phoneDigest === digest)) throw new Error('手机号已绑定其他账号');
      current.phoneDigest = digest;
      current.phoneMasked = phone.slice(0, 3) + '****' + phone.slice(-4);
      return current;
    });
  }
  async register(id, email, password) {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160 || typeof password !== 'string' || password.length < 10 || password.length > 128) throw new Error('请输入有效邮箱和 10–128 位密码');
    const salt = randomBytes(16).toString('hex'); const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
    await this.db.transact(rows => {
      if (rows.some(r => r.kind === 'user' && r.email === email)) throw new Error('无法注册，请尝试登录或使用其他邮箱');
      const user = rows.find(r => r.kind === 'user' && r.id === id);
      if (!user || user.email) throw new Error('当前账户已注册');
      user.email = email; user.passwordHash = passwordHash; user.salt = salt;
      // Rotate all sessions after upgrading a guest to an account.
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].kind === 'session' && rows[i].userId === id) rows.splice(i, 1);
    });
    return this.startSession(id);
  }
  async login(email, password) {
    if (typeof password !== 'string' || password.length > 128) throw new Error('邮箱或密码不正确');
    const user = (await this.db.read()).find(r => r.kind === 'user' && r.email === String(email).trim().toLowerCase());
    const computed = await scrypt(password, user?.salt || 'invalid-account-placeholder', 64);
    if (!user?.passwordHash || !timingSafeEqual(computed, Buffer.from(user.passwordHash, 'hex'))) throw new Error('邮箱或密码不正确');
    return this.startSession(user.id);
  }
  async logout(token) { await this.db.transact(rows => { const i = rows.findIndex(r => r.kind === 'session' && r.digest === hashToken(token || '')); if (i >= 0) rows.splice(i, 1); }); }
  async patchProfile(id, patch) {
    const allowed = { aiName: 12, nickname: 20, city: 40 };
    const options = { aiGender: ['neutral', 'female', 'male'], locale: this.locales, companionPreference: ['gentle', 'grounded', 'concise'], relationshipMode: ['friend', 'confidant'], theme: ['auto', 'day', 'night'] };
    return this.db.transact(rows => {
      const user = rows.find(r => r.kind === 'user' && r.id === id); if (!user) throw new Error('账户不存在');
      for (const [key, value] of Object.entries(patch)) {
        if (key in allowed) {
          if (typeof value !== 'string' || value.length > allowed[key] || key === 'aiName' && !value.trim()) throw new Error('输入内容超出范围');
          if (['aiName', 'nickname'].includes(key) && user.profile[key] && user.profile[key] !== value.trim()) user.profile[`${key}History`] = [...(user.profile[`${key}History`] || []), user.profile[key]].slice(-10);
          user.profile[key] = value.trim();
        } else if (key in options && options[key].includes(value)) user.profile[key] = value;
        else if (key === 'consent' && value === true) user.profile.consentAt = new Date(this.clock()).toISOString();
        else if (key === 'onboardingDone' && value === true) user.profile.onboardingDone = true;
        else throw new Error('不支持的设置项');
      }
      return user.profile;
    });
  }
  memory(extractor) {
    const db = this.db;
    const store = {
      read: async () => (await db.read()).filter(r => r.kind === 'memory'),
      transact: update => db.transact(async rows => {
        const partition = rows.filter(r => r.kind === 'memory');
        const result = await update(partition);
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].kind === 'memory') rows.splice(i, 1);
        rows.push(...partition.map(r => ({ ...r, kind: 'memory' })));
        return result;
      })
    };
    return new MemoryEngine({ store, extractor, clock: this.clock });
  }
  async save(kind, userId, value) {
    const item = { ...value, id: value.id || randomUUID(), kind, userId, createdAt: value.createdAt || new Date(this.clock()).toISOString() };
    await this.db.transact(rows => { if (!rows.some(r => r.kind === 'user' && r.id === userId)) throw new Error('账户不存在'); rows.push(item); }); return item;
  }
  async checkin(id, mood, source = 'manual', note) { return recordMood(this.db, id, mood, {source, note, clock: this.clock, timeZone: this.timeZone}); }
  async export(id) {
    return (await this.db.read()).filter(r => r.userId === id && r.kind !== 'session' && r.kind !== 'wechatOrder' || r.kind === 'user' && r.id === id)
      .map(({ passwordHash, salt, digest, wechatIdentity, wechatOpenId, wechatAppId, phoneDigest, ...record }) => record);
  }
  async deleteUser(id) { await this.db.transact(rows => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].userId === id || rows[i].kind === 'user' && rows[i].id === id) rows.splice(i, 1); }); }
}
