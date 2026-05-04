const { REAL_TOOL_REGISTRY } = require("./realTools");

const TOOL_REGISTRY = {
  http_headers_probe: {
    id: "http_headers_probe",
    name: "HTTP Headers Probe",
    description:
      "Collects response header posture for secure configuration review.",
    category: "web",
    mode: "internal",
    destructive: false,
    timeoutSeconds: 45,
    estimatedCostUsd: 0.01
  },
  tls_metadata_probe: {
    id: "tls_metadata_probe",
    name: "TLS Metadata Probe",
    description:
      "Collects negotiated TLS protocol/cipher and certificate metadata.",
    category: "web",
    mode: "internal",
    destructive: false,
    timeoutSeconds: 45,
    estimatedCostUsd: 0.015
  },
  dns_lookup_probe: {
    id: "dns_lookup_probe",
    name: "DNS Lookup Probe",
    description: "Resolves DNS records for target host attribution checks.",
    category: "network",
    mode: "internal",
    destructive: false,
    timeoutSeconds: 20,
    estimatedCostUsd: 0.005
  },
  zap_baseline_passive: {
    id: "zap_baseline_passive",
    name: "ZAP Baseline Passive Scan",
    description:
      "Runs OWASP ZAP baseline passive checks in a container (no active attack mode).",
    category: "web",
    mode: "docker",
    destructive: false,
    timeoutSeconds: 180,
    estimatedCostUsd: 0.08
  },
  ...REAL_TOOL_REGISTRY
};

function listTools() {
  return Object.values(TOOL_REGISTRY);
}

function getTool(toolId) {
  return TOOL_REGISTRY[toolId] || null;
}

module.exports = {
  listTools,
  getTool
};
