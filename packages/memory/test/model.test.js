import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel, OpenAICompatibleModel } from '../model.js';

test('demo patterns capture only the documented illustrative phrases', async () => {
  const model = new DemoModel();
  assert.deepEqual(await model.extract('我不吃香菜'), [{ type: 'preference', content: '我不吃香菜', importance: 3 }]);
  assert.deepEqual(await model.extract('你好'), []);
});
test('OpenAI adapter handles fragmented CRLF SSE and split UTF-8 characters', async () => {
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"橘子"}}]}\r\n\r\ndata: [DONE]\r\n\r\n');
  let request;
  const model = new OpenAICompatibleModel({ baseURL: 'https://example.invalid/v1', apiKey: 'test-only', model: 'test-model', fetchImpl: async (url, options) => {
    request = { url, options };
    return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }));
  } });
  let text = ''; for await (const chunk of model.stream([{ role: 'user', content: 'hello' }])) text += chunk;
  assert.equal(text, '橘子');
  assert.equal(request.url, 'https://example.invalid/v1/chat/completions');
  assert.equal(JSON.parse(request.options.body).stream, true);
});
test('provider errors do not expose response bodies or credentials', async () => {
  const model = new OpenAICompatibleModel({ baseURL: 'https://example.invalid/v1', apiKey: 'test-only', model: 'test-model', fetchImpl: async () => new Response('private provider details', { status: 401 }) });
  await assert.rejects(model.extract('fact'), { message: 'Model request failed (401).' });
});
test('extraction validates response shape', async () => {
  const model = new OpenAICompatibleModel({ baseURL: 'https://example.invalid/v1', apiKey: 'test-only', model: 'test-model', fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"memories":null}' } }] }) });
  await assert.rejects(model.extract('fact'), /Invalid extraction/);
});
