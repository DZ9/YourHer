import test from 'node:test';
import assert from 'node:assert/strict';
import { readEvents } from '../sse-client.js';
import { finalizeReply } from '../protocol.js';
test('browser event reader survives byte-sized UTF-8 fragments and heartbeats', async () => {
  const bytes = new TextEncoder().encode(': ping\r\n\r\ndata: {"type":"replace","text":"你好"}\r\n\r\ndata: {"type":"done"}\r\n\r\n');
  const response = new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } }));
  const events = []; for await (const event of readEvents(response)) events.push(event);
  assert.deepEqual(events, [{ type: 'replace', text: '你好' }, { type: 'done' }]);
});
test('English chips are phrases rather than being truncated at eight characters', () => {
  assert.deepEqual(finalizeReply('Hello\nCANDIDATES["Just listen","Let’s take our time","Something else"]').replyCandidates, ['Just listen', 'Let’s take our time', 'Something else']);
});
