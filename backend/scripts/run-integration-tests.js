const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function collectTestFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(absolutePath);
    }
  }

  return files;
}

const integrationDir = path.join(__dirname, "..", "tests", "integration");
if (!fs.existsSync(integrationDir)) {
  console.log("No integration tests directory found. Skipping integration suite.");
  process.exit(0);
}

const testFiles = collectTestFiles(integrationDir).sort();
if (testFiles.length === 0) {
  console.log("No integration test files found. Skipping integration suite.");
  process.exit(0);
}

const run = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit"
});

if (typeof run.status === "number") {
  process.exit(run.status);
}

if (run.error) {
  console.error(run.error.message || "Integration test execution failed.");
}
process.exit(1);
