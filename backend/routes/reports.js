const express = require("express");
const requireDb = require("../middleware/requireDb");
const Engagement = require("../models/Engagement");
const { logger } = require("../config/logger");
const {
  emailReport,
  generateHtmlReport,
  generateMarkdownReport,
  generatePdfReport
} = require("../services/reportGenerator");
const reportGeneratorService = require("../services/reportGeneratorService");
const complianceMapperService = require("../services/complianceMapperService");

const router = express.Router();

async function resolveComplianceSection(engagementId, reportFindings = []) {
  const engagement = await Engagement.findById(engagementId).lean();
  if (engagement?.complianceReport) {
    return engagement.complianceReport;
  }
  return complianceMapperService.generateComplianceReport(reportFindings);
}

router.get("/:engagementId/pdf", requireDb, async (req, res) => {
  try {
    const pdf = await generatePdfReport(req.params.engagementId);
    const filename = `VENOM-Report-${req.params.engagementId}-${Date.now()}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.setHeader("Content-Length", pdf.length);
    return res.status(200).send(pdf);
  } catch (error) {
    logger.error(
      { error: error?.message || String(error) },
      "PDF generation failed"
    );
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    if (error?.code === "ENGAGEMENT_NOT_FOUND") {
      return res.status(404).json({ error: "Engagement not found" });
    }
    return res.status(500).json({
      error: "PDF generation failed",
      reason: error?.message || "Unknown PDF error",
      suggestion:
        typeof error?.message === "string" && /timed out/i.test(error.message)
          ? "Server is under load. Try again in 30 seconds."
          : "Check Render logs for Chromium dependency errors.",
      fallback: `/api/reports/${req.params.engagementId}/md`
    });
  }
});

async function handleMarkdownDownload(req, res, next) {
  try {
    const markdown = await generateMarkdownReport(req.params.engagementId);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"venom-report-${req.params.engagementId}.md\"`
    );
    return res.status(200).send(markdown);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    if (error?.code === "ENGAGEMENT_NOT_FOUND") {
      return res.status(404).json({ error: "Engagement not found" });
    }
    return next(error);
  }
}

router.get("/:engagementId/markdown", requireDb, handleMarkdownDownload);
router.get("/:engagementId/md", requireDb, handleMarkdownDownload);

router.get("/:engagementId/html", requireDb, async (req, res, next) => {
  try {
    const html = await generateHtmlReport(req.params.engagementId, {
      redacted: true
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"venom-report-${req.params.engagementId}.html\"`
    );
    return res.status(200).send(html);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    if (error?.code === "ENGAGEMENT_NOT_FOUND") {
      return res.status(404).json({ error: "Engagement not found" });
    }
    return next(error);
  }
});

router.get("/:engagementId/hardened", requireDb, async (req, res, next) => {
  try {
    const report = await reportGeneratorService.generateReport(req.params.engagementId);
    const compliance = await resolveComplianceSection(
      req.params.engagementId,
      report.findings || []
    );
    return res.status(200).json({
      ...report,
      compliance
    });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    if (error?.code === "ENGAGEMENT_NOT_FOUND") {
      return res.status(404).json({ error: "Engagement not found" });
    }
    return next(error);
  }
});

router.get(
  "/:engagementId/detailed-with-execution",
  requireDb,
  async (req, res, next) => {
    try {
      const report = await reportGeneratorService.generateDetailedReport(
        req.params.engagementId
      );
      const compliance = await resolveComplianceSection(
        req.params.engagementId,
        report.findings || []
      );
      return res.status(200).json({
        ...report,
        compliance
      });
    } catch (error) {
      if (error?.name === "CastError") {
        return res.status(400).json({ error: "Invalid engagement id" });
      }
      if (error?.code === "ENGAGEMENT_NOT_FOUND") {
        return res.status(404).json({ error: "Engagement not found" });
      }
      return next(error);
    }
  }
);

router.post("/:engagementId/email", requireDb, async (req, res, next) => {
  try {
    const recipientEmail = req.body?.recipientEmail;
    if (!recipientEmail || typeof recipientEmail !== "string") {
      return res.status(400).json({ error: "recipientEmail is required" });
    }

    const result = await emailReport(req.params.engagementId, recipientEmail);
    return res.status(200).json(result);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    if (error?.code === "ENGAGEMENT_NOT_FOUND") {
      return res.status(404).json({ error: "Engagement not found" });
    }
    if (error?.code === "SMTP_NOT_CONFIGURED") {
      return res.status(503).json({ error: error.message });
    }
    if (error?.code === "SMTP_AUTH_FAILED") {
      return res.status(502).json({
        error: error.message,
        suggestion:
          "Confirm SMTP credentials and provider auth settings (app password/OAuth requirement)."
      });
    }
    if (error?.code === "SMTP_CONNECT_FAILED") {
      return res.status(502).json({
        error: error.message,
        suggestion:
          "Validate SMTP_HOST/SMTP_PORT and ensure outbound SMTP is allowed from Render."
      });
    }
    if (error?.code === "SMTP_SEND_FAILED") {
      return res.status(502).json({
        error: error.message,
        suggestion: "Check Render logs for exact SMTP provider rejection details."
      });
    }
    if (error?.code === "INVALID_EMAIL") {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

module.exports = router;
