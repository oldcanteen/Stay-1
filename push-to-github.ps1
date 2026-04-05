# Run in PowerShell: right-click -> Run with PowerShell, or: .\push-to-github.ps1
# Completes GitHub CLI login (browser), then pushes this repo to YOUR existing remote.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$gh = "C:\Program Files\GitHub CLI\gh.exe"
$git = "C:\Program Files\Git\bin\git.exe"

if (-not (Test-Path $git)) {
  Write-Error "Git not found at $git"
}
if (-not (Test-Path $gh)) {
  Write-Error "GitHub CLI not found at $gh. Install: winget install GitHub.cli"
}

& $gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "=== GitHub login ===" -ForegroundColor Cyan
  Write-Host "A browser window will open, or use the device code shown."
  Write-Host ""
  & $gh auth login --hostname github.com --git-protocol https --web
}

Write-Host ""
$repoUrl = Read-Host "Paste your repository HTTPS URL (e.g. https://github.com/USERNAME/REPO.git)"
if ([string]::IsNullOrWhiteSpace($repoUrl)) {
  Write-Error "No URL provided."
}

& $git remote remove origin 2>$null
& $git remote add origin $repoUrl.Trim()
& $git branch -M main
Write-Host ""
Write-Host "Pushing to origin main..." -ForegroundColor Cyan
& $git push -u origin main
Write-Host "Done." -ForegroundColor Green
