param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath
)

if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "Native Messaging manifest was not found: $ManifestPath"
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

if ($manifest.name -ne 'com.chatgpt.wsl_terminal') {
    throw "Unexpected Native Messaging host name."
}

if ($manifest.type -ne 'stdio') {
    throw "Native Messaging host type must be stdio."
}

if ($manifest.path -notlike '*.exe') {
    throw "Native Messaging host path must point to a Windows executable."
}

if ($manifest.allowed_origins.Count -ne 1 -or
    $manifest.allowed_origins[0] -notmatch '^chrome-extension://[a-p]{32}/$') {
    throw "Invalid Chrome extension origin in Native Messaging manifest."
}

$registryPath =
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.chatgpt.wsl_terminal'

New-Item -Path $registryPath -Force | Out-Null
Set-ItemProperty `
    -Path $registryPath `
    -Name '(default)' `
    -Value (Resolve-Path -LiteralPath $ManifestPath).Path

Write-Host "Native Messaging host registered."
Write-Host "  Name: com.chatgpt.wsl_terminal"
Write-Host "  Manifest: $((Resolve-Path -LiteralPath $ManifestPath).Path)"
