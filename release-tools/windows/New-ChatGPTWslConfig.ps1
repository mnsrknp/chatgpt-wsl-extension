param(
    [Parameter(Mandatory = $true)]
    [string]$WslDistribution,

    [Parameter(Mandatory = $true)]
    [string]$ProjectPath,

    [Parameter(Mandatory = $true)]
    [string]$ExtensionId,

    [Parameter(Mandatory = $true)]
    [string]$InstallDirectory
)

if ($ExtensionId -notmatch '^[a-p]{32}$') {
    throw "Invalid Chrome extension ID."
}

if ([string]::IsNullOrWhiteSpace($WslDistribution)) {
    throw "WSL distribution is required."
}

if ([string]::IsNullOrWhiteSpace($ProjectPath)) {
    throw "WSL project path is required."
}

if ([string]::IsNullOrWhiteSpace($InstallDirectory)) {
    throw "Install directory is required."
}

New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null

$config = @{
    WslDistribution = $WslDistribution
    ProjectPath     = $ProjectPath
    ExtensionId     = $ExtensionId
} | ConvertTo-Json

$configPath = Join-Path $InstallDirectory 'ChatGPTWslLauncher.config.json'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($configPath, $config, $utf8NoBom)

$manifest = @{
    name            = 'com.chatgpt.wsl_terminal'
    description     = 'Local WSL terminal bridge for ChatGPT'
    path            = (Join-Path $InstallDirectory 'ChatGPTWslLauncher.exe')
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 3

$manifestPath = Join-Path $InstallDirectory 'com.chatgpt.wsl_terminal.json'
[System.IO.File]::WriteAllText($manifestPath, $manifest, $utf8NoBom)

Write-Host "Created:"
Write-Host "  $configPath"
Write-Host "  $manifestPath"
