# Download runtime AARs that fail with Tag mismatch on this PC (chunked HTTP).
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Install = Join-Path $Root 'scripts\install-maven-aar.ps1'
$Cache = Join-Path $env:USERPROFILE '.gradle\caches\modules-2\files-2.1'
$Repo = Join-Path $Root 'android\local-maven-repo'

function Install-Aar {
  param(
    [string]$Group,
    [string]$Artifact,
    [string]$Version,
    [string]$Base,
    [string]$FileName = "$Artifact-$Version.aar"
  )
  $gp = $Group.Replace('.', '/')
  $url = "$Base/$gp/$Artifact/$Version/$FileName"
  & $Install -GroupId $Group -ArtifactId $Artifact -Version $Version -Url $url -FileName $FileName

  $local = Join-Path $Repo "$gp/$Artifact/$Version/$FileName"
  if (-not (Test-Path $local)) { throw "Missing $local" }
  $hash = (Get-FileHash -Path $local -Algorithm SHA1).Hash.ToLower()
  $cacheDir = Join-Path $Cache "$Group\$Artifact\$Version\$hash"
  New-Item -Force -ItemType Directory -Path $cacheDir | Out-Null
  Copy-Item -Force $local (Join-Path $cacheDir $FileName)
  Write-Host "Gradle cache: ${Group}:${Artifact}:${Version} ($hash)"
}

Write-Host '=== React Native / Hermes (debug) ==='
Install-Aar -Group 'com.facebook.react' -Artifact 'react-android' -Version '0.79.6' `
  -Base 'https://repo.maven.apache.org/maven2' -FileName 'react-android-0.79.6-debug.aar'
Install-Aar -Group 'com.facebook.react' -Artifact 'hermes-android' -Version '0.79.6' `
  -Base 'https://repo.maven.apache.org/maven2' -FileName 'hermes-android-0.79.6-debug.aar'

Write-Host '=== React Native / Hermes (release) ==='
Install-Aar -Group 'com.facebook.react' -Artifact 'react-android' -Version '0.79.6' `
  -Base 'https://repo.maven.apache.org/maven2' -FileName 'react-android-0.79.6-release.aar'
Install-Aar -Group 'com.facebook.react' -Artifact 'hermes-android' -Version '0.79.6' `
  -Base 'https://repo.maven.apache.org/maven2' -FileName 'hermes-android-0.79.6-release.aar'

Write-Host '=== Firebase ==='
Install-Aar -Group 'com.google.firebase' -Artifact 'firebase-auth' -Version '24.0.1' `
  -Base 'https://dl.google.com/dl/android/maven2'
Install-Aar -Group 'com.google.firebase' -Artifact 'firebase-firestore' -Version '26.1.1' `
  -Base 'https://dl.google.com/dl/android/maven2'
Install-Aar -Group 'com.google.firebase' -Artifact 'protolite-well-known-types' -Version '18.0.1' `
  -Base 'https://dl.google.com/dl/android/maven2'

Write-Host '=== Media / ExoPlayer ==='
Install-Aar -Group 'androidx.media3' -Artifact 'media3-exoplayer' -Version '1.4.0' `
  -Base 'https://dl.google.com/dl/android/maven2'
Install-Aar -Group 'androidx.media3' -Artifact 'media3-exoplayer-hls' -Version '1.4.0' `
  -Base 'https://dl.google.com/dl/android/maven2'
Install-Aar -Group 'com.google.android.exoplayer' -Artifact 'exoplayer-ui' -Version '2.18.1' `
  -Base 'https://dl.google.com/dl/android/maven2'

Write-Host '=== Other ==='
Install-Aar -Group 'io.legere' -Artifact 'pdfiumandroid' -Version '1.0.32' `
  -Base 'https://repo.maven.apache.org/maven2'
Install-Aar -Group 'io.sentry' -Artifact 'sentry-android-core' -Version '8.43.0' `
  -Base 'https://repo.maven.apache.org/maven2'
Install-Aar -Group 'org.jitsi' -Artifact 'webrtc' -Version '124.0.0' `
  -Base 'https://repo.maven.apache.org/maven2'

Write-Host '=== JARs (KSP / compile) ==='
$Chunk = Join-Path $Root 'scripts\install-maven-jar-chunked.ps1'
$bcDir = Join-Path $Repo 'org\bouncycastle\bcprov-jdk15to18\1.78.1'
New-Item -Force -ItemType Directory -Path $bcDir | Out-Null
$bcJar = Join-Path $bcDir 'bcprov-jdk15to18-1.78.1.jar'
& $Chunk -Url 'https://repo.maven.apache.org/maven2/org/bouncycastle/bcprov-jdk15to18/1.78.1/bcprov-jdk15to18-1.78.1.jar' -DestFile $bcJar
$bcHash = (Get-FileHash -Path $bcJar -Algorithm SHA1).Hash.ToLower()
$bcCache = Join-Path $Cache "org.bouncycastle\bcprov-jdk15to18\1.78.1\$bcHash"
New-Item -Force -ItemType Directory -Path $bcCache | Out-Null
Copy-Item -Force $bcJar (Join-Path $bcCache 'bcprov-jdk15to18-1.78.1.jar')
Write-Host "Gradle cache: org.bouncycastle:bcprov-jdk15to18:1.78.1 ($bcHash)"

Write-Host 'Runtime AAR bootstrap complete.'
