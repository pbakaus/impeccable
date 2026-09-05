# Maintainer-authorized diagnostic for #740. Never executes release binaries,
# adds exclusions, restores quarantine, or disables antivirus protection.
# A completed scan is evidence for this engine/definition/host only, not a
# false-positive determination or clearance for other machines.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$evidence = Join-Path $env:RUNNER_TEMP 'impeccable-defender-evidence'
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$samples = Join-Path $env:RUNNER_TEMP ('impeccable-defender-samples-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $samples | Out-Null
$report = [ordered]@{
  startedAt = (Get-Date).ToUniversalTime().ToString('o')
  os = (Get-CimInstance Win32_OperatingSystem).Caption
  status = 'initializing'
  samples = @()
}
$failed = $false
try {
  $before = Get-MpComputerStatus
  $report.before = $before | Select-Object AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled, AMEngineVersion, AMProductVersion, AntivirusSignatureVersion, AntivirusSignatureLastUpdated
  if (-not $before.AMServiceEnabled) {
    # Enabling an installed service is safe on this disposable runner. Never
    # change exclusion, remediation, or cloud policies.
    Start-Service WinDefend
  }
  $mp = Get-ChildItem "$env:ProgramData\Microsoft\Windows Defender\Platform\*\MpCmdRun.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
  if (-not $mp) { $mp = "$env:ProgramFiles\Windows Defender\MpCmdRun.exe" }
  if (-not (Test-Path -LiteralPath $mp)) { throw 'Microsoft Defender scanner is unavailable on this runner.' }
  $report.scanner = $mp
  $updateOutput = & $mp -SignatureUpdate 2>&1 | Out-String
  $report.signatureUpdateExitCode = $LASTEXITCODE
  $updateOutput | Set-Content (Join-Path $evidence 'signature-update.txt')
  Write-Output $updateOutput
  if ($report.signatureUpdateExitCode -ne 0) { throw 'Defender signature update failed; cannot claim a current-definition scan.' }
  # Hosted images can default to real-time monitoring off. Enable it for the
  # download-time reproduction and explicitly refuse to mislabel a scan if
  # policy prevents activation. Never turn protection off.
  Set-MpPreference -DisableRealtimeMonitoring $false
  Start-Sleep -Seconds 3
  $current = Get-MpComputerStatus
  $report.scannerStatus = $current | Select-Object AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled, AMEngineVersion, AMProductVersion, AntivirusSignatureVersion, AntivirusSignatureLastUpdated
  if (-not $current.AMServiceEnabled -or -not $current.AntivirusEnabled) { throw 'Defender is not active; no scan verdict can be inferred.' }
  if (-not $current.RealTimeProtectionEnabled) { throw 'Real-time monitoring remains disabled by runner policy; cannot reproduce download-time detection on this host.' }
  $report.protectionPreferences = Get-MpPreference | Select-Object DisableRealtimeMonitoring, DisableIOAVProtection, DisableBehaviorMonitoring, MAPSReporting, SubmitSamplesConsent, ExclusionPath, ExclusionProcess, ExclusionExtension
  $http = [System.Net.Http.HttpClient]::new()
  $http.Timeout = [TimeSpan]::FromSeconds(90)
  foreach ($sample in @(
    @{ version = '0.1.0'; sha256 = 'a522fcf352b47f325facc3964b337a6d6d7d55e136440f1442e8013aad27f1d7' },
    @{ version = '0.1.1'; sha256 = '5d2f844a7f1dac3acdbac6035785043ab0cba6b81c1af97ba5c9cd1ecdd3dff8' }
  )) {
    $item = [ordered]@{ version = $sample.version; expectedSha256 = $sample.sha256; status = 'pending' }
    $file = Join-Path $samples ("impeccable-" + $sample.version + '.exe')
    try {
      $url = "https://github.com/pbakaus/impeccable/releases/download/engine-v$($sample.version)/impeccable-windows-x64.exe"
      $bytes = $http.GetByteArrayAsync($url).GetAwaiter().GetResult()
      $item.actualSha256 = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
      $item.bytes = $bytes.Length
      if ($item.actualSha256 -ne $sample.sha256) { throw 'Release bytes do not match the pinned investigation hash.' }
      [System.IO.File]::WriteAllBytes($file, $bytes)
      $bytes = $null
      if (-not (Test-Path -LiteralPath $file)) { throw 'Sample disappeared after writing; inspect real-time detection evidence.' }
      $item.authenticodeStatus = [string](Get-AuthenticodeSignature -LiteralPath $file).Status
      # This suppresses remediation for this custom scan, not real-time
      # protection. Detections appear in stdout; preserve it without guessing
      # from exit 2 (which can mean either a detection or a scanning error).
      $scanOutput = & $mp -Scan -ScanType 3 -File $file -DisableRemediation 2>&1 | Out-String
      $item.scanExitCode = $LASTEXITCODE
      $scanOutput | Set-Content (Join-Path $evidence ("scan-" + $sample.version + '.txt'))
      Write-Output "Engine $($sample.version):"
      Write-Output $scanOutput
      $item.presentAfterScan = Test-Path -LiteralPath $file
      $item.status = 'scan-finished-review-output'
      if ($item.scanExitCode -ne 0) { $failed = $true }
    } catch {
      $item.status = 'unavailable-or-error'
      $item.error = $_.Exception.Message
      $failed = $true
    }
    $report.samples += $item
  }
  $http.Dispose()
  $report.status = 'completed-review-evidence'
} catch {
  $report.status = 'unavailable-or-error'
  $report.error = $_.Exception.Message
  $failed = $true
} finally {
  try {
    Get-MpThreatDetection | Select-Object InitialDetectionTime, ThreatID, Resources, ActionSuccess |
      ConvertTo-Json -Depth 6 | Set-Content (Join-Path $evidence 'realtime-detections.json')
    Get-MpThreat | Select-Object ThreatID, ThreatName, IsActive, DidThreatExecute |
      ConvertTo-Json -Depth 6 | Set-Content (Join-Path $evidence 'threat-names.json')
  } catch { $_.Exception.Message | Set-Content (Join-Path $evidence 'detection-query-error.txt') }
  $report.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  $json = $report | ConvertTo-Json -Depth 8
  $json | Set-Content (Join-Path $evidence 'report.json')
  Write-Output $json
  if ($env:GITHUB_STEP_SUMMARY) {
    "## Defender investigation evidence`n`nThis is not a vendor false-positive determination.`n`n``````json`n$json`n``````" | Add-Content $env:GITHUB_STEP_SUMMARY
  }
}
if ($failed) { exit 1 }
