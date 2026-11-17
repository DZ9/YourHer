import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Single-process JSON persistence. Use one instance per file; not a multi-process database. */
export class FileStore {
  #queue = Promise.resolve();
  constructor(path) { this.path = path; }
  async #load() {
    try {
      const records = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(records)) throw new TypeError('Invalid memory store.');
      return records;
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async read() { await this.#queue; return this.#load(); }
  transact(update) {
    const task = this.#queue.then(async () => {
      const records = await this.#load();
      const result = await update(records);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(records, null, 2), { mode: 0o600 });
      await rename(temporary, this.path);
      return structuredClone(result);
    });
    this.#queue = task.catch(() => {});
    return task;
  }
}
