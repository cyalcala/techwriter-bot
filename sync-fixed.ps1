$envContent = Get-Content .env
foreach ($line in $envContent) {
    if ($line -match "^([^=]+)=(.*)$") {
        $key = $matches[1].Trim()
        $val = $matches[2].Trim()
        if ($val -ne "") {
            Write-Host "Syncing $key to tw-bot-fixed..."
            echo $val | npx wrangler pages secret put $key --project-name tw-bot-fixed
        }
    }
}
