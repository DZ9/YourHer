import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeReply, visibleStreamText, splitBubbles, computeA5State, localDate, weekStart } from '../protocol.js';
import { getCopy, setAiGender, productCopy } from '../copy.js';

test('original candidates survive persistence but never enter visible reply text', () => {
  const raw = '我在听。\n\n慢慢说。\n__CANDIDATES__["先听我说","慢慢聊吧","换个话题"]';
  const reply = finalizeReply(raw);
  assert.equal(reply.content, '我在听。\n\n慢慢说。');
  assert.equal(reply.rawContent, raw);
  assert.deepEqual(reply.replyCandidates, ['先听我说', '慢慢聊吧', '换个话题']);
  assert.deepEqual(splitBubbles(reply.content), ['我在听。', '慢慢说。']);
});
test('every partial marker split is withheld from streaming UI', () => {
  for (const marker of ['__CANDIDATES__', '_CANDIDATES_', 'CANDIDATES']) {
    const raw = '正文。\n' + marker + '["继续说吧","先不说了","换个话题"]';
    for (let n = 4; n <= raw.length; n++) {
      const visible = visibleStreamText(raw.slice(0, n));
      assert.ok(!visible.includes('CANDIDATES'), visible);
      assert.ok(!visible.includes('["'), visible);
      if (n >= 5) assert.ok(!visible.endsWith('C'), visible);
    }
  }
});
test('malformed or low-quality candidates do not leak into chips', () => {
  assert.deepEqual(finalizeReply('正文\nCANDIDATES["12","ok","。。。"]').replyCandidates, []);
  assert.equal(finalizeReply('正文\n__CANDIDATES__[broken').content, '正文');
});
test('original returning-user tiers and last reply candidates are reused', () => {
  const messages = [{ role: 'user', content: '最近工作压力有一点大' }, { role: 'assistant', content: '我在听', replyCandidates: ['说说工作', '先歇一会', '换个话题'] }];
  assert.equal(computeA5State({ gapMs: 29 * 60000, messages }).tier, '');
  const chips = computeA5State({ gapMs: 31 * 60000, messages }); assert.equal(chips.tier, 'chips'); assert.deepEqual(chips.chips, messages[1].replyCandidates);
  const opener = computeA5State({ gapMs: 25 * 3600000, messages, pick: a => a[0] }); assert.equal(opener.tier, 'opener'); assert.match(opener.footerText, /工作压力/);
});
test('original gendered copy remains consistent', () => {
  setAiGender('male'); assert.ok(getCopy('male').panels.recordsPanel.lettersTitle.includes('他'));
  setAiGender('female'); assert.ok(getCopy('female').panels.recordsPanel.lettersTitle.includes('她'));
  assert.equal(productCopy.FIRST_MEETING_CHIPS.length, 3);
});
test('dates and weekly letters use Shanghai calendar boundaries', () => {
  assert.equal(localDate(Date.parse('2026-11-16T17:00:00Z')), '2026-11-17');
  assert.equal(weekStart(Date.parse('2026-11-17T05:00:00Z')), '2026-11-16');
});
