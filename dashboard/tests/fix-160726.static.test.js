const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboardRoot = path.resolve(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");
}

test("RecentPage keeps data loading stable for hook dependencies", () => {
  const source = readSource("src/app/dashboard/recent/page.tsx");

  assert.match(source, /useCallback/);
  assert.match(source, /const loadData = useCallback\(async \(\) => \{/);
  assert.match(source, /window\.setTimeout\(\(\) => \{\s*void loadData\(\);/);
  assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*loadData\(\);\s*\}, \[router\]\);/);
});

test("ErrorBanner exposes retry behavior for transient errors", () => {
  const source = readSource("src/components/ErrorBanner.tsx");

  assert.match(source, /errorType === "COLD_START"/);
  assert.match(source, /setInterval/);
  assert.match(source, /Retry Now/);
});

test("ReportPage uses explicit detailed report types", () => {
  const source = readSource("src/app/dashboard/report/[id]/page.tsx");

  assert.match(source, /type DetailedReportState =/);
  assert.match(source, /useState<DetailedReportState \| null>/);
  assert.doesNotMatch(source, /\bany\b/);
});
