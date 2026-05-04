const KillSwitch = require("../models/KillSwitch");

const DEFAULT_SEQUENCE = {
  website: ["http_headers_probe", "dns_lookup_probe", "tls_metadata_probe", "nuclei_scan"],
  api: ["http_headers_probe", "dns_lookup_probe", "tls_metadata_probe", "nuclei_scan", "sqlmap_detect"],
  network: ["dns_lookup_probe", "nmap_tcp_scan", "tls_metadata_probe", "nuclei_scan"]
};

function normalizeTool(toolId) {
  return String(toolId || "").trim();
}

function derivePlannedTools(engagement) {
  const whitelist = Array.isArray(engagement?.constraints?.toolWhitelist)
    ? engagement.constraints.toolWhitelist.map(normalizeTool).filter(Boolean)
    : [];

  if (whitelist.length > 0) {
    return [...new Set(whitelist)];
  }

  const type = String(engagement?.targetType || "website").toLowerCase();
  return DEFAULT_SEQUENCE[type] || DEFAULT_SEQUENCE.website;
}

function previewEngagementActions(engagement) {
  const tools = derivePlannedTools(engagement);
  return tools.map((toolId, index) => ({
    order: index + 1,
    toolId,
    riskLevel:
      /sqlmap|exploit|rce|metasploit/i.test(toolId) ? "medium" : "low",
    destructive: false,
    description: `Run ${toolId} within authorized scope against ${engagement.targetUrl}`
  }));
}

function getScopeDashboard(engagement) {
  const allowedDomains = Array.isArray(engagement?.scope?.allowedDomains)
    ? engagement.scope.allowedDomains
    : [];
  const restrictedPaths = Array.isArray(engagement?.scope?.restrictedPaths)
    ? engagement.scope.restrictedPaths
    : [];
  const restrictedServices = Array.isArray(engagement?.scope?.restrictedServices)
    ? engagement.scope.restrictedServices
    : [];

  return {
    engagementId: String(engagement?._id || ""),
    targetUrl: engagement?.targetUrl || "",
    allowedDomains,
    restrictedPaths,
    restrictedServices,
    noDestructiveOps: Boolean(engagement?.constraints?.noDestructiveOps),
    quietMode: Boolean(engagement?.constraints?.quietMode),
    maxConcurrentOps: Number(engagement?.constraints?.maxConcurrentOps || 1),
    timeoutMinutes: Number(engagement?.constraints?.timeoutMinutes || 60),
    plannedTools: derivePlannedTools(engagement)
  };
}

async function getGlobalKillSwitch() {
  return KillSwitch.findOne({ scope: "global" }).sort({ updatedAt: -1 }).lean();
}

async function getEngagementKillSwitch(engagementId) {
  return KillSwitch.findOne({
    scope: "engagement",
    engagementId
  })
    .sort({ updatedAt: -1 })
    .lean();
}

async function getKillSwitchState(engagementId) {
  const [globalSwitch, engagementSwitch] = await Promise.all([
    getGlobalKillSwitch(),
    engagementId ? getEngagementKillSwitch(engagementId) : Promise.resolve(null)
  ]);

  const globalActive = Boolean(globalSwitch?.active);
  const engagementActive = Boolean(engagementSwitch?.active);

  return {
    blocked: globalActive || engagementActive,
    global: {
      active: globalActive,
      reason: globalSwitch?.reason || "",
      updatedAt: globalSwitch?.updatedAt || null,
      updatedBy: globalSwitch?.updatedBy || "unknown"
    },
    engagement: {
      active: engagementActive,
      reason: engagementSwitch?.reason || "",
      updatedAt: engagementSwitch?.updatedAt || null,
      updatedBy: engagementSwitch?.updatedBy || "unknown"
    }
  };
}

async function setGlobalKillSwitch(active, reason, userId) {
  const payload = {
    scope: "global",
    engagementId: null,
    active: Boolean(active),
    reason: String(reason || "").trim(),
    updatedBy: String(userId || "unknown"),
    updatedAt: new Date()
  };

  await KillSwitch.updateOne({ scope: "global" }, payload, {
    upsert: true
  });
  return getKillSwitchState(null);
}

async function setEngagementKillSwitch(engagementId, active, reason, userId) {
  const payload = {
    scope: "engagement",
    engagementId,
    active: Boolean(active),
    reason: String(reason || "").trim(),
    updatedBy: String(userId || "unknown"),
    updatedAt: new Date()
  };

  await KillSwitch.updateOne(
    { scope: "engagement", engagementId },
    payload,
    { upsert: true }
  );
  return getKillSwitchState(engagementId);
}

async function assertExecutionAllowed(engagementId) {
  const state = await getKillSwitchState(engagementId);
  if (!state.blocked) {
    return;
  }

  const reason = state.engagement.active
    ? state.engagement.reason || "Engagement kill switch active"
    : state.global.reason || "Global kill switch active";
  const error = new Error(reason);
  error.httpStatus = 423;
  throw error;
}

module.exports = {
  derivePlannedTools,
  previewEngagementActions,
  getScopeDashboard,
  getKillSwitchState,
  setGlobalKillSwitch,
  setEngagementKillSwitch,
  assertExecutionAllowed,
  __internal: {
    normalizeTool
  }
};

