function parseSegments(input) {
  return String(input || "")
    .trim()
    .split(".")
    .map((seg) => {
      const n = parseInt(seg, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
}
function compareVersion(a, b) {
  const sa = parseSegments(a);
  const sb = parseSegments(b);
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i += 1) {
    const x = sa[i] || 0;
    const y = sb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
function isBelowMinVersion(current, min) {
  if (!min) return false;
  return compareVersion(current, min) < 0;
}

module.exports = {
  compareVersion,
  isBelowMinVersion
};
