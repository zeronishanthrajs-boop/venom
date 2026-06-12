const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateSecurityScore,
  calculateFindingEps
} = require("../services/scoringEngine");

function finding(overrides = {}) {
  return {
    id: overrides.id || `finding-${Math.random()}`,
    type: overrides.type || "RATE_LIMIT_ABSENT",
    title: overrides.title || "Missing rate limiting",
    severity: overrides.severity || "high",
    confirmed: overrides.confirmed,
    metadata: {
      endpointStatus: "CONFIRMED_PRESENT",
      wafProtected: false,
      authProtected: false,
      ...(overrides.metadata || {})
    },
    ...overrides
  };
}

test("0 Critical and 4 High suspected findings score between 55 and 75", () => {
  const findings = Array.from({ length: 4 }, (_, index) =>
    finding({ id: `high-${index}`, severity: "high", confirmed: false })
  );

  const result = calculateSecurityScore(findings);

  assert.ok(result.finalScore >= 55);
  assert.ok(result.finalScore <= 75);
  assert.notEqual(result.finalScore, 0);
  assert.notEqual(result.finalScore, 100);
});

test("confirmed SQLi caps final score at 25", () => {
  const result = calculateSecurityScore([
    finding({
      type: "SQL_INJECTION",
      title: "Confirmed SQL injection",
      severity: "critical",
      confirmed: true
    }),
    finding({ severity: "low", confirmed: false })
  ], {
    positiveSignals: {
      allSecurityHeadersPresent: true,
      httpsHstsValid: true,
      strictCsp: true
    }
  });

  assert.ok(result.finalScore <= 25);
  assert.ok(result.floorsApplied.some((floor) => /SQLi/.test(floor.reason)));
});

test("zero findings plus all positive signals scores at least 90", () => {
  const result = calculateSecurityScore([], {
    positiveSignals: {
      allSecurityHeadersPresent: true,
      httpsHstsValid: true,
      wafActiveOnAuthEndpoints: true,
      rateLimitingOnAuthEndpoints: true,
      strictCsp: true,
      sriOnExternalScripts: true
    }
  });

  assert.ok(result.finalScore >= 90);
});

test("EPS for unvalidated suspected finding never exceeds 45", () => {
  const eps = calculateFindingEps(
    finding({
      confirmed: false,
      cve: "CVE-2024-0001",
      metadata: {
        endpointStatus: "CONFIRMED_PRESENT",
        wafProtected: false,
        authProtected: false,
        rateLimitingAbsent: true
      }
    })
  );

  assert.equal(eps.score, 45);
  assert.equal(eps.capped, true);
});

test("calculationAudit is human-readable and arithmetically accurate", () => {
  const result = calculateSecurityScore([
    finding({ severity: "high", confirmed: false }),
    finding({ severity: "medium", confirmed: false })
  ], {
    positiveSignals: {
      httpsHstsValid: true
    }
  });

  const expected = Math.round(
    Math.max(0, Math.min(100, result.baseScore + result.totalDeductions + result.totalBonuses))
  );

  assert.equal(result.finalScore, expected);
  assert.match(result.calculationAudit, /Base 100 - 10 \(deductions\) \+ 3 \(bonuses\) = 93/);
  assert.match(result.calculationAudit, /No floors triggered/);
});
