import { readFile } from 'node:fs/promises';
import { ExtractionGate } from '../../packages/memory/index.js';

const cases = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
const rows = cases.map(item => {
  const actual = new ExtractionGate().check('synthetic-user', item.text).pass;
  return { id: item.id, expectedPass: item.pass, actualPass: actual, correct: item.pass === actual };
});
console.table(rows);
console.log(`${rows.filter(r => r.correct).length}/${rows.length} synthetic gate checks matched. This is a deterministic smoke check, not an LLM memory benchmark.`);
if (rows.some(r => !r.correct)) process.exitCode = 1;
