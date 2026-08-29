$ErrorActionPreference = "Stop"

$repository = "hyperpuncher/pi-ui"
$archiveName = "pi-ui-windows-x64.zip"
$archiveUrl = "https://github.com/$repository/releases/latest/download/$archiveName"
$installDirectory = Join-Path $env:LOCALAPPDATA "Programs\pi-ui"
$executable = Join-Path $installDirectory "pi-ui.exe"
$legacyInstallDirectory = Join-Path $env:LOCALAPPDATA "Programs\pi-ui-server"
$legacyExecutable = Join-Path $legacyInstallDirectory "pi-ui-server.exe"
$tempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "pi-ui-$([guid]::NewGuid())"
$tempArchive = Join-Path $tempDirectory $archiveName

if (-not [Environment]::Is64BitOperatingSystem) {
	throw "pi-ui currently requires 64-bit Windows."
}

try {
	New-Item -ItemType Directory -Path $tempDirectory -Force | Out-Null
	Write-Host "Downloading the latest pi-ui..."
	Invoke-WebRequest -Uri $archiveUrl -OutFile $tempArchive -UseBasicParsing
	Expand-Archive -Path $tempArchive -DestinationPath $tempDirectory -Force

	Get-ScheduledTask -TaskName "pi-ui-server" -ErrorAction SilentlyContinue |
		Stop-ScheduledTask -ErrorAction SilentlyContinue
	Get-Process -Name "pi-ui-server" -ErrorAction SilentlyContinue |
		Where-Object { $_.Path -eq $legacyExecutable } |
		Stop-Process -Force -ErrorAction SilentlyContinue
	Get-Process -Name "pi-ui" -ErrorAction SilentlyContinue |
		Stop-Process -Force -ErrorAction SilentlyContinue
	New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
	Copy-Item (Join-Path $tempDirectory "pi-ui.exe") $executable -Force

	$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
	$entries = @($userPath -split ";" | Where-Object { $_ -and $_ -ne $legacyInstallDirectory })
	if ($installDirectory -notin $entries) {
		$entries += $installDirectory
	}
	[Environment]::SetEnvironmentVariable("Path", ($entries -join ";"), "User")

	$command = Start-Process $executable -ArgumentList @("service", "install") -PassThru
	$command.WaitForExit()
	if ($command.ExitCode -ne 0) {
		throw "Could not install the pi-ui service (exit code $($command.ExitCode))."
	}
	Remove-Item $legacyInstallDirectory -Recurse -Force -ErrorAction SilentlyContinue
	Write-Host "pi-ui installed. Open http://127.0.0.1:31415 in your browser."
} finally {
	Remove-Item $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
