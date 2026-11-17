import { localDate, weekStart } from '../conversation/protocol.js';
/** Provider- and web-framework-independent weekly letters, backed by an injected repository. */
export class LetterService {
  busy = new Set();
  constructor({ store, memory, model, mode = 'demo', clock = Date.now, timeZone = 'UTC' }) { Object.assign(this, { store, memory, model, mode, clock, timeZone }); }
  async generate(user) {
    if (this.busy.has(user.id)) throw new Error('信正在写，请稍候');
    this.busy.add(user.id);
    try {
      const week = weekStart(this.clock(), this.timeZone);
      const existing = (await this.store.read('letter', user.id)).find(r => r.week === week);
      if (existing) return existing;
      const history = (await this.store.read('message', user.id)).filter(m => localDate(Date.parse(m.createdAt), this.timeZone) >= week);
      if (history.filter(m => m.role === 'user').length < 3) throw new Error('这周再聊几句，留下三条消息后就可以写信了');
      const content = await this.model.letter({ profile: user.profile, messages: history.slice(-60).map(m => ({ role: m.role, content: m.content })), memories: await this.memory.context(user.id) });
      return this.store.save('letter', user.id, { week, until: localDate(this.clock(), this.timeZone), title: `${week} · ${user.profile.nickname || 'You'}`, content: String(content).slice(0, 8000), modelMode: this.mode });
    } finally { this.busy.delete(user.id); }
  }
}
