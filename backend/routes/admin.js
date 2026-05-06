const router = require("express").Router();
const mongoose = require("mongoose");
const requireDb = require("../middleware/requireDb");
const { requireRole } = require("../middleware/rbac");
const { STARTUP_SCAN_PROFILE } = require("../profiles/startupScan");

const Engagement = mongoose.model("Engagement");
const ExecutionJob = mongoose.model("ExecutionJob");
const Plan = mongoose.model("Plan");

const TERMINAL_JOB_STATUSES = [
  "completed",
  "success",
  "failed",
  "blocked",
  "timeout",
  "killed"
];

const FULL_TOOL_WHITELIST = [
  "http_headers_probe",
  "tls_metadata_probe",
  "dns_lookup_probe",
  "nuclei_scan",
  "nikto_scan",
  "nmap_tcp_scan",
  "sqlmap_detect"
];

function normalizeObjectIds(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const id = String(value || "").trim();
    if (!mongoose.Types.ObjectId.isValid(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(new mongoose.Types.ObjectId(id));
  }
  return out;
}

function normalizeWhitelist(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }
  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    const v = String(value || "").trim();
    if (!v || seen.has(v)) {
      continue;
    }
    normalized.push(v);
    seen.add(v);
  }
  return normalized;
}

async function runFixOrphanedJobs() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const result = await ExecutionJob.updateMany(
    {
      status: "running",
      startedAt: { $lt: cutoff }
    },
    {
      $set: {
        status: "failed",
        errorMessage: "Orphaned job - auto-resolved by admin cleanup.",
        finishedAt: new Date()
      }
    }
  );
  return {
    jobsCleaned: result.modifiedCount || 0,
    cutoff: cutoff.toISOString()
  };
}

async function runFixToolWhitelists() {
  const startupWhitelist = normalizeWhitelist(STARTUP_SCAN_PROFILE.toolWhitelist);
  const targetWhitelist =
    startupWhitelist.length > 0 ? startupWhitelist : FULL_TOOL_WHITELIST;

  const engagements = await Engagement.find({})
    .select("_id constraints.toolWhitelist toolWhitelist")
    .lean();

  let updated = 0;
  for (const engagement of engagements) {
    const nested = normalizeWhitelist(engagement?.constraints?.toolWhitelist);
    const legacy = normalizeWhitelist(engagement?.toolWhitelist);
    const mergedCurrent = normalizeWhitelist([...nested, ...legacy]);
    const hasAllRequired = targetWhitelist.every((tool) =>
      mergedCurrent.includes(tool)
    );

    if (hasAllRequired) {
      continue;
    }

    const merged = normalizeWhitelist([...mergedCurrent, ...targetWhitelist]);
    // eslint-disable-next-line no-await-in-loop
    await Engagement.updateOne(
      { _id: engagement._id },
      { $set: { "constraints.toolWhitelist": merged } }
    );
    updated += 1;
  }

  return {
    engagementsFixed: updated,
    whitelist: targetWhitelist
  };
}

async function runFixDraftStatuses() {
  const [jobEngagementIdsRaw, planEngagementIdsRaw] = await Promise.all([
    ExecutionJob.distinct("engagementId", {
      status: { $in: TERMINAL_JOB_STATUSES }
    }),
    Plan.distinct("engagementId")
  ]);

  const activeEngagementIds = normalizeObjectIds([
    ...jobEngagementIdsRaw,
    ...planEngagementIdsRaw
  ]);

  if (activeEngagementIds.length === 0) {
    return {
      engagementsFixed: 0,
      lookedIn: 0,
      statusWritten: "running"
    };
  }

  const result = await Engagement.updateMany(
    {
      _id: { $in: activeEngagementIds },
      status: { $in: ["draft", "DRAFT"] }
    },
    {
      // Schema-safe "active equivalent"
      $set: { status: "running" }
    }
  );

  return {
    engagementsFixed: result.modifiedCount || 0,
    lookedIn: activeEngagementIds.length,
    statusWritten: "running"
  };
}

router.post("/fix-draft-statuses", requireRole("admin", "owner"), requireDb, async (_req, res) => {
  try {
    const result = await runFixDraftStatuses();
    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/fix-tool-whitelists", requireRole("admin", "owner"), requireDb, async (_req, res) => {
  try {
    const result = await runFixToolWhitelists();
    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/fix-orphaned-jobs", requireRole("admin", "owner"), requireDb, async (_req, res) => {
  try {
    const result = await runFixOrphanedJobs();
    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/fix-all", requireRole("admin", "owner"), requireDb, async (_req, res) => {
  const results = {};
  try {
    const orphaned = await runFixOrphanedJobs();
    results.orphanedJobsCleaned = orphaned.jobsCleaned;

    const whitelist = await runFixToolWhitelists();
    results.whitelistsFixed = whitelist.engagementsFixed;
    results.whitelist = whitelist.whitelist;

    const drafts = await runFixDraftStatuses();
    results.draftsFixed = drafts.engagementsFixed;
    results.draftStatusWritten = drafts.statusWritten;

    return res.json({
      success: true,
      results
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, partialResults: results });
  }
});

router.get("/health", requireRole("admin", "owner"), requireDb, async (_req, res) => {
  try {
    const [draftCount, runningCount, activeCount, orphanedJobs, engagements] =
      await Promise.all([
        Engagement.countDocuments({ status: { $in: ["draft", "DRAFT"] } }),
        Engagement.countDocuments({ status: "running" }),
        // Legacy/manual values that may exist even if enum changed over time.
        Engagement.countDocuments({ status: "active" }).catch(() => 0),
        ExecutionJob.countDocuments({
          status: "running",
          startedAt: { $lt: new Date(Date.now() - 10 * 60 * 1000) }
        }),
        Engagement.find({})
          .select("constraints.toolWhitelist toolWhitelist")
          .lean()
      ]);

    let emptyWhitelists = 0;
    for (const engagement of engagements) {
      const nested = normalizeWhitelist(engagement?.constraints?.toolWhitelist);
      const legacy = normalizeWhitelist(engagement?.toolWhitelist);
      if (nested.length === 0 && legacy.length === 0) {
        emptyWhitelists += 1;
      }
    }

    return res.json({
      engagements: {
        draft: draftCount,
        running: runningCount,
        active: activeCount,
        activeEquivalent: runningCount + activeCount
      },
      orphanedJobs,
      emptyWhitelists,
      healthy: draftCount === 0 && orphanedJobs === 0 && emptyWhitelists === 0
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
