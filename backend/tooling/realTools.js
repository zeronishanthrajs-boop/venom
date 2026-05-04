const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { URL } = require("node:url");

const execFileAsync = promisify(execFile);
const DOCKER_ENABLED = process.env.ENABLE_DOCKER_TOOLS === "true";

const REAL_TOOL_REGISTRY = {
  nmap_tcp_scan: {
    id: "nmap_tcp_scan",
    name: "Nmap TCP Scan",
    description: "Service/version detection for exposed TCP ports.",
    category: "network",
    mode: "docker-real",
    destructive: false,
    timeoutSeconds: 300,
    estimatedCostUsd: 0.05,
    image: "instrumentisto/nmap:latest",
    buildArgs: (targetUrl) => {
      const hostname = new URL(targetUrl).hostname;
      return ["-sV", "-sC", "--open", hostname];
    }
  },
  nuclei_scan: {
    id: "nuclei_scan",
    name: "Nuclei Vulnerability Scan",
    description:
      "Template-driven detection scan with medium/high/critical severities.",
    category: "web",
    mode: "docker-real",
    destructive: false,
    timeoutSeconds: 600,
    estimatedCostUsd: 0.12,
    image: "projectdiscovery/nuclei:latest",
    buildArgs: (targetUrl) => [
      "-u",
      targetUrl,
      "-severity",
      "medium,high,critical",
      "-jsonl",
      "-silent",
      "-no-interactsh",
      "-stats=false"
    ]
  },
  nikto_scan: {
    id: "nikto_scan",
    name: "Nikto Web Misconfiguration Scan",
    description: "Read-only web misconfiguration detection scan.",
    category: "web",
    mode: "docker-real",
    destructive: false,
    timeoutSeconds: 300,
    estimatedCostUsd: 0.08,
    image: "securecodebox/scanner-nikto:latest",
    buildArgs: (targetUrl) => [
      "nikto",
      "-h",
      targetUrl,
      "-Format",
      "json"
    ]
  },
  sqlmap_detect: {
    id: "sqlmap_detect",
    name: "SQLMap Detection (Safe Mode)",
    description: "SQL injection detection-only mode, no exploitation flags.",
    category: "web",
    mode: "docker-real",
    destructive: false,
    timeoutSeconds: 300,
    estimatedCostUsd: 0.15,
    image: "secsi/sqlmap:latest",
    buildArgs: (targetUrl) => [
      "-u",
      targetUrl,
      "--batch",
      "--forms",
      "--crawl=1",
      "--level=1",
      "--risk=1",
      "--technique=BEUSTQ",
      "--smart"
    ]
  }
};

function severityFromPort(port) {
  if ([21, 23, 3389].includes(port)) {
    return "high";
  }
  if ([22, 25, 445].includes(port)) {
    return "medium";
  }
  return "low";
}

function parseNmapOutput(stdout = "") {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const ports = [];
  const findings = [];
  const pattern = /^(\d+)\/tcp\s+open\s+([a-zA-Z0-9\-_\.]+)\s*(.*)$/;

  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) {
      continue;
    }
    const port = Number.parseInt(match[1], 10);
    const service = match[2];
    const version = match[3] || "";
    ports.push({
      protocol: "tcp",
      port,
      service,
      version
    });
    findings.push({
      id: `nmap-open-port-${port}`,
      severity: severityFromPort(port),
      category: "network-exposure",
      title: `Open ${service} port (${port})`,
      description: `TCP ${port} is open (${service}${version ? ` ${version}` : ""}).`,
      recommendation:
        "Confirm exposure is expected, restrict external access where unnecessary, and enforce hardened service configuration.",
      source: "nmap_tcp_scan",
      metadata: {
        port,
        service,
        version
      }
    });
  }

  return {
    ports,
    findings,
    technologyFingerprint: ports.map((item) => item.service).join(", ")
  };
}

function parseNucleiOutput(stdout = "") {
  const findings = [];
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      const severity = String(item?.info?.severity || "medium").toLowerCase();
      findings.push({
        id: `nuclei-${item["template-id"] || findings.length + 1}`,
        severity: ["critical", "high", "medium", "low"].includes(severity)
          ? severity
          : "medium",
        category: "vulnerability-detection",
        title: item?.info?.name || item?.["template-id"] || "Nuclei finding",
        description: item?.info?.description || item?.matched || "Potential issue detected by nuclei template.",
        recommendation:
          "Validate finding context and patch or harden affected component.",
        cve:
          item?.info?.classification?.cve_id ||
          item?.info?.classification?.cve ||
          null,
        source: "nuclei_scan",
        metadata: {
          templateId: item?.["template-id"] || "",
          matchedAt: item?.matched || "",
          tags: item?.info?.tags || [],
          cvssScore:
            typeof item?.info?.classification?.["cvss-score"] === "number"
              ? item.info.classification["cvss-score"]
              : null
        }
      });
    } catch {
      // Ignore malformed line.
    }
  }
  return { findings };
}

function parseNiktoOutput(stdout = "") {
  const findings = [];
  try {
    const parsed = JSON.parse(stdout);
    const candidates = Array.isArray(parsed?.vulnerabilities)
      ? parsed.vulnerabilities
      : Array.isArray(parsed?.findings)
      ? parsed.findings
      : [];

    for (const candidate of candidates) {
      findings.push({
        id: `nikto-${candidate?.id || findings.length + 1}`,
        severity: "medium",
        category: "web-misconfiguration",
        title: candidate?.msg || candidate?.id || "Nikto finding",
        description: candidate?.msg || "Potential web misconfiguration detected.",
        recommendation:
          "Review server hardening recommendations and remediate exposed behavior.",
        source: "nikto_scan",
        metadata: {
          uri: candidate?.uri || candidate?.url || "",
          osvdb: candidate?.osvdb || null
        }
      });
    }
  } catch {
    if (/OSVDB|Nikto|potentially/i.test(stdout)) {
      findings.push({
        id: "nikto-text-output-finding",
        severity: "medium",
        category: "web-misconfiguration",
        title: "Nikto reported potential issues",
        description: stdout.slice(0, 1000),
        recommendation:
          "Review raw Nikto output and validate each candidate issue before remediation.",
        source: "nikto_scan",
        metadata: {}
      });
    }
  }
  return {
    findings,
    rawPreview: stdout.slice(0, 2000)
  };
}

function parseSqlmapOutput(stdout = "") {
  const vulnerable =
    /is vulnerable|sql injection|parameter:.+injectable/i.test(stdout);
  const findings = vulnerable
    ? [
        {
          id: "sqlmap-detect-sqli",
          severity: "high",
          category: "injection-detection",
          title: "Potential SQL Injection Signal",
          description:
            "SQLMap detection mode reported injectable parameter indicators.",
          recommendation:
            "Validate manually with safe proof, patch parameterization issues, and deploy WAF/logging controls.",
          exploitationPotential:
            "If confirmed, attacker could query or tamper with backend data depending on DB privileges.",
          source: "sqlmap_detect",
          metadata: {}
        }
      ]
    : [];

  return {
    findings,
    isVulnerable: vulnerable,
    rawPreview: stdout.slice(0, 2000)
  };
}

function parseRealToolOutput(toolId, stdout, stderr) {
  if (toolId === "nmap_tcp_scan") {
    return parseNmapOutput(stdout);
  }
  if (toolId === "nuclei_scan") {
    return parseNucleiOutput(stdout);
  }
  if (toolId === "nikto_scan") {
    return parseNiktoOutput(stdout);
  }
  if (toolId === "sqlmap_detect") {
    return parseSqlmapOutput(stdout);
  }
  return {
    findings: [],
    rawPreview: stdout.slice(0, 2000),
    stderrPreview: stderr.slice(0, 2000)
  };
}

async function executeRealTool(toolId, targetUrl, timeoutSeconds) {
  const tool = REAL_TOOL_REGISTRY[toolId];
  if (!tool) {
    const error = new Error(`Unknown real tool: ${toolId}`);
    error.code = "UNKNOWN_REAL_TOOL";
    throw error;
  }

  if (!DOCKER_ENABLED) {
    const error = new Error(
      "Docker tool execution disabled. Set ENABLE_DOCKER_TOOLS=true to allow."
    );
    error.code = "DOCKER_DISABLED";
    throw error;
  }

  const commandArgs = tool.buildArgs(targetUrl);
  const dockerArgs = ["run", "--rm", tool.image, ...commandArgs];

  const { stdout = "", stderr = "" } = await execFileAsync("docker", dockerArgs, {
    timeout: Math.max(1, timeoutSeconds || tool.timeoutSeconds) * 1000,
    maxBuffer: 1024 * 1024 * 4
  });

  const parsed = parseRealToolOutput(toolId, stdout, stderr);
  return {
    ...parsed,
    rawOutput: stdout.slice(0, 50000),
    stderrOutput: stderr.slice(0, 10000)
  };
}

module.exports = {
  REAL_TOOL_REGISTRY,
  executeRealTool,
  __internal: {
    parseNmapOutput,
    parseNucleiOutput,
    parseNiktoOutput,
    parseSqlmapOutput
  }
};
