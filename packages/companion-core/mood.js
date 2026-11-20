import { randomUUID } from 'node:crypto';
import { localDate } from '../conversation/protocol.js';
export const MOODS = ['happy', 'calm', 'sad'];
export async function recordMood(db, userId, mood, { source = 'manual', note, clock = Date.now, timeZone = 'UTC' } = {}) {
  if (!MOODS.includes(mood)) throw new Error('心情无效');
  if (note !== undefined && (typeof note !== 'string' || note.length > 120)) throw new Error('打卡备注最多 120 字');
  const date = localDate(clock(), timeZone);
  return db.transact(rows => {
    let record = rows.find(r => r.kind === 'checkin' && r.userId === userId && r.date === date);
    if (record?.source === 'manual' && source !== 'manual') return record;
    if (!record) { record = { kind: 'checkin', id: randomUUID(), userId, date }; rows.push(record); }
    Object.assign(record, { mood, source, updatedAt: new Date(clock()).toISOString() });
    if (note !== undefined) record.note = note.trim();
    return record;
  });
}
