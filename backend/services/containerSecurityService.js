const axios = require("axios");
const Engagement = require("../models/Engagement");
const executionLoggerService = require("./executionLoggerService");
const { logger } = require("../config/logger");

const K8S_PATHS = [
  "k8s/deployment.yaml",
  "kubernetes/deployment.yaml",
  "deploy/deployment.yaml"
];

function asString(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseGitHubTarget(targetUrl) {
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

function buildTestId() {
  return `test-container-scan-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

class ContainerSecurityService {
  constructor(httpClient = axios, executionLogger = executionLoggerService) {
    this.httpClient = httpClient;
    this.executionLogger = executionLogger;
    this.VULNERABLE_IMAGES = {
      "ubuntu:18.04": {
        cve: "CVE-2021-3156",
        severity: "high",
        replacement: "ubuntu:22.04"
      },
      "ubuntu:20.04": {
        cve: "CVE-2021-3493",
        severity: "high",
        replacement: "ubuntu:22.04"
      },
      "node:14": {
        cve: "CVE-2021-44531",
        severity: "critical",
        replacement: "node:20-alpine"
      },
      "node:16": {
        cve: "CVE-2023-23918",
        severity: "high",
        replacement: "node:20-alpine"
      },
      "python:3.8": {
        cve: "CVE-2023-24329",
        severity: "high",
        replacement: "python:3.11-slim"
      },
      "nginx:1.18": {
        cve: "CVE-2021-23017",
        severity: "high",
        replacement: "nginx:1.25-alpine"
      }
    };
  }

  getKnownVulnerableImage(imageRef) {
    const normalized = String(imageRef || "").trim().toLowerCase();
    return this.VULNERABLE_IMAGES[normalized] || null;
  }

  buildFinding({
    idPrefix = "container",
    type,
    title,
    description,
    severity = "medium",
    recommendation,
    filePath,
    check,
    found
  }) {
    return {
      id: `${idPrefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      type,
      severity,
      category: "Container Security",
      title,
      description,
      recommendation,
      remediation: recommendation,
      source: "container_security",
      tags: ["container-security", String(type || "").toLowerCase()],
      metadata: {
        findingType: type,
        filePath: filePath || "",
        check: check || "",
        found: found || ""
      }
    };
  }

  parseImageReference(imageRef) {
    const trimmed = String(imageRef || "").trim();
    if (!trimmed) {
      return { raw: "", tag: null, hasTag: false, isLatest: false };
    }
    const withoutDigest = trimmed.split("@")[0];
    const pathParts = withoutDigest.split("/");
    const lastPart = pathParts[pathParts.length - 1] || "";
    const tagIndex = lastPart.lastIndexOf(":");
    if (tagIndex <= 0) {
      return {
        raw: withoutDigest.toLowerCase(),
        tag: null,
        hasTag: false,
        isLatest: false
      };
    }
    const tag = lastPart.slice(tagIndex + 1).toLowerCase();
    return {
      raw: withoutDigest.toLowerCase(),
      tag,
      hasTag: true,
      isLatest: tag === "latest"
    };
  }

  scanDockerfileContent(content, filePath = "Dockerfile") {
    const text = asString(content);
    if (!text.trim()) {
      return { findings: [], checksRan: [] };
    }

    const findings = [];
    const checksRan = [
      "vulnerable_base_image",
      "unpinned_base_image",
      "user_directive",
      "hardcoded_secrets",
      "healthcheck"
    ];
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      const match = line.match(/^\s*FROM\s+([^\s]+)/i);
      if (!match) {
        continue;
      }
      const imageRef = String(match[1] || "").trim();
      const vulnerable = this.getKnownVulnerableImage(imageRef);
      if (vulnerable) {
        findings.push(
          this.buildFinding({
            type: "CONTAINER_VULNERABLE_BASE_IMAGE",
            severity: vulnerable.severity,
            title: `Vulnerable base image detected: ${imageRef}`,
            description: `Base image ${imageRef} is associated with ${vulnerable.cve}.`,
            recommendation: `Change \`FROM ${imageRef}\` to \`FROM ${vulnerable.replacement}\`.`,
            filePath,
            check: "vulnerable_base_image",
            found: `${imageRef} (${vulnerable.cve})`
          })
        );
      }

      const parsed = this.parseImageReference(imageRef);
      if (parsed.isLatest || !parsed.hasTag) {
        findings.push(
          this.buildFinding({
            type: "CONTAINER_UNPINNED_BASE_IMAGE",
            severity: "medium",
            title: `Unpinned base image reference: ${imageRef}`,
            description:
              "Container image tag is latest or missing, making builds non-reproducible.",
            recommendation:
              "Pin the base image to an explicit version tag (for example `node:20.12-alpine`).",
            filePath,
            check: "unpinned_base_image",
            found: imageRef
          })
        );
      }
    }

    const userDirective = text.match(/^\s*USER\s+([^\s#]+)/im);
    if (!userDirective) {
      findings.push(
        this.buildFinding({
          type: "CONTAINER_USER_MISSING",
          severity: "high",
          title: "Dockerfile missing USER directive",
          description: "Container defaults to root execution when USER is not specified.",
          recommendation:
            "Add a least-privilege user and set it explicitly, e.g. `RUN adduser -D app && USER app`.",
          filePath,
          check: "user_directive",
          found: "No USER directive"
        })
      );
    } else if (String(userDirective[1] || "").trim().toLowerCase() === "root") {
      findings.push(
        this.buildFinding({
          type: "CONTAINER_RUNS_AS_ROOT",
          severity: "high",
          title: "Container runs as root user",
          description: "Dockerfile sets USER root, increasing privilege-escalation risk.",
          recommendation:
            "Replace `USER root` with a non-root runtime user such as `USER app`.",
          filePath,
          check: "user_directive",
          found: "USER root"
        })
      );
    }

    const secretPattern =
      /^\s*(ENV|ARG)\s+([A-Za-z0-9_]+)\s*(?:=\s*|\s+)([^\s#]+)\s*$/gim;
    let secretMatch = secretPattern.exec(text);
    while (secretMatch) {
      const key = String(secretMatch[2] || "").trim();
      const value = String(secretMatch[3] || "").trim();
      if (
        /(KEY|SECRET|PASSWORD|TOKEN|PASS)/i.test(key) &&
        value &&
        !value.startsWith("$") &&
        !value.startsWith("${")
      ) {
        findings.push(
          this.buildFinding({
            type: "CONTAINER_HARDCODED_SECRET",
            severity: "critical",
            title: `Hardcoded secret in Dockerfile variable ${key}`,
            description:
              "Secret-like variable appears with a literal value in Docker build instructions.",
            recommendation:
              `Remove hardcoded value from ${key} and pass it at runtime via secrets manager or environment injection.`,
            filePath,
            check: "hardcoded_secrets",
            found: `${key}=<hardcoded>`
          })
        );
      }
      secretMatch = secretPattern.exec(text);
    }

    if (!/^\s*HEALTHCHECK\b/im.test(text)) {
      findings.push(
        this.buildFinding({
          type: "CONTAINER_MISSING_HEALTHCHECK",
          severity: "low",
          title: "Dockerfile missing HEALTHCHECK directive",
          description:
            "No health probe is defined, making unhealthy containers harder to detect automatically.",
          recommendation:
            "Add a HEALTHCHECK command, e.g. `HEALTHCHECK CMD curl --fail http://localhost:3000/health || exit 1`.",
          filePath,
          check: "healthcheck",
          found: "No HEALTHCHECK directive"
        })
      );
    }

    return { findings, checksRan };
  }

  scanComposeContent(content, filePath = "docker-compose.yml") {
    const text = asString(content);
    if (!text.trim()) {
      return { findings: [], checksRan: [] };
    }

    const checksRan = ["privileged_mode", "resource_limits"];
    const findings = [];

    if (/^\s*privileged\s*:\s*true\s*$/im.test(text)) {
      findings.push(
        this.buildFinding({
          type: "CONTAINER_PRIVILEGED_MODE",
          severity: "critical",
          title: "docker-compose service runs with privileged=true",
          description:
            "Privileged mode grants near-host level access and can enable container escape paths.",
          recommendation:
            "Set `privileged: false` (or remove the flag) and grant only required capabilities explicitly.",
          filePath,
          check: "privileged_mode",
          found: "privileged: true"
        })
      );
    }

    const hasMemLimit = /^\s*mem_limit\s*:/im.test(text);
    const hasCpusLimit = /^\s*cpus\s*:/im.test(text);
    if (!hasMemLimit || !hasCpusLimit) {
      findings.push(
        this.buildFinding({
          type: "CONTAINER_MISSING_RESOURCE_LIMITS",
          severity: "medium",
          title: "docker-compose resources are unconstrained",
          description:
            "One or more services are missing memory and CPU constraints, increasing denial-of-service risk.",
          recommendation:
            "Define both `mem_limit` and `cpus` for each service (e.g. `mem_limit: 512m`, `cpus: 0.5`).",
          filePath,
          check: "resource_limits",
          found: `mem_limit=${hasMemLimit ? "present" : "missing"}, cpus=${hasCpusLimit ? "present" : "missing"}`
        })
      );
    }

    return { findings, checksRan };
  }

  scanKubernetesManifest(content, filePath) {
    const text = asString(content);
    if (!text.trim()) {
      return { findings: [], checksRan: [] };
    }

    const checksRan = ["security_context", "image_pinning"];
    const findings = [];

    if (!/^\s*securityContext\s*:/im.test(text)) {
      findings.push(
        this.buildFinding({
          type: "K8S_MISSING_SECURITY_CONTEXT",
          severity: "high",
          title: "Kubernetes manifest missing securityContext",
          description:
            "Workload spec does not declare securityContext controls (runAsNonRoot, fsGroup, etc.).",
          recommendation:
            "Add `securityContext` with least-privilege settings, e.g. `runAsNonRoot: true`, `allowPrivilegeEscalation: false`.",
          filePath,
          check: "security_context",
          found: "No securityContext block"
        })
      );
    }

    const imageMatches = text.match(/^\s*image\s*:\s*([^\s#]+)\s*$/gim) || [];
    for (const imageLine of imageMatches) {
      const imageRef = String(imageLine.split(":").slice(1).join(":") || "")
        .trim()
        .replace(/^["']|["']$/g, "");
      const parsed = this.parseImageReference(imageRef);
      if (parsed.isLatest || !parsed.hasTag) {
        findings.push(
          this.buildFinding({
            type: "K8S_UNPINNED_IMAGE",
            severity: "medium",
            title: `Kubernetes image is unpinned: ${imageRef || "unknown"}`,
            description:
              "Image tag is latest or missing, making deployments non-deterministic.",
            recommendation:
              "Pin image to a fixed version tag or digest, e.g. `image: app:1.4.2`.",
            filePath,
            check: "image_pinning",
            found: imageRef
          })
        );
      }
    }

    return { findings, checksRan };
  }

  async safeGet(url, headers = {}) {
    try {
      const response = await this.httpClient.get(url, {
        headers,
        timeout: 7000,
        validateStatus: () => true
      });
      return {
        status: Number(response.status || 0),
        data: response.data
      };
    } catch (error) {
      return {
        status: 0,
        data: null,
        error: error?.message || "request failed"
      };
    }
  }

  async fetchRawFile({ owner, repo, filePath, headers = {} }) {
    const branches = ["main", "master"];
    for (const branch of branches) {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
      // eslint-disable-next-line no-await-in-loop
      const response = await this.safeGet(url, headers);
      if (response.status >= 200 && response.status < 300) {
        return {
          filePath,
          branch,
          content: asString(response.data)
        };
      }
    }
    return null;
  }

  topSeverity(findings = []) {
    const rank = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
    let current = "low";
    for (const finding of findings) {
      const candidate = String(finding?.severity || "low").toLowerCase();
      if ((rank[candidate] || 0) > (rank[current] || 0)) {
        current = candidate;
      }
    }
    return current;
  }

  async logContainerExecution({
    engagementId,
    targetUrl,
    findings,
    attemptedFiles,
    filesFound,
    checksRan,
    durationMs,
    note = ""
  }) {
    if (!engagementId) {
      return;
    }
    await this.executionLogger.logTestExecution({
      engagementId,
      testId: buildTestId(),
      testName: "Container Security Scan",
      tool: "VENOM Container Scanner",
      category: "Container Security",
      target: targetUrl,
      parameters: {
        attemptedFiles,
        filesFound,
        checksRan
      },
      response: {
        statusCode: 200,
        headers: {},
        bodySize: JSON.stringify({
          findings: findings.length,
          attemptedFiles,
          filesFound
        }).length
      },
      result: {
        status: findings.length > 0 ? "VULNERABLE" : "PASSED",
        confidence: findings.length > 0 ? 0.9 : 0.85,
        reason:
          note ||
          (findings.length > 0
            ? `${findings.length} container security finding(s) detected.`
            : "No container security findings detected."),
        severity: this.topSeverity(findings)
      },
      executionTimeMs: durationMs,
      findingCount: findings.length,
      meta: {
        scanner: "VENOM Container Scanner"
      }
    });
  }

  async scanEngagement(engagementId, targetUrlInput = "") {
    const startedAt = Date.now();
    try {
      const engagement = await Engagement.findById(engagementId).lean();
      if (!engagement) {
        const error = new Error("Engagement not found");
        error.code = "ENGAGEMENT_NOT_FOUND";
        throw error;
      }

      const targetUrl = String(targetUrlInput || engagement.targetUrl || "").trim();
      const parsedGitHub = parseGitHubTarget(targetUrl);
      if (!parsedGitHub) {
        await this.logContainerExecution({
          engagementId: String(engagement._id),
          targetUrl,
          findings: [],
          attemptedFiles: [],
          filesFound: [],
          checksRan: [],
          durationMs: Date.now() - startedAt,
          note: "Target is not a GitHub repository. Container scan skipped."
        });
        return {
          findings: [],
          attemptedFiles: [],
          filesFound: [],
          checksRan: [],
          skipped: true,
          reason: "Target is not a GitHub repository URL."
        };
      }

      const { owner, repo } = parsedGitHub;
      const authToken = String(process.env.GITHUB_TOKEN || "").trim();
      const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
      const findings = [];
      const attemptedFiles = [];
      const filesFound = [];
      const checksRan = new Set();
      attemptedFiles.push("Dockerfile");

      const dockerfile = await this.fetchRawFile({
        owner,
        repo,
        filePath: "Dockerfile",
        headers
      });
      if (dockerfile) {
        filesFound.push(dockerfile.filePath);
        const scan = this.scanDockerfileContent(dockerfile.content, dockerfile.filePath);
        scan.findings.forEach((finding) => findings.push(finding));
        scan.checksRan.forEach((check) => checksRan.add(check));
      } else {
        logger.warn({ owner, repo }, "Dockerfile not found for container scan");
      }

      attemptedFiles.push("docker-compose.yml");
      const compose = await this.fetchRawFile({
        owner,
        repo,
        filePath: "docker-compose.yml",
        headers
      });
      if (compose) {
        filesFound.push(compose.filePath);
        const scan = this.scanComposeContent(compose.content, compose.filePath);
        scan.findings.forEach((finding) => findings.push(finding));
        scan.checksRan.forEach((check) => checksRan.add(check));
      } else {
        logger.warn({ owner, repo }, "docker-compose.yml not found for container scan");
      }

      let k8sFile = null;
      for (const candidate of K8S_PATHS) {
        attemptedFiles.push(candidate);
        // eslint-disable-next-line no-await-in-loop
        k8sFile = await this.fetchRawFile({
          owner,
          repo,
          filePath: candidate,
          headers
        });
        if (k8sFile) {
          break;
        }
      }
      if (k8sFile) {
        filesFound.push(k8sFile.filePath);
        const scan = this.scanKubernetesManifest(k8sFile.content, k8sFile.filePath);
        scan.findings.forEach((finding) => findings.push(finding));
        scan.checksRan.forEach((check) => checksRan.add(check));
      } else {
        logger.warn({ owner, repo }, "Kubernetes manifest not found for container scan");
      }

      await this.logContainerExecution({
        engagementId: String(engagement._id),
        targetUrl,
        findings,
        attemptedFiles,
        filesFound,
        checksRan: [...checksRan],
        durationMs: Date.now() - startedAt
      });

      return {
        findings,
        attemptedFiles,
        filesFound,
        checksRan: [...checksRan]
      };
    } catch (error) {
      logger.error(
        { engagementId, error: error?.message || String(error) },
        "Container security scan failed"
      );
      return {
        findings: [],
        attemptedFiles: [],
        filesFound: [],
        checksRan: [],
        error: error?.message || "Container security scan failed"
      };
    }
  }
}

module.exports = new ContainerSecurityService();
