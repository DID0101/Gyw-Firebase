# Seed android/local-maven-repo when TLS drops large downloads (Windows VPN/AV).
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Repo = Join-Path $Root 'android\local-maven-repo'
$Script = Join-Path $Root 'scripts\install-maven-jar-chunked.ps1'

function Install-Maven {
  param([string]$Group, [string]$Artifact, [string]$Version, [string]$FileName, [string]$Base = 'https://repo.maven.apache.org/maven2')
  $gp = $Group.Replace('.', '/')
  $dir = Join-Path $Repo "$gp/$Artifact/$Version"
  New-Item -Force -ItemType Directory -Path $dir | Out-Null
  $jar = Join-Path $dir $FileName
  $url = "$Base/$gp/$Artifact/$Version/$FileName"
  & $Script -Url $url -DestFile $jar
}

function Install-GoogleMaven {
  param([string]$Group, [string]$Artifact, [string]$Version)
  Install-Maven -Group $Group -Artifact $Artifact -Version $Version `
    -FileName "$Artifact-$Version.jar" -Base 'https://dl.google.com/dl/android/maven2'
}

Write-Host '=== Kotlin stdlib + common deps ==='
Install-Maven -Group 'org.jetbrains.kotlin' -Artifact 'kotlin-stdlib' -Version '2.0.21' `
  -FileName 'kotlin-stdlib-2.0.21.jar'
Install-Maven -Group 'com.google.code.gson' -Artifact 'gson' -Version '2.8.9' `
  -FileName 'gson-2.8.9.jar'
Install-Maven -Group 'com.google.guava' -Artifact 'guava' -Version '31.0.1-jre' `
  -FileName 'guava-31.0.1-jre.jar'
Install-Maven -Group 'com.squareup' -Artifact 'javapoet' -Version '1.13.0' `
  -FileName 'javapoet-1.13.0.jar'
Install-Maven -Group 'junit' -Artifact 'junit' -Version '4.13.2' `
  -FileName 'junit-4.13.2.jar'
Install-Maven -Group 'org.assertj' -Artifact 'assertj-core' -Version '3.25.1' `
  -FileName 'assertj-core-3.25.1.jar'

Write-Host '=== Kotlin (settings plugin) ==='
Install-Maven -Group 'org.jetbrains.kotlin' -Artifact 'kotlin-gradle-plugin' -Version '2.0.21' `
  -FileName 'kotlin-gradle-plugin-2.0.21-gradle85.jar'
Install-Maven -Group 'org.jetbrains.kotlin' -Artifact 'kotlin-compiler-embeddable' -Version '2.0.21' `
  -FileName 'kotlin-compiler-embeddable-2.0.21.jar'
Install-Maven -Group 'org.jetbrains.kotlin' -Artifact 'kotlin-daemon-embeddable' -Version '2.0.21' `
  -FileName 'kotlin-daemon-embeddable-2.0.21.jar'
Install-Maven -Group 'org.jetbrains.kotlin' -Artifact 'kotlin-gradle-plugin-idea-proto' -Version '2.0.21' `
  -FileName 'kotlin-gradle-plugin-idea-proto-2.0.21.jar'
Install-Maven -Group 'org.jetbrains.kotlin' -Artifact 'kotlin-gradle-plugin-idea' -Version '2.0.21' `
  -FileName 'kotlin-gradle-plugin-idea-2.0.21.jar'
Install-Maven -Group 'org.jetbrains.kotlin' -Artifact 'kotlin-klib-commonizer-api' -Version '2.0.21' `
  -FileName 'kotlin-klib-commonizer-api-2.0.21.jar'
Install-Maven -Group 'org.jetbrains.kotlin' -Artifact 'kotlin-build-tools-api' -Version '2.0.21' `
  -FileName 'kotlin-build-tools-api-2.0.21.jar'
Install-Maven -Group 'org.jetbrains.kotlin' -Artifact 'kotlin-util-klib-metadata' -Version '2.0.21' `
  -FileName 'kotlin-util-klib-metadata-2.0.21.jar'

Write-Host '=== Android Gradle Plugin ==='
Install-GoogleMaven -Group 'com.android.tools.build' -Artifact 'gradle' -Version '8.5.0'
Install-GoogleMaven -Group 'com.android.tools.build' -Artifact 'builder' -Version '8.5.0'
Install-GoogleMaven -Group 'com.android.tools.build' -Artifact 'builder-model' -Version '8.5.0'

Write-Host '=== Firebase / Google ==='
Install-GoogleMaven -Group 'com.google.firebase' -Artifact 'firebase-crashlytics-gradle' -Version '3.0.6'
Install-GoogleMaven -Group 'com.google.firebase' -Artifact 'firebase-crashlytics-buildtools' -Version '3.0.6'
Install-GoogleMaven -Group 'com.google.firebase' -Artifact 'perf-plugin' -Version '2.0.2'
Install-GoogleMaven -Group 'com.google.gms' -Artifact 'google-services' -Version '4.4.1'

Write-Host 'Bootstrap complete.'
