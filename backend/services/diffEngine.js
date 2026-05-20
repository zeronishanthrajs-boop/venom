const { deduplicateFindings } = require("../utils/deduplicateFindings");

/**
 * Computes a unique comparison key for a finding.
 * Relies on finding type, title, and target/category.
 */
function getFindingCompareKey(finding) {
  const title = String(finding?.title || "").trim().toLowerCase();
  const type = String(finding?.type || finding?.category || "unknown").trim().toLowerCase();
  const cve = String(finding?.cve || "").trim().toLowerCase();
  const resource = String(finding?.metadata?.resource || finding?.targetUrl || "").trim().toLowerCase();
  return `${type}:${cve || title}:${resource}`;
}

/**
 * Diff two lists of findings.
 * @param {Array} previousFindings - Findings from the previous scan
 * @param {Array} currentFindings - Findings from the current scan
 * @returns {Object} { fixed: [], new: [], persisting: [] }
 */
function diffFindings(previousFindings = [], currentFindings = []) {
  const prevMap = new Map();
  const currMap = new Map();

  for (const f of previousFindings) {
    prevMap.set(getFindingCompareKey(f), f);
  }

  for (const f of currentFindings) {
    currMap.set(getFindingCompareKey(f), f);
  }

  const fixed = [];
  const newFindings = [];
  const persisting = [];

  // Finding is fixed if it was in previous but is no longer in current
  for (const [key, f] of prevMap.entries()) {
    if (!currMap.has(key)) {
      fixed.push(f);
    }
  }

  // Finding is new if it is in current but was not in previous
  // Finding is persisting if it is in both
  for (const [key, f] of currMap.entries()) {
    if (prevMap.has(key)) {
      persisting.push(f);
    } else {
      newFindings.push(f);
    }
  }

  return {
    fixed,
    new: newFindings,
    persisting
  };
}

module.exports = {
  diffFindings,
  getFindingCompareKey
};
