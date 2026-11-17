/** Source-message IDs preserve the original product copy. Locales are plain JSON, no build step. */
export function createTranslator({ messages = {}, fallback = {}, locale = 'en' } = {}) {
  const entries = Object.entries({ ...fallback, ...messages });
  const patterns = entries.filter(([key]) => key.includes('{{')).map(([key, value]) => {
    const variables = []; let cursor = 0; let expression = '^';
    for (const match of key.matchAll(/\{\{(\w+)\}\}/g)) {
      expression += key.slice(cursor, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([\\s\\S]*?)'; variables.push(match[1]); cursor = match.index + match[0].length;
    }
    expression += key.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
    return { regex: new RegExp(expression), variables, value };
  });
  const interpolate = (value, vars) => String(value).replace(/\{\{(\w+)\}\}/g, (all, key) => vars[key] ?? all);
  const lookup = { ...fallback, ...messages };
  const t = (source, variables = {}) => {
    if (typeof source !== 'string') return source;
    if (Object.hasOwn(lookup, source)) return interpolate(lookup[source], variables);
    for (const pattern of patterns) {
      const match = source.match(pattern.regex);
      if (match) return interpolate(pattern.value, { ...Object.fromEntries(pattern.variables.map((key, i) => [key, key === 'question' ? lookup[match[i + 1]] || match[i + 1] : match[i + 1]])), ...variables });
    }
    return interpolate(source, variables);
  };
  t.locale = locale; return t;
}
export function translateCopy(value, t) {
  if (typeof value === 'string') return t(value);
  if (Array.isArray(value)) return value.map(item => translateCopy(item, t));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, translateCopy(item, t)]));
  return value;
}
