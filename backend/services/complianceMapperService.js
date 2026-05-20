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
  "3.5": { requirement: "3.5", control: "Protect cryptographic keys and secrets" },
  "6.2.4": { requirement: "6.2.4", control: "Address known vulnerabilities promptly" },
  "6.3.3": { requirement: "6.3.3", control: "Secure coding and input validation" },
  "7.2": { requirement: "7.2", control: "Enforce least-privilege access controls" },
  "8.2": { requirement: "8.2", control: "Strong identification and authentication" }
};

const HIPAA_CONTROLS = {
  "164.308(a)(1)(ii)(A)": {
    reference: "§164.308(a)(1)(ii)(A)",
    safeguard: "Risk analysis"
  },
  "164.308(a)(1)(ii)(B)": {
    reference: "§164.308(a)(1)(ii)(B)",
    safeguard: "Risk management"
  },
  "164.312(a)(1)": {
    reference: "§164.312(a)(1)",
    safeguard: "Access control"
  },
  "164.312(c)(1)": {
    reference: "§164.312(c)(1)",
    safeguard: "Integrity safeguards"
  },
  "164.312(d)": {
    reference: "§164.312(d)",
    safeguard: "Person or entity authentication"
  },
  "164.312(e)(1)": {
    reference: "§164.312(e)(1)",
    safeguard: "Transmission security"
  }
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

class ComplianceMapperService {
  inferFindingType(finding = {}) {
    const explicit = String(finding?.type || finding?.metadata?.findingType || "")
      .trim()
      .toUpperCase();
    if (explicit) {
      return explicit;
    }
    const text = `${asString(finding.title)} ${asString(finding.category)} ${asString(
      finding.description
    )}`.toUpperCase();
    if (text.includes("BOLA") || text.includes("BROKEN OBJECT LEVEL")) {
      return "API_BROKEN_OBJECT_LEVEL_AUTHORIZATION";
    }
    if (text.includes("UNAUTHENTICATED") || text.includes("AUTHENTICATION")) {
      return "API_MISSING_AUTHENTICATION";
    }
    if (text.includes("RATE LIMIT")) {
      return "API_MISSING_RATE_LIMIT";
    }
    if (text.includes("SECRET") || text.includes("TOKEN") || text.includes("PASSWORD")) {
      return "SECRET_FOUND";
    }
    if (text.includes("SQL") || text.includes("INJECTION")) {
      return "SQL_INJECTION";
    }
    if (text.includes("VULNERABLE") || text.includes("CVE") || text.includes("DEPENDENCY")) {
      return "VULNERABLE_DEPENDENCY";
    }
    if (text.includes("MISCONFIG") || text.includes("HEADER") || text.includes("GRAPHQL")) {
      return "SECURITY_MISCONFIGURATION";
    }
    return "UNMAPPED";
  }

  resolveMappings(type, finding = {}) {
    const t = String(type || "").toUpperCase();
    const titleText = asString(finding?.title).toUpperCase();
    const descriptionText = asString(finding?.description).toUpperCase();
    const combined = `${titleText} ${descriptionText} ${t}`;

    const add = (state, { owasp = [], pci = [], hipaa = [], cis = [] }) => {
      owasp.forEach((item) => state.owasp.add(item));
      pci.forEach((item) => state.pci.add(item));
      hipaa.forEach((item) => state.hipaa.add(item));
      cis.forEach((item) => state.cis.add(item));
    };

    const state = {
      owasp: new Set(),
      pci: new Set(),
      hipaa: new Set(),
      cis: new Set()
    };

    if (t.includes("SQL") || t.includes("INJECTION")) {
      add(state, {
        owasp: ["A03"],
        pci: ["6.3.3"],
        hipaa: ["164.308(a)(1)(ii)(A)", "164.308(a)(1)(ii)(B)"],
        cis: ["CIS-4", "CIS-7"]
      });
    }

    if (
      t.includes("BOLA") ||
      t.includes("AUTHORIZATION") ||
      t.includes("AUTHENTICATION") ||
      combined.includes("UNAUTHENTICATED")
    ) {
      add(state, {
        owasp: ["A01", "A07"],
        pci: ["7.2", "8.2"],
        hipaa: ["164.312(a)(1)", "164.312(d)"],
        cis: ["CIS-5", "CIS-6"]
      });
    }

    if (
      t.includes("SECRET") ||
      t.includes("HARDCODED") ||
      combined.includes("PASSWORD") ||
      combined.includes("TOKEN")
    ) {
      add(state, {
        owasp: ["A02"],
        pci: ["3.5"],
        hipaa: ["164.312(c)(1)", "164.312(e)(1)"],
        cis: ["CIS-3"]
      });
    }

    if (t.includes("MISCONFIG") || t.includes("GRAPHQL") || combined.includes("HEADER")) {
      add(state, {
        owasp: ["A05"],
        pci: ["1.3"],
        hipaa: ["164.308(a)(1)(ii)(B)"],
        cis: ["CIS-4"]
      });
    }

    if (
      t.includes("VULNERABLE_DEPENDENCY") ||
      t.includes("VULNERABLE_BASE_IMAGE") ||
      combined.includes("BASE IMAGE") ||
      combined.includes("DEPENDENCY")
    ) {
      add(state, {
        owasp: ["A06"],
        pci: ["6.2.4"],
        hipaa: ["164.308(a)(1)(ii)(B)"],
        cis: ["CIS-2", "CIS-7"]
      });
    }

    if (t.includes("RATE_LIMIT")) {
      add(state, {
        owasp: ["A04"],
        pci: ["1.3"],
        hipaa: ["164.308(a)(1)(ii)(B)"],
        cis: ["CIS-4"]
      });
    }

    return {
      owasp: [...state.owasp].map((code) => OWASP[code]).filter(Boolean),
      pciDss: [...state.pci].map((code) => PCI_REQUIREMENTS[code]).filter(Boolean),
      hipaa: [...state.hipaa].map((code) => HIPAA_CONTROLS[code]).filter(Boolean),
      cisControls: CIS_CONTROLS.filter((control) => state.cis.has(control.id))
    };
  }

  mapFinding(finding = {}) {
    const type = this.inferFindingType(finding);
    const mapped = this.resolveMappings(type, finding);
    const hasMappings =
      mapped.owasp.length > 0 || mapped.pciDss.length > 0 || mapped.hipaa.length > 0;

    return {
      ...finding,
      compliance: hasMappings
        ? {
            owasp: mapped.owasp,
            pciDss: mapped.pciDss,
            hipaa: mapped.hipaa,
            cisControls: mapped.cisControls
          }
        : null
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

  generateComplianceReport(findings = []) {
    const mappedFindings = (Array.isArray(findings) ? findings : []).map((finding) =>
      this.mapFinding(finding)
    );

    const owaspGroups = {};
    const pciGroups = {};
    const hipaaGroups = {};
    const failedCisControls = new Set();

    for (const finding of mappedFindings) {
      if (!finding.compliance) {
        continue;
      }

      for (const owasp of finding.compliance.owasp || []) {
        if (!owaspGroups[owasp.code]) {
          owaspGroups[owasp.code] = {
            code: owasp.code,
            name: owasp.name,
            count: 0
          };
        }
        owaspGroups[owasp.code].count += 1;
      }

      for (const pci of finding.compliance.pciDss || []) {
        if (!pciGroups[pci.requirement]) {
          pciGroups[pci.requirement] = {
            requirement: pci.requirement,
            control: pci.control,
            findings: []
          };
        }
        pciGroups[pci.requirement].findings.push({
          title: finding.title || "Untitled finding",
          severity: String(finding.severity || "low").toUpperCase()
        });
      }

      for (const hipaa of finding.compliance.hipaa || []) {
        if (!hipaaGroups[hipaa.reference]) {
          hipaaGroups[hipaa.reference] = {
            reference: hipaa.reference,
            safeguard: hipaa.safeguard,
            findings: []
          };
        }
        hipaaGroups[hipaa.reference].findings.push({
          title: finding.title || "Untitled finding",
          severity: String(finding.severity || "low").toUpperCase()
        });
      }

      for (const cisControl of finding.compliance.cisControls || []) {
        failedCisControls.add(cisControl.id);
      }
    }

    const totalControls = CIS_CONTROLS.length;
    const failedCount = failedCisControls.size;
    const passedCount = Math.max(0, totalControls - failedCount);
    const scorePercent =
      totalControls === 0 ? 100 : Number(((passedCount / totalControls) * 100).toFixed(0));
    const overallRisk = this.computeOverallRisk(mappedFindings);
    const summary =
      mappedFindings.length === 0
        ? "No findings were detected; current compliance posture appears healthy."
        : `Detected ${mappedFindings.length} finding(s), with overall compliance risk rated ${overallRisk}.`;

    return {
      generatedAt: new Date().toISOString(),
      overallRisk,
      summary,
      totalFindings: mappedFindings.length,
      owasp: Object.values(owaspGroups).sort((a, b) => a.code.localeCompare(b.code)),
      pciDss: Object.values(pciGroups).sort((a, b) =>
        String(a.requirement).localeCompare(String(b.requirement))
      ),
      hipaa: Object.values(hipaaGroups).sort((a, b) => a.reference.localeCompare(b.reference)),
      cis: {
        totalControls,
        passedControls: passedCount,
        failedControls: failedCount,
        scorePercent,
        passingControlIds: CIS_CONTROLS.filter((item) => !failedCisControls.has(item.id)).map(
          (item) => item.id
        ),
        failingControlIds: [...failedCisControls]
      },
      mappedFindings
    };
  }
}

module.exports = new ComplianceMapperService();
