const { responseIntelligenceEngine } = require("../services/responseIntelligenceEngine");

async function applyResponseIntelligence(findings = [], context = {}) {
  const result = await responseIntelligenceEngine.processFindings(findings, context);
  return {
    findings: result.findings,
    suppressedFindings: result.suppressedFindings,
    responseIntelligenceAudit: result.auditLog
  };
}

function attachResponseIntelligenceToOutput(output = {}, intelligence = {}) {
  return {
    ...(output && typeof output === "object" ? output : {}),
    findings: intelligence.findings || [],
    suppressedFindings: intelligence.suppressedFindings || [],
    responseIntelligenceAudit: intelligence.responseIntelligenceAudit || []
  };
}

module.exports = {
  applyResponseIntelligence,
  attachResponseIntelligenceToOutput
};
