const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const SecurityBaseline = require("../models/SecurityBaseline");
const { sendSlackAlert } = require("./notifier");

function normalizeSeverity(value) {
  return String(value || "low").trim().toLowerCase();
}

function severityWeight(severity) {
  const normalized = normalizeSeverity(severity);
  if (normalized === "critical") {
    return 100;
  }
  if (normalized === "high") {
    return 80;
  }
  if (normalized === "medium") {
    return 50;
  }
  if (normalized === "low") {
    return 20;
  }
  return 5;
}

function flattenFindings(jobs) {
  const dedup = new Map();
  for (const job of jobs) {
    const findings = Array.isArray(job.findings)
      ? job.findings
      : Array.isArray(job.output?.findings)
        ? job.output.findings
        : [];
    for (const finding of findings) {
      const key = `${String(finding?.title || "").trim().toLowerCase()}|${String(
        finding?.category || ""
      )
        .trim()
        .toLowerCase()}|${String(finding?.cve || "")
        .trim()
        .toLowerCase()}`;
      if (!key || dedup.has(key)) {
        continue;
      }
      dedup.set(key, {
        id: String(finding?.id || ""),
        title: String(finding?.title || "").trim(),
        severity: normalizeSeverity(finding?.severity),
        category: String(finding?.category || "").trim(),
        cve: String(finding?.cve || "").trim()
      });
    }
  }
  return [...dedup.values()];
}

function extractPortsFromJobs(jobs) {
  const dedup = new Map();
  for (const job of jobs) {
    const ports = Array.isArray(job?.output?.openPorts)
      ? job.output.openPorts
      : Array.isArray(job?.output?.ports)
        ? job.output.ports
        : [];
    for (const item of ports) {
      const host = String(item?.host || item?.ip || item?.target || "").trim();
      const port = Number(item?.port || item?.number || 0);
      const protocol = String(item?.protocol || "tcp").toLowerCase();
      const service = String(item?.service || item?.name || "").trim();
      if (!host || !Number.isFinite(port) || port <= 0) {
        continue;
      }
      const key = `${host}:${port}/${protocol}`;
      dedup.set(key, { host, port, protocol, service });
    }
  }
  return [...dedup.values()];
}

function computeRiskScore(findings) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return 0;
  }
  const weighted = findings.reduce((sum, finding) => {
    return sum + severityWeight(finding.severity);
  }, 0);
  return Math.min(100, Math.round(weighted / findings.length));
}

function summarizeSnapshot(findings, ports) {
  const critical = findings.filter((item) => item.severity === "critical").length;
  const high = findings.filter((item) => item.severity === "high").length;
  const medium = findings.filter((item) => item.severity === "medium").length;
  return `${findings.length} finding(s), ${ports.length} open port signal(s), critical=${critical}, high=${high}, medium=${medium}`;
}

function toFindingMap(findings) {
  const map = new Map();
  for (const finding of findings) {
    const key = `${String(finding?.title || "").trim().toLowerCase()}|${String(
      finding?.category || ""
    )
      .trim()
      .toLowerCase()}|${String(finding?.cve || "")
      .trim()
      .toLowerCase()}`;
    if (!key || map.has(key)) {
      continue;
    }
    map.set(key, finding);
  }
  return map;
}

function toPortMap(ports) {
  const map = new Map();
  for (const port of ports) {
    const key = `${port.host}:${port.port}/${port.protocol}`;
    if (!map.has(key)) {
      map.set(key, port);
    }
  }
  return map;
}

async function createSnapshot(engagementId, snapshotType = "manual", createdBy = "unknown") {
  const engagement = await Engagement.findById(engagementId).lean();
  if (!engagement) {
    const error = new Error("Engagement not found");
    error.code = "ENGAGEMENT_NOT_FOUND";
    throw error;
  }

  const jobs = await ExecutionJob.find({
    engagementId,
    status: { $in: ["success", "failed", "blocked", "timeout"] }
  })
    .sort({ createdAt: -1 })
    .limit(150)
    .lean();

  const findings = flattenFindings(jobs);
  const openPorts = extractPortsFromJobs(jobs);
  const riskScore = computeRiskScore(findings);
  const summary = summarizeSnapshot(findings, openPorts);

  const snapshot = await SecurityBaseline.create({
    engagementId,
    snapshotType,
    snapshotAt: new Date(),
    findings,
    openPorts,
    riskScore,
    summary,
    createdBy
  });

  return snapshot.toObject();
}

async function detectChanges(engagementId) {
  const snapshots = await SecurityBaseline.find({ engagementId })
    .sort({ snapshotAt: -1, createdAt: -1 })
    .limit(2)
    .lean();

  if (snapshots.length < 2) {
    return {
      changesFound: false,
      newFindings: [],
      resolvedFindings: [],
      newPorts: [],
      closedPorts: [],
      changeSummary: "Not enough snapshots yet. Capture at least two baselines.",
      scanGapHours: 0,
      currentSnapshotId: snapshots[0]?._id || null,
      previousSnapshotId: null
    };
  }

  const [current, previous] = snapshots;
  const currentFindingsMap = toFindingMap(current.findings || []);
  const previousFindingsMap = toFindingMap(previous.findings || []);
  const currentPortsMap = toPortMap(current.openPorts || []);
  const previousPortsMap = toPortMap(previous.openPorts || []);

  const newFindings = [...currentFindingsMap.keys()]
    .filter((key) => !previousFindingsMap.has(key))
    .map((key) => currentFindingsMap.get(key));
  const resolvedFindings = [...previousFindingsMap.keys()]
    .filter((key) => !currentFindingsMap.has(key))
    .map((key) => previousFindingsMap.get(key));
  const newPorts = [...currentPortsMap.keys()]
    .filter((key) => !previousPortsMap.has(key))
    .map((key) => currentPortsMap.get(key));
  const closedPorts = [...previousPortsMap.keys()]
    .filter((key) => !currentPortsMap.has(key))
    .map((key) => previousPortsMap.get(key));

  const scanGapHours = Math.max(
    0,
    Math.round(
      (new Date(current.snapshotAt).getTime() -
        new Date(previous.snapshotAt).getTime()) /
        3600000
    )
  );

  const changesFound =
    newFindings.length > 0 ||
    resolvedFindings.length > 0 ||
    newPorts.length > 0 ||
    closedPorts.length > 0;

  let changeSummary = "No significant security changes detected since last snapshot.";
  if (changesFound) {
    changeSummary = `${newFindings.length} new finding(s), ${resolvedFindings.length} resolved finding(s), ${newPorts.length} new port signal(s), ${closedPorts.length} closed port signal(s).`;
  }

  const highPriorityNew = newFindings.filter((finding) => {
    const severity = normalizeSeverity(finding?.severity);
    return severity === "critical" || severity === "high";
  });

  if (highPriorityNew.length > 0) {
    await sendSlackAlert(
      `VENOM change detection: ${highPriorityNew.length} new high-priority finding(s) since last baseline.`,
      {
        engagementId: String(engagementId),
        findings: highPriorityNew
      }
    ).catch(() => null);
  }

  return {
    changesFound,
    newFindings,
    resolvedFindings,
    newPorts,
    closedPorts,
    changeSummary,
    scanGapHours,
    currentSnapshotId: current._id,
    previousSnapshotId: previous._id
  };
}

module.exports = {
  createSnapshot,
  detectChanges,
  __internal: {
    flattenFindings,
    extractPortsFromJobs,
    computeRiskScore,
    summarizeSnapshot
  }
};

