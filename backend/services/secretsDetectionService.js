const axios = require("axios");
const Engagement = require("../models/Engagement");
const { logger } = require("../config/logger");
const {
  createNotApplicableResult,
  createStructuredError,
  logError,
  logWarn
} = require("../utils/scanErrors");

function sanitizeContent(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf-8");
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || "");
  }
}

function toGlobalRegex(pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function toMaskedPreview(value) {
  const text = String(value || "");
  if (!text) {
    return "****";
  }
  return `${text.slice(0, 8)}****`;
}

class SecretsDetectionService {
  constructor(httpClient = axios) {
    this.httpClient = httpClient;
    this.PATTERNS = {
      AWS_KEY: /AKIA[0-9A-Z]{16}/,
      AWS_SECRET:
        /aws_secret_access_key\s*=\s*["']?([A-Za-z0-9/+=]{30,})["']?/i,
      GITHUB_TOKEN: /ghp_[a-zA-Z0-9_]{36,}/,
      STRIPE_KEY: /sk_live_[a-zA-Z0-9_]{20,}/,
      PRIVATE_KEY: /-----BEGIN (?:RSA|DSA|EC|OPENSSH|PRIVATE) PRIVATE KEY-----/,
      DATABASE_URL: /(?:mysql|postgres|mongodb):\/\/[^/\s]+:[^@\s]+@/i,
      API_KEY: /api[_-]?key\s*[=:]\s*["']?([a-zA-Z0-9\-_.]{20,})["']?/i,
      JWT_SECRET: /jwt[_-]?secret\s*[=:]\s*["']?([a-zA-Z0-9\-_.]{20,})["']?/i
    };
  }

  async scanEngagement(engagementId) {
    try {
      const engagement = await Engagement.findById(engagementId).lean();
      if (!engagement) {
        const error = new Error("Engagement not found");
        error.code = "ENGAGEMENT_NOT_FOUND";
        throw error;
      }

      logger.info({ engagementId }, "Starting secrets detection scan");

      const targetUrl = String(engagement.targetUrl || "").trim();
      if (!this.parseGitHubTarget(targetUrl)) {
        return {
          ...createNotApplicableResult({
            reason:
              "Source code analysis requires a GitHub repository URL. Secrets scans were not applicable for this target type.",
            requiredTarget: "a GitHub repository URL",
            note: "The secrets scan was intentionally skipped rather than failing."
          }),
          attemptedFiles: [],
          filesFound: []
        };
      }

      const githubResult = await this.scanGitHub(targetUrl);
      const allSecrets = githubResult.secrets;
      const deduped = this.deduplicateSecrets(allSecrets);
      const findings = deduped.map((secret, index) => this.toFinding(secret, index + 1));

      logger.info(
        { engagementId, findings: findings.length },
        "Secrets detection scan complete"
      );

      return {
        status: "SUCCESS",
        findings,
        attemptedFiles: githubResult.attemptedFiles,
        filesFound: githubResult.filesFound,
        meta: {
          scannedTarget: targetUrl,
          sourcesChecked: githubResult.filesFound.length,
          attemptedFiles: githubResult.attemptedFiles,
          filesFound: githubResult.filesFound
        }
      };
    } catch (error) {
      logError(logger, { engagementId }, "Secrets detection scan failed", error);
      const structuredError = createStructuredError(error);
      return {
        ...structuredError,
        findings: [],
        attemptedFiles: [],
        filesFound: [],
        error: structuredError.message
      };
    }
  }

  deduplicateSecrets(secrets = []) {
    const unique = new Map();
    for (const secret of secrets) {
      const key = `${secret.type}:${secret.location}:${secret.evidence}`;
      if (!unique.has(key)) {
        unique.set(key, secret);
      }
    }
    return [...unique.values()];
  }

  async scanGitHub(targetUrl) {
    const match = this.parseGitHubTarget(targetUrl);
    if (!match) {
      return { secrets: [], attemptedFiles: [], filesFound: [] };
    }

    const { owner, repo } = match;
    const authToken = String(process.env.GITHUB_TOKEN || "").trim();
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    const commonFiles = [
      ".env",
      ".env.example",
      ".env.local",
      ".env.production",
      "config.js",
      "config.json",
      "secrets.json"
    ];

    let defaultBranch = "main";
    try {
      const repoMeta = await this.httpClient.get(
        `https://api.github.com/repos/${owner}/${repo}`,
        { headers, timeout: 5000 }
      );
      defaultBranch = String(repoMeta?.data?.default_branch || "main").trim() || "main";
    } catch (error) {
      logger.debug(
        { owner, repo, error: error?.message || String(error) },
        "Unable to resolve GitHub default branch; falling back to main/master"
      );
    }

    const branchesToTry = Array.from(new Set([defaultBranch, "main", "master"]));
    const findings = [];
    const attemptedFiles = [];
    const filesFound = [];
    for (const filePath of commonFiles) {
      attemptedFiles.push(filePath);
      let content = null;
      for (const branch of branchesToTry) {
        try {
          const response = await this.httpClient.get(
            `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`,
            { headers, timeout: 5000 }
          );
          content = sanitizeContent(response.data);
          filesFound.push(filePath);
          break;
        } catch (error) {
          logWarn(
            logger,
            { owner, repo, branch, filePath },
            "Secrets scanner could not fetch GitHub file",
            error
          );
          // Try next branch.
        }
      }

      if (!content) {
        continue;
      }

      findings.push(...this.matchPatterns(content, `github:${owner}/${repo}/${filePath}`));
    }
    return { secrets: findings, attemptedFiles, filesFound };
  }

  async scanCommonConfigs(targetUrl) {
    if (!this.looksLikeHttpUrl(targetUrl)) {
      return [];
    }
    const githubTarget = this.parseGitHubTarget(targetUrl);
    if (githubTarget) {
      return [];
    }
    const normalizedTarget = targetUrl.replace(/\/+$/, "");
    const commonPaths = [
      "/.env",
      "/.env.local",
      "/config.json",
      "/secrets.json",
      "/aws-credentials",
      "/docker-compose.yml",
      "/.aws/credentials"
    ];

    const findings = [];
    for (const pathName of commonPaths) {
      try {
        const response = await this.httpClient.get(`${normalizedTarget}${pathName}`, {
          timeout: 5000
        });
        const content = sanitizeContent(response.data);
        findings.push(...this.matchPatterns(content, pathName));
      } catch {
        // Not exposed, skip.
      }
    }
    return findings;
  }

  async scanEnvironmentFiles(targetUrl) {
    if (!this.looksLikeHttpUrl(targetUrl)) {
      return [];
    }
    const githubTarget = this.parseGitHubTarget(targetUrl);
    if (githubTarget) {
      return [];
    }
    const normalizedTarget = targetUrl.replace(/\/+$/, "");
    const locations = ["/", "/error", "/debug"];
    const findings = [];

    for (const pathName of locations) {
      try {
        const response = await this.httpClient.get(`${normalizedTarget}${pathName}`, {
          timeout: 5000
        });
        const content = sanitizeContent(response.data);
        findings.push(...this.matchPatterns(content, `response:${pathName}`));
      } catch {
        // Skip non-accessible endpoints.
      }
    }
    return findings;
  }

  matchPatterns(content, location) {
    const text = sanitizeContent(content);
    const matches = [];

    for (const [type, pattern] of Object.entries(this.PATTERNS)) {
      const regex = toGlobalRegex(pattern);
      for (const found of text.matchAll(regex)) {
        const rawValue = found?.[1] || found?.[0] || "";
        matches.push({
          type,
          location,
          partial: toMaskedPreview(rawValue),
          evidence: String(found?.[0] || "").slice(0, 280),
          severity: "critical"
        });
      }
    }

    return matches;
  }

  looksLikeHttpUrl(value) {
    if (!value) {
      return false;
    }
    try {
      const parsed = new URL(String(value));
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  parseGitHubTarget(targetUrl) {
    if (!targetUrl) {
      return null;
    }
    try {
      const parsed = new URL(String(targetUrl));
      if (!/github\.com$/i.test(parsed.hostname)) {
        return null;
      }
      const segments = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
      if (segments.length < 2) {
        return null;
      }
      const owner = segments[0];
      const repo = segments[1].replace(/\.git$/i, "");
      if (!owner || !repo) {
        return null;
      }
      return { owner, repo };
    } catch {
      return null;
    }
  }

  toFinding(secret, index) {
    const remediation = this.getRemediation(secret.type);
    return {
      id: `secret-${index}`,
      type: "SECRET_FOUND",
      severity: "critical",
      category: "Secrets Exposure",
      title: `Exposed ${secret.type} detected`,
      description: `Potential ${secret.type} found in ${secret.location}.`,
      recommendation: remediation,
      remediation,
      source: "secrets_detection",
      evidence: secret.evidence,
      tags: ["secrets", String(secret.type || "").toLowerCase()],
      metadata: {
        location: secret.location,
        secretType: secret.type,
        partialValue: secret.partial
      }
    };
  }

  getRemediation(secretType) {
    const remediations = {
      AWS_KEY:
        "Rotate AWS credentials immediately in IAM and update dependent services with new keys.",
      AWS_SECRET:
        "Rotate AWS secret keys immediately and review IAM access logs for misuse.",
      GITHUB_TOKEN:
        "Revoke the exposed GitHub token and issue a least-privilege replacement token.",
      STRIPE_KEY:
        "Revoke the Stripe key in the dashboard and replace it in all environments.",
      PRIVATE_KEY:
        "Treat the private key as compromised, generate a new keypair, and rotate trust anchors.",
      DATABASE_URL:
        "Rotate database credentials and restrict network exposure to trusted sources only.",
      API_KEY:
        "Revoke and replace the API key, then move secret storage to an environment vault.",
      JWT_SECRET:
        "Rotate JWT signing secret and invalidate existing sessions/tokens."
    };
    return remediations[secretType] || "Rotate this credential and move secret storage to a secure vault.";
  }
}

module.exports = new SecretsDetectionService();
