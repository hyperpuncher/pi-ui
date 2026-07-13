$ErrorActionPreference = "Stop"

$repository = "hyperpuncher/pi-ui"
$installerName = "pi-ui-windows-x64.msi"
$installerUrl = "https://github.com/$repository/releases/latest/download/$installerName"
$tempInstaller = Join-Path ([System.IO.Path]::GetTempPath()) "pi-ui-$([guid]::NewGuid()).msi"

if (-not [Environment]::Is64BitOperatingSystem) {
	throw "pi-ui currently requires 64-bit Windows."
}

try {
	Write-Host "Downloading the latest pi-ui installer..."
	Invoke-WebRequest -Uri $installerUrl -OutFile $tempInstaller -UseBasicParsing

	Write-Host "Starting Windows Installer (administrator approval may be required)..."
	$installer = Start-Process msiexec.exe -ArgumentList @("/i", "`"$tempInstaller`"") -Wait -PassThru
	if ($installer.ExitCode -notin @(0, 1641, 3010)) {
		throw "Windows Installer failed with exit code $($installer.ExitCode)."
	}

	Write-Host "pi-ui installed successfully."
	if ($installer.ExitCode -in @(1641, 3010)) {
		Write-Host "Windows may need to restart to finish the installation."
	}
} finally {
	Remove-Item $tempInstaller -Force -ErrorAction SilentlyContinue
}
