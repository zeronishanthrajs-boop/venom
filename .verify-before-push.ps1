$ErrorActionPreference = "Stop"

function Fail($message) {
  Write-Host "❌ $message"
  exit 1
}

function Pass($message) {
  Write-Host "✅ $message"
}

Write-Host "Checking pre-push requirements..."

# Check 1: .env must not be tracked
$tracked = git ls-files | Select-String -Pattern '^backend/\.env$' -Quiet
if ($tracked) {
  Fail "backend/.env is tracked in git. Remove with: git rm --cached backend/.env"
}
Pass ".env not tracked"

# Check 2: root .gitignore exists
if (-not (Test-Path ".gitignore")) {
  Fail ".gitignore missing at repository root"
}
Pass ".gitignore exists"

# Check 3: required env template files
if (-not (Test-Path "backend/.env.example")) { Fail "backend/.env.example missing" }
if (-not (Test-Path "dashboard/.env.example")) { Fail "dashboard/.env.example missing" }
Pass ".env.example files present"

# Check 4: obvious secret patterns in tracked files
$secretRegex = "sk-ant-[A-Za-z0-9]|gho_[A-Za-z0-9]|AKIA[0-9A-Z]{16}|mongodb\+srv://[^<]|password\s*=\s*['""][^'""]+['""]"
$secretMatches = git grep -n -i -E $secretRegex -- . ':(exclude)**/package-lock.json' ':(exclude)**/pnpm-lock.yaml' ':(exclude)**/*.md'
if ($LASTEXITCODE -eq 0 -and $secretMatches) {
  $secretMatches | ForEach-Object { Write-Host $_ }
  Fail "potential hardcoded secrets found in tracked files"
}
Pass "no obvious hardcoded secrets in tracked source files"

# Check 5: backend health if running
try {
  $code = & curl.exe -s -o NUL -w "%{http_code}" "http://localhost:5000/health"
  if ($code -eq "200") {
    Pass "backend health endpoint reachable (200)"
  } else {
    Write-Host "⚠️ backend health not reachable now ($code); start backend to verify runtime"
  }
} catch {
  Write-Host "⚠️ backend health check skipped (curl unavailable)"
}

# Check 6: clean working tree
$status = git status --porcelain
if ($status) {
  Write-Host "⚠️ Working tree has uncommitted changes:"
  git status --short
} else {
  Pass "working tree clean"
}

Write-Host ""
Write-Host "✅ Pre-push verification finished."
Write-Host 'Next: git add . && git commit -m "..." && git push -u origin main'
