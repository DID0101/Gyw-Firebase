param(
  [Parameter(Mandatory = $true)][string]$GroupId,
  [Parameter(Mandatory = $true)][string]$ArtifactId,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$FileName,
  [string]$RepoRoot = (Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'android\local-maven-repo')
)

$ErrorActionPreference = 'Stop'
$ChunkScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'install-maven-jar-chunked.ps1'

$gp = $GroupId.Replace('.', '/')
$dir = Join-Path $RepoRoot "$gp/$ArtifactId/$Version"
New-Item -Force -ItemType Directory -Path $dir | Out-Null

$dest = Join-Path $dir $FileName
& $ChunkScript -Url $Url -DestFile $dest

$pomName = if ($FileName -match '^(.+)\.aar$') { $Matches[1] } else { "$ArtifactId-$Version" }
$pom = @"
<?xml version="1.0" encoding="UTF-8"?>
<project xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd"
  xmlns="http://maven.apache.org/POM/4.0.0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <modelVersion>4.0.0</modelVersion>
  <groupId>$GroupId</groupId>
  <artifactId>$ArtifactId</artifactId>
  <version>$Version</version>
  <packaging>aar</packaging>
</project>
"@
Set-Content -Path (Join-Path $dir "$pomName.pom") -Value $pom -Encoding UTF8
Write-Host "Installed AAR ${GroupId}:${ArtifactId}:${Version} -> $FileName"
