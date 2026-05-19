const ExecutionLog = require("../models/ExecutionLog");
const { logger } = require("../config/logger");

function asObject(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value;
}

function clampConfidence(value, fallback = 0.5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < 0) {
    return 0;
  }
  if (parsed > 1) {
    return 1;
  }
  return parsed;
}

function toPositiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

class ExecutionLoggerService {
  async logTestExecution(testData = {}) {
    try {
      const response = asObject(testData.response);
      const bodyText =
        typeof response.body === "string"
          ? response.body
          : typeof response.rawOutput === "string"
            ? response.rawOutput
            : "";
      const bodySize = toPositiveNumber(
        testData.responseBodySize ??
          response.bodySize ??
          response.contentLength ??
          bodyText.length,
        0
      );
      const result = asObject(testData.result);
      const status = String(result.status || "PASSED").toUpperCase();

      const payload = {
        engagementId: testData.engagementId,
        testId: String(testData.testId || "").trim(),
        testName: String(testData.testName || "").trim(),
        tool: String(testData.tool || "").trim(),
        category: String(testData.category || "General").trim(),
        target: String(testData.target || "").trim(),
        parameters: asObject(testData.parameters),
        response: {
          statusCode: toPositiveNumber(
            testData.statusCode ?? response.statusCode ?? response.status,
            0
          ),
          headers: asObject(response.headers),
          bodySize
        },
        result: {
          status: ["PASSED", "VULNERABLE", "BLOCKED", "FAILED"].includes(status)
            ? status
            : "FAILED",
          confidence: clampConfidence(result.confidence, 0.5),
          reason: String(result.reason || "").trim(),
          severity: this.normalizeSeverity(result.severity)
        },
        executionTimeMs: toPositiveNumber(testData.executionTimeMs, 0),
        findingCount: toPositiveNumber(testData.findingCount, 0),
        meta: asObject(testData.meta),
        timestamp: testData.timestamp ? new Date(testData.timestamp) : new Date()
      };

      if (!payload.engagementId || !payload.testId || !payload.testName || !payload.tool) {
        throw new Error("engagementId, testId, testName, and tool are required for execution logs");
      }

      const logEntry = await ExecutionLog.findOneAndUpdate(
        {
          engagementId: payload.engagementId,
          testId: payload.testId
        },
        {
          $set: payload
        },
        {
          upsert: true,
          returnDocument: "after"
        }
      ).lean();

      logger.info(
        {
          engagementId: String(payload.engagementId),
          testId: payload.testId,
          status: payload.result.status
        },
        "Execution trace logged"
      );
      return logEntry;
    } catch (error) {
      logger.error(
        { error: error?.message || String(error) },
        "Failed to log test execution"
      );
      return null;
    }
  }

  normalizeSeverity(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (["critical", "high", "medium", "low", "info"].includes(normalized)) {
      return normalized;
    }
    return "low";
  }

  getStatusForExecutionJob(job = {}) {
    const status = String(job.status || "").toLowerCase();
    if (status === "success") {
      const findingCount = Array.isArray(job.findings) ? job.findings.length : 0;
      return findingCount > 0 ? "VULNERABLE" : "PASSED";
    }
    if (status === "blocked" || status === "timeout") {
      return "BLOCKED";
    }
    return "FAILED";
  }

  getDefaultReason(job = {}) {
    const mapped = this.getStatusForExecutionJob(job);
    if (mapped === "PASSED") {
      return "No vulnerability findings recorded for this test.";
    }
    if (mapped === "VULNERABLE") {
      return `${Array.isArray(job.findings) ? job.findings.length : 0} finding(s) recorded.`;
    }
    return String(job.errorMessage || "Tool execution failed or was blocked.");
  }

  async logExecutionJob({
    engagementId,
    testId,
    testName,
    tool,
    category = "General",
    target,
    parameters = {},
    job = {},
    meta = {}
  }) {
    const findings = Array.isArray(job.findings) ? job.findings : [];
    const severity = findings.length > 0
      ? this.normalizeSeverity(findings[0]?.severity)
      : job.status === "blocked" || job.status === "failed" || job.status === "timeout"
        ? "medium"
        : "low";
    return this.logTestExecution({
      engagementId,
      testId,
      testName,
      tool,
      category,
      target,
      parameters,
      response: {
        statusCode: this.mapExecutionJobStatusToStatusCode(job.status),
        headers: asObject(job.output?.headers),
        bodySize:
          typeof job.rawOutput === "string"
            ? job.rawOutput.length
            : JSON.stringify(job.output || {}).length
      },
      result: {
        status: this.getStatusForExecutionJob(job),
        confidence: findings.length > 0 ? 0.9 : 0.8,
        reason: this.getDefaultReason(job),
        severity
      },
      executionTimeMs: toPositiveNumber(job.durationMs, 0),
      findingCount: findings.length,
      meta: {
        toolId: job.toolId || tool,
        jobId: String(job._id || ""),
        ...meta
      }
    });
  }

  mapExecutionJobStatusToStatusCode(status) {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "success") {
      return 200;
    }
    if (normalized === "blocked") {
      return 403;
    }
    if (normalized === "timeout") {
      return 504;
    }
    if (normalized === "failed") {
      return 422;
    }
    return 0;
  }

  async getExecutionSummary(engagementId) {
    try {
      const logs = await ExecutionLog.find({ engagementId }).sort({ timestamp: 1 }).lean();
      const totalTests = logs.length;
      const passed = logs.filter((item) => item.result?.status === "PASSED").length;
      const failed = logs.filter((item) => item.result?.status === "VULNERABLE").length;
      const blocked = logs.filter((item) => item.result?.status === "BLOCKED").length;
      const errored = logs.filter((item) => item.result?.status === "FAILED").length;
      const totalTimeMs = logs.reduce(
        (sum, item) => sum + toPositiveNumber(item.executionTimeMs, 0),
        0
      );
      const successRate = totalTests > 0 ? Number(((passed / totalTests) * 100).toFixed(1)) : 0;

      return {
        totalTests,
        passed,
        failed,
        blocked,
        errored,
        totalTimeMs,
        successRate,
        byTool: this.groupByTool(logs),
        timeline: logs.map((item) => ({
          testId: item.testId,
          testName: item.testName,
          tool: item.tool,
          category: item.category,
          timeMs: toPositiveNumber(item.executionTimeMs, 0),
          result: item.result?.status || "FAILED",
          findingCount: toPositiveNumber(item.findingCount, 0),
          timestamp: item.timestamp
        }))
      };
    } catch (error) {
      logger.error(
        { error: error?.message || String(error), engagementId: String(engagementId || "") },
        "Failed to get execution summary"
      );
      return null;
    }
  }

  async getDetailedTrace(testId) {
    try {
      const log = await ExecutionLog.findOne({ testId }).lean();
      if (!log) {
        return null;
      }

      const decisionTree = this.generateDecisionLogic(log);
      return {
        test: {
          id: log.testId,
          name: log.testName,
          tool: log.tool,
          category: log.category,
          executedAt: log.timestamp
        },
        parameters: log.parameters || {},
        response: {
          statusCode: toPositiveNumber(log.response?.statusCode, 0),
          headers: asObject(log.response?.headers),
          bodySize: toPositiveNumber(log.response?.bodySize, 0)
        },
        result: {
          status: log.result?.status || "FAILED",
          confidence: clampConfidence(log.result?.confidence, 0.5),
          reason: log.result?.reason || "",
          severity: this.normalizeSeverity(log.result?.severity)
        },
        executionTimeMs: toPositiveNumber(log.executionTimeMs, 0),
        decisionTree,
        developerGuidance: this.generateDeveloperGuidance(log, decisionTree)
      };
    } catch (error) {
      logger.error(
        { error: error?.message || String(error), testId: String(testId || "") },
        "Failed to get detailed trace"
      );
      return null;
    }
  }

  generateDecisionLogic(log = {}) {
    const headers = asObject(log.response?.headers);
    const normalizedHeaders = Object.keys(headers).reduce((acc, key) => {
      acc[String(key).toLowerCase()] = headers[key];
      return acc;
    }, {});
    const decisions = [];
    const testName = String(log.testName || "").toLowerCase();
    const category = String(log.category || "").toLowerCase();
    const checkCsp = testName.includes("csp") || category.includes("header");

    if (checkCsp) {
      const hasCsp = Boolean(normalizedHeaders["content-security-policy"]);
      const hasNosniff = Boolean(normalizedHeaders["x-content-type-options"]);
      decisions.push({
        step: 1,
        check: "Check for Content-Security-Policy header",
        result: hasCsp ? "FOUND" : "NOT_FOUND",
        implication: hasCsp ? "CSP baseline present." : "No CSP script execution guard present."
      });
      decisions.push({
        step: 2,
        check: "Check for X-Content-Type-Options header",
        result: hasNosniff ? "FOUND" : "NOT_FOUND",
        implication: hasNosniff
          ? "MIME sniffing mitigated."
          : "MIME sniffing not explicitly mitigated."
      });
      decisions.push({
        step: 3,
        check: "Assign severity based on compensating controls",
        result:
          !hasCsp && hasNosniff
            ? "MEDIUM"
            : !hasCsp && !hasNosniff
              ? "HIGH"
              : this.normalizeSeverity(log.result?.severity).toUpperCase(),
        implication:
          !hasCsp && hasNosniff
            ? "Partial mitigation exists, but script policy is absent."
            : !hasCsp
              ? "Missing CSP and no compensating header."
              : "Header controls detected."
      });
    } else {
      decisions.push({
        step: 1,
        check: "Evaluate execution outcome",
        result: String(log.result?.status || "FAILED"),
        implication: String(log.result?.reason || "See execution record for details.")
      });
    }

    return decisions;
  }

  generateDeveloperGuidance(log = {}, decisionTree = []) {
    const guidance = [];
    const testName = String(log.testName || "").toLowerCase();
    const status = String(log.result?.status || "").toUpperCase();
    const hasMissingCsp = decisionTree.some(
      (item) =>
        String(item.check || "").toLowerCase().includes("content-security-policy") &&
        String(item.result || "").toUpperCase() === "NOT_FOUND"
    );

    if (hasMissingCsp || testName.includes("csp")) {
      guidance.push({
        title: "Implement and phase-in Content-Security-Policy",
        steps: [
          "Start with report-only mode to collect violation telemetry.",
          "Define a least-privilege baseline policy with self-hosted defaults.",
          "Migrate inline scripts/styles to nonce or hash-based allowances.",
          "Switch from report-only to enforced mode after verification."
        ],
        testing:
          "Attempt script injection and confirm policy violations are blocked and reported.",
        references: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP"
      });
    }

    if (status === "PASSED") {
      guidance.push({
        title: "Maintain current control posture",
        steps: [
          "Retain this test in scheduled scan profiles.",
          "Track control drift across releases with regression alerts."
        ],
        testing: "Re-run the same probe after infrastructure or framework upgrades.",
        references: "Internal regression policy"
      });
    }

    return guidance;
  }

  groupByTool(logs = []) {
    const grouped = {};
    for (const item of logs) {
      const tool = String(item.tool || "unknown");
      if (!grouped[tool]) {
        grouped[tool] = {
          count: 0,
          passed: 0,
          failed: 0,
          blocked: 0,
          errored: 0,
          timeMs: 0
        };
      }
      grouped[tool].count += 1;
      grouped[tool].timeMs += toPositiveNumber(item.executionTimeMs, 0);
      const status = String(item.result?.status || "FAILED").toUpperCase();
      if (status === "PASSED") {
        grouped[tool].passed += 1;
      } else if (status === "VULNERABLE") {
        grouped[tool].failed += 1;
      } else if (status === "BLOCKED") {
        grouped[tool].blocked += 1;
      } else {
        grouped[tool].errored += 1;
      }
    }
    return grouped;
  }
}

module.exports = new ExecutionLoggerService();
