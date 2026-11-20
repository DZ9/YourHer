const api = require('../../services/api');
const { safeBack } = require('../../utils/nav');
const { CHECKIN_OPTIONS, MOOD_FIRST_PERSON, pinTodayCheckin } = require('../../utils/mood-checkin');
const { getTimeOfDay } = require('../../utils/time');

Page({
  data: { mood: '', note: '', streak: 0, today: null, busy: false, loading: true, error: '', options: CHECKIN_OPTIONS },
  async onLoad(query = {}) {
    this.setData({ theme: getTimeOfDay(), mood: CHECKIN_OPTIONS.some(item => item.value === query.mood) ? query.mood : '' });
    await this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const { checkin, streak } = await api.getTodayCheckin({ refresh: true });
      this.setData({ today: checkin, streak, mood: this.data.mood || checkin?.mood || '', note: checkin?.note || '' });
    } catch (err) {
      this.setData({ error: err.message || '无法读取打卡记录' });
    } finally {
      this.setData({ loading: false });
    }
  },
  pick(event) { this.setData({ mood: event.currentTarget.dataset.mood }); },
  noteInput(event) { this.setData({ note: event.detail.value }); },
  async save() {
    if (!this.data.mood || this.data.busy || this.data.loading) return;
    this.setData({ busy: true, error: '' });
    try {
      const result = await api.submitCheckin({ mood: this.data.mood, note: this.data.note });
      pinTodayCheckin();
      this.setData({ today: result.checkin, streak: result.streak });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      this.setData({ error: err.message || '保存失败，请重试' });
    } finally {
      this.setData({ busy: false });
    }
  },
  chat() {
    const message = MOOD_FIRST_PERSON[this.data.today?.mood];
    if (message) wx.navigateTo({ url: '/pages/chat/index?source=home_mood&autoSend=1&initialMessage=' + encodeURIComponent(message) });
  },
  back() { safeBack('/pages/home/index'); }
});
