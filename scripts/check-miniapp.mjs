import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/miniapp');
const src = resolve(root, 'src');
async function exists(path) { try { return (await stat(path)).isFile(); } catch { return false; } }
async function walk(dir) {
  const files = [];
  for (const e of await readdir(dir, {withFileTypes:true})) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'miniprogram_npm'].includes(e.name)) files.push(...await walk(p)); }
    else files.push(p);
  }
  return files;
}
const app = JSON.parse(await readFile(resolve(src, 'app.json'), 'utf8'));
const pages = [...app.pages, ...(app.subPackages || []).flatMap(p => p.pages.map(page => p.root + '/' + page))];
for (const page of pages) for (const ext of ['.js','.json','.wxml','.wxss']) {
  if (!await exists(resolve(src, page + ext))) throw new Error('Missing page file: ' + page + ext);
}
let count = 0, size = 0;
for (const file of await walk(src)) {
  size += (await stat(file)).size;
  const extension = extname(file);
  if (!['.js','.json','.wxml','.wxss','.svg'].includes(extension)) continue;
  const text = await readFile(file, 'utf8'); count++;
  if (extension === '.js') {
    new vm.Script(text, {filename:file});
    for (const match of text.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
      const target = resolve(dirname(file), match[1]);
      if (!await exists(target) && !await exists(target + '.js') && !await exists(resolve(target,'index.js'))) throw new Error('Missing module in ' + file + ': ' + match[1]);
    }
  }
  if (extension === '.json') {
    const json = JSON.parse(text);
    for (const target of Object.values(json.usingComponents || {})) {
      const path = target.startsWith('/') ? resolve(src, '.' + target) : resolve(dirname(file), target);
      for (const ext of ['.js','.json','.wxml','.wxss']) if (!await exists(path + ext)) throw new Error('Missing component: ' + path + ext);
    }
  }
  // Verify static image references; dynamic bindings are checked in the simulator.
  if (extension === '.wxml') for (const match of text.matchAll(/src=["']([^"'{}]+)["']/g)) {
    if (/^https?:|^data:/.test(match[1])) continue;
    const path = match[1].startsWith('/') ? resolve(src, '.' + match[1]) : resolve(dirname(file), match[1]);
    if (!await exists(path)) throw new Error('Missing image in ' + file + ': ' + match[1]);
  }
  if (/cloud1-[\w-]+|wx5e1c0de7fbff356c/.test(text)) throw new Error('Production integration remains in ' + file);
}
console.log(`Miniapp source checks passed: ${pages.length} pages, ${count} text assets, ${(size / 1024).toFixed(0)} KiB total source. DevTools compilation and device preview remain separate checks.`);
