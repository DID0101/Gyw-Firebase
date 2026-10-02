# Bootstrap Gradle + buildscript deps when TLS drops large downloads.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/bootstrap-gradle-offline.ps1

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$WrapperDir = Join-Path $Root 'android\gradle\wrapper'
$ZipPath = Join-Path $WrapperDir 'gradle-8.13-bin.zip'
$LocalRepo = Join-Path $Root 'android\local-maven-repo'
$ChunkSize = 2MB

function Download-Chunked {
  param([string]$Url, [string]$OutFile)
  if (Test-Path $OutFile) {
    $existing = (Get-Item $OutFile).Length
    if ($existing -gt 120MB) {
      Write-Host "OK already: $OutFile ($existing bytes)"
      return
    }
    Remove-Item $OutFile -Force
  }
  Write-Host "Chunked download: $Url"
  $partDir = "$OutFile.parts"
  New-Item -ItemType Directory -Force -Path $partDir | Out-Null
  $index = 0
  $total = 0
  while ($true) {
    $start = $index * $ChunkSize
    $end = $start + $ChunkSize - 1
    $part = Join-Path $partDir ("part_{0:D5}" -f $index)
    if (-not (Test-Path $part) -or (Get-Item $part).Length -eq 0) {
      $range = "${start}-${end}"
      $ok = $false
      for ($try = 1; $try -le 8; $try++) {
        try {
          curl.exe -L --http1.1 --range $range -o $part $Url 2>$null | Out-Null
          if ((Test-Path $part) -and (Get-Item $part).Length -gt 0) { $ok = $true; break }
        } catch { Start-Sleep -Seconds 2 }
      }
      if (-not $ok) {
        if ($index -eq 0) { throw "First chunk failed for $Url" }
        break
      }
    }
    $len = (Get-Item $part).Length
    if ($len -lt $ChunkSize) { $total += $len; break }
    $total += $len
    $index++
    Write-Host "  chunk $index ($total bytes)"
  }
  Get-ChildItem $partDir -Filter 'part_*' | Sort-Object Name | ForEach-Object {
    Get-Content $_.FullName -Encoding Byte -ReadCount 0
  } | Set-Content $OutFile -Encoding Byte
  Remove-Item $partDir -Recurse -Force
  Write-Host "Saved $OutFile ($((Get-Item $OutFile).Length) bytes)"
}

function Install-MavenJar {
  param([string]$Group, [string]$Artifact, [string]$Version, [string]$BaseUrl)
  $groupPath = $Group.Replace('.', '/')
  $destDir = Join-Path $LocalRepo "$groupPath/$Artifact/$Version"
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  $jar = Join-Path $destDir "$Artifact-$Version.jar"
  if (Test-Path $jar) { return }
  $url = "$BaseUrl/$groupPath/$Artifact/$Version/$Artifact-$Version.jar"
  Write-Host "Maven jar: $url"
  for ($try = 1; $try -le 5; $try++) {
    try {
      curl.exe -L --http1.1 -o $jar $url 2>$null | Out-Null
      if ((Test-Path $jar) -and (Get-Item $jar).Length -gt 1000) { return }
    } catch { Start-Sleep -Seconds 1 }
  }
  throw "Failed: $url"
}

New-Item -ItemType Directory -Force -Path $WrapperDir | Out-Null
Download-Chunked -Url 'https://services.gradle.org/distributions/gradle-8.13-bin.zip' -OutFile $ZipPath

$props = Join-Path $WrapperDir 'gradle-wrapper.properties'
$fileUrl = 'file:///' + ($ZipPath -replace '\\', '/')
(Get-Content $props -Raw) -replace 'distributionUrl=.*', "distributionUrl=$fileUrl" | Set-Content $props -NoNewline

Install-MavenJar -Group 'com.google.firebase' -Artifact 'firebase-crashlytics-gradle' -Version '3.0.2' `
  -BaseUrl 'https://dl.google.com/dl/android/maven2'
Install-MavenJar -Group 'com.google.firebase' -Artifact 'firebase-crashlytics-buildtools' -Version '3.0.2' `
  -BaseUrl 'https://dl.google.com/dl/android/maven2'
Install-MavenJar -Group 'com.google.gms' -Artifact 'google-services' -Version '4.4.1' `
  -BaseUrl 'https://dl.google.com/dl/android/maven2'

Write-Host 'Bootstrap complete. Run: cd android; .\gradlew :app:assembleDebug'
