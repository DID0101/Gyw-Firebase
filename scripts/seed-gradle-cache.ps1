# Copy pre-downloaded JARs into Gradle module cache (SHA1 folders) to bypass TLS downloads.
$ErrorActionPreference = 'Stop'
$Cache = Join-Path $env:USERPROFILE '.gradle\caches\modules-2\files-2.1'
$Repo = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'android\local-maven-repo'

function Install-CacheJar {
  param(
    [string]$Group,
    [string]$Module,
    [string]$Version,
    [string]$SourceJar,
    [string]$DestName
  )
  if (-not (Test-Path $SourceJar)) { throw "Missing $SourceJar" }
  $hash = (Get-FileHash -Path $SourceJar -Algorithm SHA1).Hash.ToLower()
  $dir = Join-Path $Cache "$Group\$Module\$Version\$hash"
  New-Item -Force -ItemType Directory -Path $dir | Out-Null
  $dest = Join-Path $dir $DestName
  Copy-Item -Force $SourceJar $dest
  Write-Host "Cached ${Group}:${Module}:${Version} -> $hash"
}

function RepoJar($groupPath, $artifact, $version, $fileName) {
  Join-Path $Repo "$groupPath/$artifact/$version/$fileName"
}

# Skip deleting locked/corrupt entries — install good copies under their SHA1 folders.
Install-CacheJar 'org.jetbrains.kotlin' 'kotlin-gradle-plugin' '2.0.21' `
  (RepoJar 'org/jetbrains/kotlin' 'kotlin-gradle-plugin' '2.0.21' 'kotlin-gradle-plugin-2.0.21-gradle85.jar') `
  'kotlin-gradle-plugin-2.0.21-gradle85.jar'

Install-CacheJar 'org.jetbrains.kotlin' 'kotlin-compiler-embeddable' '2.0.21' `
  (RepoJar 'org/jetbrains/kotlin' 'kotlin-compiler-embeddable' '2.0.21' 'kotlin-compiler-embeddable-2.0.21.jar') `
  'kotlin-compiler-embeddable-2.0.21.jar'

Install-CacheJar 'org.jetbrains.kotlin' 'kotlin-daemon-embeddable' '2.0.21' `
  (RepoJar 'org/jetbrains/kotlin' 'kotlin-daemon-embeddable' '2.0.21' 'kotlin-daemon-embeddable-2.0.21.jar') `
  'kotlin-daemon-embeddable-2.0.21.jar'

Install-CacheJar 'com.google.firebase' 'firebase-crashlytics-gradle' '3.0.6' `
  (RepoJar 'com/google/firebase' 'firebase-crashlytics-gradle' '3.0.6' 'firebase-crashlytics-gradle-3.0.6.jar') `
  'firebase-crashlytics-gradle-3.0.6.jar'

Install-CacheJar 'com.google.firebase' 'firebase-crashlytics-buildtools' '3.0.6' `
  (RepoJar 'com/google/firebase' 'firebase-crashlytics-buildtools' '3.0.6' 'firebase-crashlytics-buildtools-3.0.6.jar') `
  'firebase-crashlytics-buildtools-3.0.6.jar'

Install-CacheJar 'com.android.tools.build' 'gradle' '8.5.0' `
  (RepoJar 'com/android/tools/build' 'gradle' '8.5.0' 'gradle-8.5.0.jar') `
  'gradle-8.5.0.jar'

Install-CacheJar 'com.android.tools.build' 'builder' '8.5.0' `
  (RepoJar 'com/android/tools/build' 'builder' '8.5.0' 'builder-8.5.0.jar') `
  'builder-8.5.0.jar'

Write-Host 'Gradle cache seeded.'
