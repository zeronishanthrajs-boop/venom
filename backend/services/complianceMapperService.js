const CIS_CONTROLS = [
  { id: "CIS-1", name: "Inventory and Control of Enterprise Assets" },
  { id: "CIS-2", name: "Inventory and Control of Software Assets" },
  { id: "CIS-3", name: "Data Protection" },
  { id: "CIS-4", name: "Secure Configuration of Enterprise Assets and Software" },
  { id: "CIS-5", name: "Account Management" },
  { id: "CIS-6", name: "Access Control Management" },
  { id: "CIS-7", name: "Continuous Vulnerability Management" }
];

const OWASP = {
  A01: { code: "A01:2021", name: "Broken Access Control" },
  A02: { code: "A02:2021", name: "Cryptographic Failures" },
  A03: { code: "A03:2021", name: "Injection" },
  A04: { code: "A04:2021", name: "Insecure Design" },
  A05: { code: "A05:2021", name: "Security Misconfiguration" },
  A06: { code: "A06:2021", name: "Vulnerable and Outdated Components" },
  A07: { code: "A07:2021", name: "Identification and Authentication Failures" }
};

const PCI_REQUIREMENTS = {
  "1.3": { requirement: "1.3", control: "Restrict unauthorized network access" },
  "3.5": { requirement: "3.5", control: "Protect stored data, keys, and secrets" },
  "6.2.4": { requirement: "6.2.4", control: "Address known vulnerabilities promptly" },
  "6.3.3": { requirement: "6.3.3", control: "Prevent injection in custom code" },
  "7.2": { requirement: "7.2", control: "Enforce least-privilege access control" },
  "8.2": { requirement: "8.2", control: "Strong user identification and authentication" }
};

const HIPAA_CONTROLS = {
  "164.312(a)(1)": {
    reference: "164.312(a)(1)",
    safeguard: "Access control"
  },
  "164.312(c)(1)": {
    reference: "164.312(c)(1)",
    safeguard: "Integrity"
  },
  "164.312(d)": {
    reference: "164.312(d)",
    safeguard: "Person or entity authentication"
  },
  "164.312(e)(1)": {
    reference: "164.312(e)(1)",
    safeguard: "Transmission security"
  }
};

const STANDARD_PROBES = {
  pciDss: [
    "http_headers_probe",
    "tls_metadata_probe",
    "api_security_scan",
    "nmap_tcp_scan",
    "secrets_scan",
    "supply_chain_scan"
  ],
  hipaa: [
    "http_headers_probe",
    "tls_metadata_probe",
    "api_security_scan",
    "secrets_scan"
  ],
  cis: [
    "http_headers_probe",
    "dns_lookup_probe",
    "tls_metadata_probe",
    "api_security_scan",
    "container_security_scan",
    "supply_chain_scan",
    "secrets_scan"
  ]
};

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

function normalizeSeverity(value) {
  const normalized = String(value || "low").trim().toLowerCase();
  if (["critical", "high", "medium", "low", "info"].includes(normalized)) {
    return normalized;
  }
  return "low";
}

function normalizeType(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function includesAny(value, checks = []) {
  return checks.some((entry) => value.includes(entry));
}

function normalizeJobStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function getProbeReason(job = {}) {
  const status = normalizeJobStatus(job.status).toUpperCase() || "MISSING";
  return (
    job.output?.failureReason ||
    job.errorMessage ||
    job.output?.reason ||
    `${status}: Probe did not complete successfully.`
  );
}

function assessProbeCoverage({ jobs = [], requiredTools = [], violations = [] }) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return {
      status: "INSUFFICIENT_DATA",
      explanation:
        "Relevant probes did not run, so compliance cannot be determined.",
      requiredProbes: requiredTools,
      incompleteProbes: requiredTools.map((toolId) => ({
        toolId,
        status: "MISSING",
        reason: "MISSING: Probe did not run."
      }))
    };
  }

  const incompleteProbes = [];
  const successfulTools = new Set();
  for (const toolId of requiredTools) {
    const matchingJobs = jobs.filter((job) => String(job.toolId || "") === toolId);
    const successful = matchingJobs.some((job) => normalizeJobStatus(job.status) === "success");
    if (successful) {
      successfulTools.add(toolId);
      continue;
    }
    const latest = matchingJobs[0] || null;
    incompleteProbes.push({
      toolId,
      status: latest ? normalizeJobStatus(latest.status).toUpperCase() : "MISSING",
      reason: latest ? getProbeReason(latest) : "MISSING: Probe did not run."
    });
  }

  if (violations.length > 0) {
    return {
      status: "FAILED",
      explanation: `${violations.length} mapped violation(s) were found.`,
      requiredProbes: requiredTools,
      incompleteProbes,
      successfulProbes: [...successfulTools]
    };
  }

  if (incompleteProbes.length > 0) {
    return {
      status: "INSUFFICIENT_DATA",
      explanation:
        "Relevant probes did not run, failed, were blocked, timed out, or were not applicable, so compliance cannot be determined.",
      requiredProbes: requiredTools,
      incompleteProbes,
      successfulProbes: [...successfulTools]
    };
  }

  return {
    status: "PASSED",
    explanation:
      "Relevant probes ran successfully and no mapped violations were found.",
    requiredProbes: requiredTools,
    incompleteProbes: [],
    successfulProbes: [...successfulTools]
  };
}

class ComplianceMapperService {
  inferFindingType(finding = {}) {
    const explicit = normalizeType(finding?.type || finding?.metadata?.findingType || "");
    if (explicit) {
      return explicit;
    }

    const title = normalizeType(asString(finding?.title));
    const description = normalizeType(asString(finding?.description));
    const combined = `${title} ${description}`;

    if (includesAny(combined, ["BOLA", "BROKEN_OBJECT_LEVEL_AUTHORIZATION"])) {
      return "API_BROKEN_OBJECT_LEVEL_AUTHORIZATION";
    }
    if (includesAny(combined, ["UNAUTHENTICATED", "MISSING_AUTHENTICATION"])) {
      return "API_MISSING_AUTHENTICATION";
    }
    if (includesAny(combined, ["RATE_LIMIT", "THROTTL"])) {
      return "API_MISSING_RATE_LIMIT";
    }
    if (includesAny(combined, ["SQL_INJECTION", "SSTI", "XSS", "INJECTION"])) {
      return "SQL_INJECTION";
    }
    if (includesAny(combined, ["SECRET", "HARDCODED_CREDENTIAL", "TOKEN", "PASSWORD"])) {
      return "SECRET_FOUND";
    }
    if (includesAny(combined, ["DEPENDENCY", "VULNERABLE_BASE_IMAGE", "CVE"])) {
      return "VULNERABLE_DEPENDENCY";
    }
    if (includesAny(combined, ["MISCONFIG", "GRAPHQL_INTROSPECTION", "HEADER"])) {
      return "SECURITY_MISCONFIGURATION";
    }
    return "UNMAPPED";
  }

  resolveMappings(type = "") {
    const normalizedType = normalizeType(type);

    const mapping = {
      owasp: [],
      pciDss: [],
      hipaa: [],
      cisControls: []
    };

    if (includesAny(normalizedType, ["SQL_INJECTION", "API_INPUT_VALIDATION_MISSING", "SSTI", "XSS"])) {
      mapping.owasp.push(OWASP.A03);
      mapping.pciDss.push(PCI_REQUIREMENTS["6.3.3"]);
      mapping.hipaa.push(HIPAA_CONTROLS["164.312(c)(1)"]);
      mapping.cisControls.push("CIS-4", "CIS-7");
    }

    if (includesAny(normalizedType, ["API_BROKEN_OBJECT_LEVEL_AUTHORIZATION", "ACCESS_CONTROL"])) {
      mapping.owasp.push(OWASP.A01);
      mapping.pciDss.push(PCI_REQUIREMENTS["7.2"]);
      mapping.hipaa.push(HIPAA_CONTROLS["164.312(a)(1)"]);
      mapping.cisControls.push("CIS-6", "CIS-5");
    }

    if (includesAny(normalizedType, ["API_MISSING_AUTHENTICATION", "AUTHENTICATION_FAILURE"])) {
      mapping.owasp.push(OWASP.A07);
      mapping.pciDss.push(PCI_REQUIREMENTS["8.2"]);
      mapping.hipaa.push(HIPAA_CONTROLS["164.312(d)"]);
      mapping.cisControls.push("CIS-5");
    }

    if (includesAny(normalizedType, ["SECRET_FOUND", "HARDCODED", "EXPOSED_SECRET"])) {
      mapping.owasp.push(OWASP.A02);
      mapping.pciDss.push(PCI_REQUIREMENTS["3.5"]);
      mapping.hipaa.push(HIPAA_CONTROLS["164.312(c)(1)"], HIPAA_CONTROLS["164.312(e)(1)"]);
      mapping.cisControls.push("CIS-3");
    }

    if (includesAny(normalizedType, ["MISCONFIG", "GRAPHQL_INTROSPECTION", "HEADER"])) {
      mapping.owasp.push(OWASP.A05);
      mapping.pciDss.push(PCI_REQUIREMENTS["1.3"]);
      mapping.hipaa.push(HIPAA_CONTROLS["164.312(a)(1)"]);
      mapping.cisControls.push("CIS-4");
    }

    if (includesAny(normalizedType, ["VULNERABLE_DEPENDENCY", "VULNERABLE_BASE_IMAGE", "OUTDATED_COMPONENT"])) {
      mapping.owasp.push(OWASP.A06);
      mapping.pciDss.push(PCI_REQUIREMENTS["6.2.4"]);
      mapping.hipaa.push(HIPAA_CONTROLS["164.312(c)(1)"]);
      mapping.cisControls.push("CIS-2", "CIS-7");
    }

    if (includesAny(normalizedType, ["API_MISSING_RATE_LIMIT", "RATE_LIMIT"])) {
      mapping.owasp.push(OWASP.A04);
      mapping.pciDss.push(PCI_REQUIREMENTS["1.3"]);
      mapping.hipaa.push(HIPAA_CONTROLS["164.312(a)(1)"]);
      mapping.cisControls.push("CIS-4");
    }

    const uniqueByKey = (items, key) => {
      const seen = new Set();
      const unique = [];
      for (const item of items) {
        if (!item || seen.has(item[key])) {
          continue;
        }
        unique.push(item);
        seen.add(item[key]);
      }
      return unique;
    };

    return {
      owasp: uniqueByKey(mapping.owasp, "code"),
      pciDss: uniqueByKey(mapping.pciDss, "requirement"),
      hipaa: uniqueByKey(mapping.hipaa, "reference"),
      cisControls: CIS_CONTROLS.filter((control) => mapping.cisControls.includes(control.id))
    };
  }

  mapFinding(finding = {}) {
    const findingType = this.inferFindingType(finding);
    const mapped = this.resolveMappings(findingType);

    return {
      ...finding,
      type: findingType,
      compliance: {
        owasp: mapped.owasp.length > 0 ? mapped.owasp : null,
        pciDss: mapped.pciDss.length > 0 ? mapped.pciDss : null,
        hipaa: mapped.hipaa.length > 0 ? mapped.hipaa : null,
        cisControls: mapped.cisControls.length > 0 ? mapped.cisControls : null
      }
    };
  }

  computeOverallRisk(findings = []) {
    const severities = findings.map((finding) => normalizeSeverity(finding?.severity));
    if (severities.includes("critical")) {
      return "CRITICAL";
    }
    if (severities.includes("high")) {
      return "HIGH";
    }
    if (severities.includes("medium")) {
      return "MEDIUM";
    }
    return "LOW";
  }

  generateComplianceReport(findings = [], context = {}) {
    const mappedFindings = (Array.isArray(findings) ? findings : []).map((finding) =>
      this.mapFinding(finding)
    );
    const jobs = Array.isArray(context.jobs) ? context.jobs : [];

    const owaspGroups = {};
    const pciGroups = {};
    const hipaaGroups = {};
    const failedControls = new Set();

    for (const finding of mappedFindings) {
      const compliance = finding.compliance || {};
      const owaspMappings = Array.isArray(compliance.owasp) ? compliance.owasp : [];
      const pciMappings = Array.isArray(compliance.pciDss) ? compliance.pciDss : [];
      const hipaaMappings = Array.isArray(compliance.hipaa) ? compliance.hipaa : [];
      const cisMappings = Array.isArray(compliance.cisControls) ? compliance.cisControls : [];

      for (const owasp of owaspMappings) {
        if (!owaspGroups[owasp.code]) {
          owaspGroups[owasp.code] = {
            code: owasp.code,
            name: owasp.name,
            count: 0
          };
        }
        owaspGroups[owasp.code].count += 1;
      }

      for (const pci of pciMappings) {
        if (!pciGroups[pci.requirement]) {
          pciGroups[pci.requirement] = {
            requirement: pci.requirement,
            control: pci.control,
            affectedFindings: []
          };
        }
        pciGroups[pci.requirement].affectedFindings.push(finding.title || "Untitled finding");
      }

      for (const hipaa of hipaaMappings) {
        if (!hipaaGroups[hipaa.reference]) {
          hipaaGroups[hipaa.reference] = {
            reference: hipaa.reference,
            safeguard: hipaa.safeguard,
            affectedFindings: []
          };
        }
        hipaaGroups[hipaa.reference].affectedFindings.push(
          finding.title || "Untitled finding"
        );
      }

      for (const cis of cisMappings) {
        failedControls.add(cis.id);
      }
    }

    const totalControls = CIS_CONTROLS.length;
    const failedControlsCount = failedControls.size;
    const passedControls = Math.max(0, totalControls - failedControlsCount);
    const pciAssessment = assessProbeCoverage({
      jobs,
      requiredTools: STANDARD_PROBES.pciDss,
      violations: Object.values(pciGroups)
    });
    const hipaaAssessment = assessProbeCoverage({
      jobs,
      requiredTools: STANDARD_PROBES.hipaa,
      violations: Object.values(hipaaGroups)
    });
    const cisCoverage = assessProbeCoverage({
      jobs,
      requiredTools: STANDARD_PROBES.cis,
      violations: CIS_CONTROLS.filter((item) => failedControls.has(item.id))
    });
    const cisInsufficient = cisCoverage.status === "INSUFFICIENT_DATA";
    const scorePercent = cisInsufficient
      ? null
      : totalControls === 0
        ? 100
        : Number(((passedControls / totalControls) * 100).toFixed(0));
    const overallRisk = this.computeOverallRisk(mappedFindings);
    const summary =
      mappedFindings.length === 0 && !cisInsufficient
        ? "Compliance posture is currently healthy with no mapped security findings."
        : mappedFindings.length === 0
          ? "Compliance posture cannot be determined because relevant probes did not complete."
        : `Compliance posture indicates ${overallRisk} risk with ${mappedFindings.length} mapped finding(s) requiring remediation.`;

    return {
      generatedAt: new Date().toISOString(),
      totalFindings: mappedFindings.length,
      overallRisk,
      summary,
      owasp: Object.values(owaspGroups).sort((a, b) => a.code.localeCompare(b.code)),
      pciDss: Object.values(pciGroups).sort((a, b) =>
        String(a.requirement).localeCompare(String(b.requirement))
      ),
      pciDssAssessment: pciAssessment,
      hipaa: Object.values(hipaaGroups).sort((a, b) => a.reference.localeCompare(b.reference)),
      hipaaAssessment,
      cis: {
        status: cisCoverage.status,
        explanation: cisCoverage.explanation,
        totalControls,
        passedControls: cisInsufficient ? null : passedControls,
        failedControls: failedControlsCount,
        scorePercent,
        incompleteProbes: cisCoverage.incompleteProbes,
        passingControls: CIS_CONTROLS.filter((item) => !failedControls.has(item.id)),
        failingControls: CIS_CONTROLS.filter((item) => failedControls.has(item.id))
      },
      mappedFindings
    };
  }
}

module.exports = new ComplianceMapperService();
