import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
export async function loadConfig(path = resolve('companion.config.json')) {
  const config = JSON.parse(await readFile(path, 'utf8')); const root = dirname(path);
  const i18n = config.i18n;
  if (!Array.isArray(i18n?.locales) || !i18n.locales.length) throw new Error('Configure at least one locale.');
  const codes = i18n.locales.map(l => l.code);
  if (new Set(codes).size !== codes.length || !codes.includes(i18n.defaultLocale) || !codes.includes(i18n.fallbackLocale)) throw new Error('Invalid locale defaults or duplicate locales.');
  new Intl.DateTimeFormat('en', { timeZone: config.timeZone || 'UTC' });
  const dictionaries = {};
  for (const locale of i18n.locales) {
    if (!/^[A-Za-z0-9-]{2,35}$/.test(locale.code) || !['ltr', 'rtl'].includes(locale.direction || 'ltr')) throw new Error('Invalid locale declaration.');
    const dictionary = JSON.parse(await readFile(resolve(root, locale.file), 'utf8'));
    if (!dictionary || Array.isArray(dictionary) || Object.values(dictionary).some(value => typeof value !== 'string')) throw new Error('Translations must be an object of strings.');
    dictionaries[locale.code] = dictionary;
  }
  return { ...config, dictionaries, i18n: { ...i18n, locales: i18n.locales.map(({ file, ...locale }) => locale) } };
}
