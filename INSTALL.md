# Installation Guide

This guide covers the Windows + WSL2 + Chrome setup.

## Requirements

- Windows with WSL2
- A working WSL distribution
- Node.js available inside WSL
- Google Chrome
- The Chrome extension source from this repository
- A Windows C# compiler capable of building the Native Messaging launcher

## 1. Load the extension in Chrome

1. Open Chrome.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository `extension` directory.
6. Copy the generated **Extension ID**.

The Extension ID is required by the Native Messaging configuration.

## 2. Configure the WSL project

The Native Messaging launcher configuration requires:

- `WslDistribution` — the WSL distribution name.
- `ProjectPath` — the absolute Linux path to this repository.
- `ExtensionId` — the Chrome extension ID.

Example:

```json
{
  "WslDistribution": "Ubuntu",
  "ProjectPath": "/home/your-user/chatgpt-wsl-extension",
  "ExtensionId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

Replace all three example values with your actual configuration.

## 3. Build the Windows launcher

Compile `native-host/windows-launcher/ChatGPTWslLauncher.cs` as `ChatGPTWslLauncher.exe`.

Place the executable together with `ChatGPTWslLauncher.config.json` and `com.chatgpt.wsl_terminal.json`.

## 4. Generate the configuration

Use `release-tools/windows/New-ChatGPTWslConfig.ps1` with your WSL distribution, project path, Chrome extension ID, and Windows installation directory.

The script creates `ChatGPTWslLauncher.config.json` and `com.chatgpt.wsl_terminal.json`.

## 5. Register Native Messaging

Run `release-tools/windows/Install-ChatGPTWslNativeHost.ps1` with the generated Native Messaging manifest.

The installer registers the Native Messaging host for the current Windows user.

## 6. Start and connect

The extension uses Chrome Native Messaging to start the WSL-side native host when the user explicitly connects.

The native host starts the local HTTP bridge on `127.0.0.1:8765`.

## 7. Security behavior

Commands detected from ChatGPT are **not executed automatically**.

Before execution, review the exact command and explicitly approve it. Results are not automatically submitted to ChatGPT.

Approved commands execute with the permissions of the configured WSL user and remain subject to the executor restrictions.

## 8. Updating the extension

After changing extension source files, open `chrome://extensions` and click **Reload** for the unpacked extension.

## 9. Development validation

Before a release, validate executor security tests, JavaScript syntax, Python syntax, PowerShell scripts, Windows Native Messaging launcher compilation, and WSL launcher startup.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the development baseline and principles.
