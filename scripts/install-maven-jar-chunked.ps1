param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$DestFile,
  [int]$ChunkSize = 262144
)

$ErrorActionPreference = 'Stop'
New-Item -Force -ItemType Directory -Path (Split-Path $DestFile) | Out-Null

$meta = & curl.exe -sI -L --http1.1 $Url 2>$null
$expected = [int64](($meta | Select-String '^Content-Length:' | Select-Object -Last 1).ToString().Split(':')[1].Trim())
if ($expected -le 0) { throw "No Content-Length for $Url" }

$start = 0
if (Test-Path $DestFile) {
  $start = (Get-Item $DestFile).Length
  if ($start -eq $expected) {
    Write-Host "Skip complete $DestFile"
    return
  }
  if ($start -gt $expected) {
    Remove-Item $DestFile -Force
    $start = 0
  }
}

Write-Host "Download $Url ($expected bytes, resume $start)"
$chunk = $ChunkSize
if ($start -eq 0) {
  $fs = [IO.File]::Create($DestFile)
} else {
  $fs = [IO.File]::Open($DestFile, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite)
  $fs.Seek(0, [IO.SeekOrigin]::End) | Out-Null
}
$i = [math]::Floor($start / $chunk)
try {
  while ($fs.Length -lt $expected) {
    $rangeStart = $i * $chunk
    $rangeEnd = [math]::Min($rangeStart + $chunk - 1, $expected - 1)
    $want = $rangeEnd - $rangeStart + 1
    $part = Join-Path $env:TEMP ("mvn-part-{0}.bin" -f $i)
    $ok = $false
    for ($t = 1; $t -le 15; $t++) {
      $prevErr = $ErrorActionPreference
      $ErrorActionPreference = 'SilentlyContinue'
      & curl.exe -L --http1.1 --silent --range "${rangeStart}-${rangeEnd}" -o $part $Url 2>$null
      $ErrorActionPreference = $prevErr
      if (Test-Path $part) {
        $got = (Get-Item $part).Length
        if ($got -eq $want -or ($rangeEnd -eq $expected - 1 -and $got -gt 0 -and $got -le $want)) {
          $ok = $true
          break
        }
        Remove-Item $part -Force -ErrorAction SilentlyContinue
      }
      Start-Sleep -Milliseconds 300
    }
    if (-not $ok) { throw "Chunk $i failed at $($fs.Length)" }
    $bytes = [IO.File]::ReadAllBytes($part)
    $fs.Write($bytes, 0, $bytes.Length)
    Remove-Item $part -Force -ErrorAction SilentlyContinue
    if ($bytes.Length -lt $chunk -or $fs.Length -ge $expected) { break }
    $i++
    if ($i % 40 -eq 0) { Write-Host "  $([math]::Round(100 * $fs.Length / $expected, 1))%" }
  }
} finally {
  $fs.Close()
}

$len = (Get-Item $DestFile).Length
if ($len -ne $expected) { throw "Size mismatch $len != $expected for $DestFile" }
Write-Host "OK $DestFile"
