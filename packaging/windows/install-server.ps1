$ErrorActionPreference = "Stop"

$repository = "hyperpuncher/pi-ui"
$archiveName = "pi-ui-server-windows-x64.zip"
$archiveUrl = "https://github.com/$repository/releases/latest/download/$archiveName"
$installDirectory = Join-Path $env:LOCALAPPDATA "Programs\pi-ui-server"
$executable = Join-Path $installDirectory "pi-ui-server.exe"
$tempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "pi-ui-server-$([guid]::NewGuid())"
$tempArchive = Join-Path $tempDirectory $archiveName

if (-not [Environment]::Is64BitOperatingSystem) {
	throw "pi-ui server currently requires 64-bit Windows."
}

try {
	New-Item -ItemType Directory -Path $tempDirectory -Force | Out-Null
	Write-Host "Downloading the latest pi-ui server..."
	Invoke-WebRequest -Uri $archiveUrl -OutFile $tempArchive -UseBasicParsing
	Expand-Archive -Path $tempArchive -DestinationPath $tempDirectory -Force

	schtasks.exe /End /TN "pi-ui-server" 2>$null | Out-Null
	New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
	Copy-Item (Join-Path $tempDirectory "pi-ui-server.exe") $executable -Force

	$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
	$entries = @($userPath -split ";" | Where-Object { $_ })
	if ($installDirectory -notin $entries) {
		[Environment]::SetEnvironmentVariable(
			"Path",
			(($entries + $installDirectory) -join ";"),
			"User"
		)
	}

	$command = Start-Process $executable -ArgumentList @("autostart", "enable") -Wait -PassThru
	if ($command.ExitCode -ne 0) {
		throw "Could not configure pi-ui server autostart (exit code $($command.ExitCode))."
	}
	Write-Host "pi-ui server installed. Open http://127.0.0.1:31415 in your browser."
} finally {
	Remove-Item $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
