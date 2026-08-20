# Opens the Neon MCP OAuth flow in a real terminal.
#
# `claude mcp login` needs a genuine TTY to accept the pasted redirect URL, and
# the agent's shell tools don't provide one — it fails with "stdin isn't a
# terminal". Running this in a normal PowerShell window fixes that.

$ErrorActionPreference = 'Stop'

$claude = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
if (-not (Test-Path $claude)) {
    $cmd = Get-Command claude -ErrorAction SilentlyContinue
    if ($cmd) { $claude = $cmd.Source } else { throw 'claude executable not found' }
}

Write-Host ''
Write-Host '  Neon MCP sign-in' -ForegroundColor Cyan
Write-Host '  Sign in with your NEW email-signup Neon account,' -ForegroundColor DarkGray
Write-Host '  not the GitHub one tied to Vercel.' -ForegroundColor DarkGray
Write-Host ''

& $claude mcp login 'plugin:neon:neon'

Write-Host ''
Write-Host '  Done. You can close this window.' -ForegroundColor Green
Write-Host ''
Read-Host '  Press Enter to close'
