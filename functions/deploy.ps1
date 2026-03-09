# Deploy Firebase Functions - works around timeout when project path has spaces
# Run from project root: .\functions\deploy.ps1

$projectRoot = Split-Path -Parent $PSScriptRoot
$hasSpaces = $projectRoot -match " "

if ($hasSpaces) {
    Write-Host "Project path has spaces - using subst drive to avoid deploy timeout..." -ForegroundColor Yellow
    $drive = "Z:"
    if (Test-Path $drive) { subst $drive /D }
    subst $drive $projectRoot
    Push-Location $drive
} else {
    Push-Location $projectRoot
}

try {
    firebase deploy --only functions
} finally {
    Pop-Location
    if ($hasSpaces -and (Test-Path $drive)) { subst $drive /D }
}
