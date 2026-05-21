#!/usr/bin/env bash
set -euo pipefail

echo "Checking pre-push requirements..."

fail() {
  echo "❌ $1"
  exit 1
}

pass() {
  echo "✅ $1"
}

# Check 1: .env must not be tracked
if git ls-files | grep -q "^backend/\.env$"; then
  fail "backend/.env is tracked in git. Remove with: git rm --cached backend/.env"
fi
pass ".env not tracked"

# Check 2: root .gitignore exists
if [[ ! -f .gitignore ]]; then
  fail ".gitignore missing at repository root"
fi
pass ".gitignore exists"

# Check 3: required env template files
[[ -f backend/.env.example ]] || fail "backend/.env.example missing"
[[ -f dashboard/.env.example ]] || fail "dashboard/.env.example missing"
pass ".env.example files present"

# Check 4: obvious secret patterns in tracked files
# Ignore lockfiles and documentation where placeholders are expected.
SECRET_MATCHES="$(git grep -n -i -E \
  'sk-ant-[A-Za-z0-9]|gho_[A-Za-z0-9]|AKIA[0-9A-Z]{16}|mongodb\+srv://[^<]|password[[:space:]]*=[[:space:]]*["'\''][^"'\'']+["'\'']' \
  -- . ':(exclude)**/package-lock.json' ':(exclude)**/pnpm-lock.yaml' ':(exclude)**/*.md' ':(exclude)**/aiAppScannerService.js' ':(exclude)**/tests/**' || true)"

if [[ -n "${SECRET_MATCHES}" ]]; then
  echo "${SECRET_MATCHES}"
  fail "potential hardcoded secrets found in tracked files"
fi
pass "no obvious hardcoded secrets in tracked source files"

# Check 5: backend health if server is running
if command -v curl >/dev/null 2>&1; then
  HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/health || true)"
  if [[ "${HTTP_CODE}" == "200" ]]; then
    pass "backend health endpoint reachable (200)"
  else
    echo "⚠️ backend health not reachable now (${HTTP_CODE:-n/a}); start backend to verify runtime"
  fi
fi

# Check 6: clean working tree
if [[ -n "$(git status --porcelain)" ]]; then
  echo "⚠️ Working tree has uncommitted changes:"
  git status --short
else
  pass "working tree clean"
fi

echo
echo "✅ Pre-push verification finished."
echo "Next: git add . && git commit -m \"...\" && git push -u origin main"
