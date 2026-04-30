$envContent = Get-Content .env
foreach ($line in $envContent) {
    if ($line -match "^([^=]+)=(.*)$") {
        $key = $matches[1].Trim()
        $val = $matches[2].Trim()
        if ($val -ne "") {
            Write-Host "Syncing $key to tw-bot-sovereign..."
            echo $val | npx wrangler secret put $key --name tw-bot-sovereign
        }
    }
}
