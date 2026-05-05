const express = require("express");
const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const requireDb = require("../middleware/requireDb");
const { deduplicateFindings } = require("../utils/deduplicateFindings");
const {
  generateComplianceSummary
} = require("../services/complianceMapper");

const router = express.Router();

function flattenFindingsFromJobs(jobs = []) {
  return jobs.flatMap((job) => {
    if (Array.isArray(job.findings) && job.findings.length > 0) {
      return job.findings;
    }
    if (Array.isArray(job.output?.findings) && job.output.findings.length > 0) {
      return job.output.findings;
    }
    return [];
  });
}

router.get("/:engagementId", requireDb, async (req, res, next) => {
  try {
    const engagement = await Engagement.findById(req.params.engagementId).lean();
    if (!engagement) {
      return res.status(404).json({
        error: "Engagement not found"
      });
    }

    const jobs = await ExecutionJob.find({
      engagementId: engagement._id
    })
      .sort({ createdAt: -1 })
      .lean();

    const findings = deduplicateFindings(flattenFindingsFromJobs(jobs));
    const summary = generateComplianceSummary(findings);

    return res.status(200).json({
      engagementId: String(engagement._id),
      targetUrl: engagement.targetUrl,
      totalJobs: jobs.length,
      totalFindings: findings.length,
      ...summary
    });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    return next(error);
  }
});

module.exports = router;
