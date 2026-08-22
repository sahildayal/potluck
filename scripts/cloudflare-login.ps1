# Opens an interactive `wrangler login` in a real console.
#
# `wrangler login` starts a browser OAuth flow and then waits on stdin for the
# redirect, so it needs a genuine TTY. Run from an agent it dies immediately
# with "stdin isn't a terminal" — the same trap the Neon MCP login hit. Hence a
# real PowerShell window rather than a background process.

$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host '  Cloudflare login for Potluck' -ForegroundColor Cyan
Write-Host '  ----------------------------' -ForegroundColor Cyan
Write-Host ''
Write-Host '  A browser window will open.' -ForegroundColor Yellow
Write-Host '  If you do not have a Cloudflare account yet, choose "Sign up" on that page.'
Write-Host '  It is free and does NOT ask for a card for Pages.'
Write-Host ''
Write-Host '  When it asks to authorize Wrangler, click Allow.'
Write-Host ''

Set-Location -Path 'C:\Users\Bikash\potluck'

npx --yes wrangler@latest login

Write-Host ''
Write-Host '  Checking who you are signed in as...' -ForegroundColor Cyan
npx --yes wrangler@latest whoami

Write-Host ''
Write-Host '  Done. You can close this window and tell Claude it worked.' -ForegroundColor Green
Write-Host ''
