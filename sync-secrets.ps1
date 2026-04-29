[CmdletBinding()]
param(
    [string]$ProjectName = "tw-bot"
)

Write-Host "Syncing secrets from .env to Cloudflare Pages project: $ProjectName" -ForegroundColor Cyan

if (-not (Test-Path .env)) {
    Write-Host "ERROR: .env file not found!" -ForegroundColor Red
    exit 1
}

$envContent = Get-Content .env
$synced = 0
$failed = 0

foreach ($line in $envContent) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) {
        continue
    }
    
    $eqIdx = $trimmed.IndexOf("=")
    if ($eqIdx -le 0) {
        continue
    }
    
    $key = $trimmed.Substring(0, $eqIdx).Trim()
    $val = $trimmed.Substring($eqIdx + 1).Trim()
    
    if ($key -eq "" -or $val -eq "") {
        Write-Host "Skipping empty key/value: $key" -ForegroundColor DarkGray
        continue
    }
    
    Write-Host "Syncing $key..." -ForegroundColor Yellow
    try {
        $val | npx wrangler pages secret put $key --project-name $ProjectName
        if ($?) {
            Write-Host "  OK: $key synced." -ForegroundColor Green
            $synced++
        } else {
            Write-Host "  FAILED: $key" -ForegroundColor Red
            $failed++
        }
    } catch {
        Write-Host "  ERROR: $key - $_" -ForegroundColor Red
        $failed++
    }
}

Write-Host "`nDone. Synced: $synced, Failed: $failed" -ForegroundColor Cyan