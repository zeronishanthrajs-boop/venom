$secretRegex = "sk-ant-[A-Za-z0-9]|gho_[A-Za-z0-9]|AKIA[0-9A-Z]{16}|mongodb\+srv://[^<]|password\s*=\s*['""][^'""]+['""]"
Write-Host "Running with single quotes:"
git grep -n -i -E $secretRegex -- . ':(exclude)**/package-lock.json' ':(exclude)**/pnpm-lock.yaml' ':(exclude)**/*.md' ':(exclude)**/aiAppScannerService.js' ':(exclude)**/tests/**'
Write-Host "Exit Code is: $LASTEXITCODE"

Write-Host "Running with double quotes:"
git grep -n -i -E $secretRegex -- . ":(exclude)**/package-lock.json" ":(exclude)**/pnpm-lock.yaml" ":(exclude)**/*.md" ":(exclude)**/aiAppScannerService.js" ":(exclude)**/tests/**"
Write-Host "Exit Code is: $LASTEXITCODE"
