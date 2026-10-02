param(
  [Parameter(Mandatory = $true)][string]$GroupId,
  [Parameter(Mandatory = $true)][string]$ArtifactId,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$JarPath,
  [string]$RepoRoot = 'c:\Users\dpurl\Desktop\signal-clone - Copy\android\local-maven-repo'
)

$gp = $GroupId.Replace('.', '/')
$dir = Join-Path $RepoRoot "$gp/$ArtifactId/$Version"
New-Item -Force -ItemType Directory -Path $dir | Out-Null

$baseName = "$ArtifactId-$Version"
$destJar = Join-Path $dir "$baseName.jar"
Copy-Item -Force $JarPath $destJar

$pom = @"
<?xml version="1.0" encoding="UTF-8"?>
<project xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd"
  xmlns="http://maven.apache.org/POM/4.0.0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <modelVersion>4.0.0</modelVersion>
  <groupId>$GroupId</groupId>
  <artifactId>$ArtifactId</artifactId>
  <version>$Version</version>
  <packaging>jar</packaging>
</project>
"@

Set-Content -Path (Join-Path $dir "$baseName.pom") -Value $pom -Encoding UTF8
Write-Host "Installed ${GroupId}:${ArtifactId}:${Version}"
