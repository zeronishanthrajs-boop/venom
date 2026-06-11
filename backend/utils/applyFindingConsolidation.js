const { findingConsolidationEngine } = require("../services/findingConsolidationEngine");

async function applyFindingConsolidation(findings = []) {
  return findingConsolidationEngine.consolidate(findings);
}

function attachFindingConsolidationToOutput(output = {}, consolidation = {}) {
  return {
    ...(output && typeof output === "object" ? output : {}),
    findings: consolidation.consolidatedFindings || [],
    consolidatedFindings: consolidation.consolidatedFindings || [],
    rawFindingCount: consolidation.rawFindingCount || 0,
    consolidatedFindingCount: consolidation.consolidatedFindingCount || 0,
    deduplicationRatio: consolidation.deduplicationRatio || 0,
    consolidationAudit: consolidation.consolidationAudit || []
  };
}

module.exports = {
  applyFindingConsolidation,
  attachFindingConsolidationToOutput
};
