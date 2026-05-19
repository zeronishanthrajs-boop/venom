const axios = require("axios");
const Engagement = require("../models/Engagement");
const { logger } = require("../config/logger");

function looksLikeHttpUrl(value) {
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
    return {
      owner: segments[0],
      repo: segments[1].replace(/\.git$/i, "")
    };
  } catch {
    return null;
  }
}

function normalizeSemver(version) {
  const raw = String(version || "").trim();
  if (!raw) {
    return "";
  }
  const cleaned = raw.replace(/^[~^<>=\s]*/, "");
  const match = cleaned.match(/\d+\.\d+\.\d+/);
  return match ? match[0] : cleaned;
}

function parsePackageJson(data) {
  if (!data) {
    return null;
  }
  if (typeof data === "object") {
    return data;
  }
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

class SupplyChainService {
  constructor(httpClient = axios) {
    this.httpClient = httpClient;
  }

  async scanEngagement(engagementId, targetUrlInput = "") {
    try {
      const engagement = await Engagement.findById(engagementId).lean();
      if (!engagement) {
        const error = new Error("Engagement not found");
        error.code = "ENGAGEMENT_NOT_FOUND";
        throw error;
      }

      const targetUrl = String(targetUrlInput || engagement.targetUrl || "").trim();
      logger.info({ engagementId, targetUrl }, "Starting supply-chain scan");

      const npmVulns = await this.scanNpmDependencies(targetUrl);
      const advisoryVulns = await this.checkGitHubAdvisories(targetUrl);
      const nvdVulns = await this.checkNVDDatabase(npmVulns);

      const all = [...npmVulns, ...advisoryVulns, ...nvdVulns];
      const deduped = Array.from(new Map(all.map((item) => [item.id, item])).values());
      const findings = deduped.map((item, index) => this.toFinding(item, index + 1));

      logger.info(
        { engagementId, vulnerabilities: findings.length },
        "Supply-chain scan complete"
      );

      return {
        findings,
        vulnerabilities: deduped
      };
    } catch (error) {
      logger.error(
        { engagementId, error: error?.message || String(error) },
        "Supply-chain scan failed"
      );
      return {
        findings: [],
        vulnerabilities: [],
        error: error?.message || "Supply-chain scan failed"
      };
    }
  }

  async scanNpmDependencies(targetUrl) {
    const packageJson = await this.fetchPackageJson(targetUrl);
    if (!packageJson) {
      return [];
    }

    const dependencies = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {})
    };

    const vulnerabilities = [];
    for (const [pkg, rawVersion] of Object.entries(dependencies)) {
      const version = normalizeSemver(rawVersion);
      const advisory = await this.checkNpmAdvisory(pkg, version);
      if (advisory) {
        vulnerabilities.push(advisory);
      }
    }
    return vulnerabilities;
  }

  async fetchPackageJson(targetUrl) {
    if (!targetUrl) {
      return null;
    }

    if (looksLikeHttpUrl(targetUrl)) {
      const normalized = targetUrl.replace(/\/+$/, "");
      const pathsToTry = ["/package.json", "/app/package.json", "/src/package.json"];
      for (const pathName of pathsToTry) {
        try {
          const response = await this.httpClient.get(`${normalized}${pathName}`, {
            timeout: 5000
          });
          const parsed = parsePackageJson(response.data);
          if (parsed) {
            return parsed;
          }
        } catch {
          // Try next path.
        }
      }
    }

    const gitTarget = parseGitHubTarget(targetUrl);
    if (!gitTarget) {
      return null;
    }

    const { owner, repo } = gitTarget;
    const authToken = String(process.env.GITHUB_TOKEN || "").trim();
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    const branches = ["main", "master"];
    for (const branch of branches) {
      try {
        const response = await this.httpClient.get(
          `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/package.json`,
          {
            timeout: 5000,
            headers
          }
        );
        const parsed = parsePackageJson(response.data);
        if (parsed) {
          return parsed;
        }
      } catch {
        // Try next branch.
      }
    }

    return null;
  }

  async checkNpmAdvisory(packageName, version) {
    const vulnerablePackages = {
      express: {
        "4.17.1": {
          severity: "high",
          cve: "CVE-2022-24999",
          title: "Open redirect vulnerability",
          cvssScore: 7.5
        },
        "4.16.0": {
          severity: "high",
          cve: "CVE-2022-24999",
          title: "Open redirect vulnerability",
          cvssScore: 7.5
        }
      },
      lodash: {
        "4.17.20": {
          severity: "high",
          cve: "CVE-2021-23337",
          title: "Prototype pollution",
          cvssScore: 7.2
        }
      },
      axios: {
        "0.20.0": {
          severity: "medium",
          cve: "CVE-2020-28168",
          title: "Server-side request forgery risk",
          cvssScore: 6.5
        }
      },
      moment: {
        "2.29.0": {
          severity: "medium",
          cve: "CVE-2022-31129",
          title: "Regular expression DoS",
          cvssScore: 5.9
        }
      },
      bcryptjs: {
        "2.4.3": {
          severity: "medium",
          cve: "CVE-2020-5902",
          title: "Timing side-channel issue",
          cvssScore: 5.3
        }
      }
    };

    const normalizedName = String(packageName || "").trim().toLowerCase();
    const normalizedVersion = normalizeSemver(version);
    const advisory = vulnerablePackages[normalizedName]?.[normalizedVersion];
    if (!advisory) {
      return null;
    }

    return {
      id: `${normalizedName}-${normalizedVersion}`,
      package: normalizedName,
      version: normalizedVersion,
      severity: advisory.severity,
      cve: advisory.cve,
      cvssScore: advisory.cvssScore,
      title: `${normalizedName}@${normalizedVersion} - ${advisory.title}`,
      description: `${normalizedName}@${normalizedVersion} is linked to ${advisory.cve} (${advisory.title}).`,
      remediation: `Update ${normalizedName} to a patched version and re-run dependency verification.`,
      type: "VULNERABLE_DEPENDENCY",
      source: "npm-advisory-map"
    };
  }

  async checkGitHubAdvisories(targetUrl) {
    const token = String(process.env.GITHUB_TOKEN || "").trim();
    if (!token) {
      return [];
    }

    const gitTarget = parseGitHubTarget(targetUrl);
    if (!gitTarget) {
      return [];
    }
    const { owner, repo } = gitTarget;

    try {
      const response = await this.httpClient.post(
        "https://api.github.com/graphql",
        {
          query: `query SecurityAlerts($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
              vulnerabilityAlerts(first: 20) {
                nodes {
                  securityVulnerability {
                    package {
                      name
                    }
                    vulnerableVersionRange
                    firstPatchedVersion {
                      identifier
                    }
                    advisory {
                      ghsaId
                      summary
                      description
                      severity
                    }
                  }
                }
              }
            }
          }`,
          variables: { owner, repo }
        },
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          timeout: 5000
        }
      );

      const alerts = response?.data?.data?.repository?.vulnerabilityAlerts?.nodes || [];
      return alerts
        .map((alert) => alert?.securityVulnerability)
        .filter(Boolean)
        .map((item) => ({
          id: item.advisory?.ghsaId || `${item.package?.name || "unknown"}-ghsa`,
          package: item.package?.name || "unknown",
          version: item.vulnerableVersionRange || "unknown",
          severity: String(item.advisory?.severity || "medium").toLowerCase(),
          cve: null,
          title: item.advisory?.summary || "GitHub security advisory",
          description:
            item.advisory?.description ||
            `GitHub flagged ${item.package?.name || "a dependency"} as vulnerable.`,
          remediation: item.firstPatchedVersion?.identifier
            ? `Upgrade to ${item.firstPatchedVersion.identifier} or newer.`
            : "Upgrade to the nearest patched version listed in GitHub advisories.",
          type: "VULNERABLE_DEPENDENCY",
          source: "github-advisories"
        }));
    } catch (error) {
      logger.warn(
        { error: error?.message || String(error) },
        "GitHub advisory query failed"
      );
      return [];
    }
  }

  async checkNVDDatabase(_dependencies = []) {
    // Reserved for future NVD API integration.
    return [];
  }

  toFinding(vulnerability, index) {
    return {
      id: `dep-${index}`,
      type: "VULNERABLE_DEPENDENCY",
      severity: vulnerability.severity || "medium",
      category: "Supply Chain",
      title: vulnerability.title || "Vulnerable dependency",
      description: vulnerability.description || "Known vulnerable dependency detected.",
      recommendation:
        vulnerability.remediation ||
        "Update the dependency to a patched version and retest.",
      remediation:
        vulnerability.remediation ||
        "Update the dependency to a patched version and retest.",
      source: vulnerability.source || "supply_chain",
      cve: vulnerability.cve || null,
      cvssScore: vulnerability.cvssScore || null,
      tags: ["supply-chain", String(vulnerability.package || "").toLowerCase()],
      metadata: {
        package: vulnerability.package || "",
        version: vulnerability.version || "",
        advisoryId: vulnerability.id
      }
    };
  }
}

module.exports = new SupplyChainService();
