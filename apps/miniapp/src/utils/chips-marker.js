const MARKER_CLEAN_REGEX = /\n*_{0,2}CANDIDATES_{0,2}[\s\S]*$/;

function stripMarkerFromContent(content) {
  if (!content) return content;
  return String(content).replace(MARKER_CLEAN_REGEX, "").replace(/\s+$/, "");
}

module.exports = {
  stripMarkerFromContent
};
