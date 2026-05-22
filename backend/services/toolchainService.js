const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { logger } = require("../config/logger");

const execFileAsync = promisify(execFile);

const REQUIRED_TOOLS = [
  "nikto",
  "whatweb",
  "ffuf",
  "amass",
  "sqlmap",
  "wafw00f",
  "semgrep",
  "trufflehog",
  "nuclei",
  "httpx",
  "katana",
  "naabu",
  "subfinder",
  "dalfox"
];

async function commandExists(commandName) {
  const isWindows = process.platform === "win32";
  const lookupCommand = isWindows ? "where" : "which";
  try {
    await execFileAsync(lookupCommand, [commandName], {
      timeout: 5000,
      maxBuffer: 1024 * 256
    });
    return true;
  } catch {
    return false;
  }
}

async function verifyToolchainAtStartup() {
  const checks = [];
  for (const toolName of REQUIRED_TOOLS) {
    // eslint-disable-next-line no-await-in-loop
    const installed = await commandExists(toolName);
    checks.push({
      tool: toolName,
      installed
    });
    logger.info(
      {
        component: "toolchain-startup-check",
        tool: toolName,
        status: installed ? "INSTALLED" : "MISSING"
      },
      `[STARTUP] ${toolName} ${installed ? "INSTALLED" : "MISSING"}`
    );
  }

  const missingTools = checks.filter((item) => !item.installed).map((item) => item.tool);
  return {
    checkedAt: new Date().toISOString(),
    totalRequired: REQUIRED_TOOLS.length,
    missingTools,
    status: missingTools.length > 0 ? "INCOMPLETE" : "COMPLETE",
    checks
  };
}

module.exports = {
  REQUIRED_TOOLS,
  verifyToolchainAtStartup
};

