"use strict";

const status = document.getElementById("status");
const openButton = document.getElementById("openPanel");
const settingsToggle = document.getElementById("settings-toggle");
const settingsContent = document.getElementById("settings-content");
const settingCwd = document.getElementById("setting-cwd");
const settingTimeout = document.getElementById("setting-timeout");
const saveSettingsButton = document.getElementById("saveSettings");

const DEFAULT_SETTINGS = {
  cwd: ".",
  timeoutMs: 60000
};

const loadSettings = async () => {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  settingCwd.value =
    typeof stored.cwd === "string" && stored.cwd.trim()
      ? stored.cwd.trim()
      : DEFAULT_SETTINGS.cwd;

  const timeoutMs = Number(stored.timeoutMs);
  settingTimeout.value = String(
    Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 120000
      ? timeoutMs
      : DEFAULT_SETTINGS.timeoutMs
  );
};

settingsToggle.addEventListener("click", () => {
  settingsContent.hidden = !settingsContent.hidden;
  settingsToggle.textContent = settingsContent.hidden
    ? "⚙ Settings"
    : "⚙ Settings ▲";
});

saveSettingsButton.addEventListener("click", async () => {
  const cwd = settingCwd.value.trim();
  const timeoutMs = Number(settingTimeout.value);

  if (!cwd || cwd.length > 1024) {
    status.textContent = "Please enter a valid working directory.";
    return;
  }

  await chrome.storage.local.set({ cwd, timeoutMs });
  status.textContent = "Settings saved.";
});

loadSettings().catch((error) => {
  status.textContent = `Unable to load settings: ${error.message}`;
});

openButton.addEventListener("click", async () => {
  try {
    status.textContent = "Checking active ChatGPT tab...";

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id || !tab.url?.startsWith("https://chatgpt.com/")) {
      status.textContent = "Please open ChatGPT first.";
      return;
    }

    status.textContent = "Loading terminal panel...";

    const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
    const storedTimeout = Number(stored.timeoutMs);

    const settings = {
      cwd:
        typeof stored.cwd === "string" && stored.cwd.trim()
          ? stored.cwd.trim()
          : DEFAULT_SETTINGS.cwd,
      timeoutMs:
        Number.isInteger(storedTimeout) &&
        storedTimeout >= 1000 &&
        storedTimeout <= 120000
          ? storedTimeout
          : DEFAULT_SETTINGS.timeoutMs
    };

    const response = await fetch(chrome.runtime.getURL("panel.html"));

    if (!response.ok) {
      throw new Error("Unable to load panel.html");
    }

    const html = await response.text();

    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["panel.css"]
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (panelHTML, settings) => {
        const existing = document.getElementById("cwsl-panel");

        if (existing) {
          existing.remove();
          return;
        }

        const container = document.createElement("div");
        container.innerHTML = panelHTML.trim();

        const panel = container.firstElementChild;

        if (!panel) {
          throw new Error("Terminal panel HTML is empty.");
        }

        document.body.appendChild(panel);

        const closeButton = panel.querySelector("#cwsl-close");
        const minimizeButton = panel.querySelector("#cwsl-minimize");
        const connectButton = panel.querySelector("#cwsl-connect");
        const statusText = panel.querySelector("#cwsl-status-text");
        const output = panel.querySelector("#cwsl-output");
        const dot = panel.querySelector(".cwsl-dot");

        const commandGroup = panel.querySelector("#cwsl-command-group");
        const commandInput = panel.querySelector("#cwsl-command");

        const approvalText = panel.querySelector("#cwsl-approval");
        const approveButton = panel.querySelector("#cwsl-approve");
        const clearButton = panel.querySelector("#cwsl-clear");
        const insertButton = panel.querySelector("#cwsl-insert-result");

        let connected = false;
        let busy = false;
        let latestResultText = "";
        let healthTimer = null;
        let healthCheckInProgress = false;
        let commandDetectionCleanup = null;

        const setStatus = (text, color) => {
          statusText.textContent = text;
          dot.style.background = color;
        };

        const setOutput = (text) => {
          output.textContent = text;
        };

        const getOperation = () => ({
          action: "execute",
          command: commandInput.value.trim(),
          cwd: settings.cwd,
          timeoutMs: settings.timeoutMs
        });

        const isOperationValid = (operation) => (
          operation.action === "execute" &&
          typeof operation.command === "string" &&
          operation.command.length > 0 &&
          operation.command.length <= 4096 &&
          typeof operation.cwd === "string" &&
          operation.cwd.length > 0 &&
          operation.cwd.length <= 1024 &&
          Number.isInteger(operation.timeoutMs) &&
          operation.timeoutMs >= 1000 &&
          operation.timeoutMs <= 120000
        );

        const SHELL_LANGUAGES = new Set([
          "bash",
          "sh",
          "shell",
          "zsh",
          "console",
          "terminal"
        ]);

        const detectedCommands = new Set();

        const normalizeDetectedCommand = (text) => {
          return text
            .replace(/\r\n/g, "\n")
            .split("\n")
            .map((line) => line.replace(/^\s*\$\s?/, ""))
            .join("\n")
            .trim();
        };

        const looksLikeShellCommand = (text) => {
          const command = normalizeDetectedCommand(text);

          if (!command || command.length > 4096) {
            return false;
          }

          const lines = command
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);

          if (!lines.length) {
            return false;
          }

          return lines.every((line) =>
            /^(?:cd|pwd|ls|find|grep|sed|awk|cat|printf|echo|git|npm|npx|node|python|python3|pip|pip3|pytest|docker|docker-compose|curl|wget|mkdir|cp|mv|rm|touch|chmod|chown|source|export|env|which|command|bash|sh|ssh|tar|unzip|zip|make|go|cargo|java|javac|php|ruby|perl|sudo)\b/.test(line) ||
            /^(?:[A-Za-z_][A-Za-z0-9_]*=|[.\/]?\.\.?\/)/.test(line) ||
            /(?:&&|\|\||[|<>])/.test(line)
          );
        };

        const detectShellCommands = () => {
          const assistantMessages = document.querySelectorAll(
            '[data-markdown-text-style="assistant-message"]'
          );

          for (const message of assistantMessages) {
            const codeBlocks = message.querySelectorAll("pre code");

            for (const code of codeBlocks) {
              const languageClass = Array.from(code.classList)
                .find((name) => name.startsWith("language-"));

              const language = languageClass
                ? languageClass.slice("language-".length).toLowerCase()
                : "";

              const command = normalizeDetectedCommand(code.textContent || "");

              if (
                !command ||
                detectedCommands.has(command) ||
                (!SHELL_LANGUAGES.has(language) && !looksLikeShellCommand(command))
              ) {
                continue;
              }

              detectedCommands.add(command);
              commandInput.value = command;
              updateApproval();

              setStatus(
                "Shell command detected — review before approval",
                "#eab308"
              );

              setOutput(
                "Detected a shell command in the latest ChatGPT response.\n\n" +
                "The command has been placed in the approval field only.\n" +
                "Nothing has been executed or sent automatically."
              );

              return;
            }
          }
        };

        const startCommandDetection = () => {
          detectShellCommands();

          const observer = new MutationObserver(() => {
            detectShellCommands();
          });

          observer.observe(document.body, {
            childList: true,
            subtree: true
          });

          return observer;
        };

        const updateApproval = () => {
          const operation = getOperation();
          const valid = isOperationValid(operation);


          approveButton.disabled = !connected || busy || !valid;
        };

        const sendMessage = (message) => {
          return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
              const error = chrome.runtime.lastError;

              if (error) {
                reject(new Error(error.message));
                return;
              }

              resolve(response);
            });
          });
        };

        const formatResult = (result) => {
          if (!result || typeof result !== "object") {
            return String(result ?? "No result returned.");
          }

          if (result.action !== "execute") {
            return JSON.stringify(result, null, 2);
          }

          const sections = [
            `Command: ${result.command ?? "(not provided)"}`,
            `Working directory: ${result.cwd ?? "(not provided)"}`,
            `Exit code: ${result.exitCode ?? "unknown"}`,
            `Timed out: ${Boolean(result.timedOut)}`,
            `Output truncated: ${Boolean(result.truncated)}`
          ];

          if (result.signal) {
            sections.push(`Signal: ${result.signal}`);
          }

          sections.push(
            "",
            "STDOUT:",
            result.stdout || "(empty)",
            "",
            "STDERR:",
            result.stderr || "(empty)"
          );

          return sections.join("\n");
        };

        const findComposer = () => {
          const selectors = [
            "#prompt-textarea",
            '[data-testid="composer-text-input"]',
            'main [contenteditable="true"][role="textbox"]',
            'main textarea',
            'main [contenteditable="true"]'
          ];

          for (const selector of selectors) {
            const candidates = document.querySelectorAll(selector);

            for (const candidate of candidates) {
              if (
                panel.contains(candidate) ||
                candidate.closest("#cwsl-panel")
              ) {
                continue;
              }

              const rect = candidate.getBoundingClientRect();
              const style = window.getComputedStyle(candidate);

              if (
                rect.width > 0 &&
                rect.height > 0 &&
                style.visibility !== "hidden" &&
                style.display !== "none" &&
                !candidate.disabled &&
                !candidate.readOnly
              ) {
                return candidate;
              }
            }
          }

          return null;
        };

        const insertIntoComposer = (text) => {
          const composer = findComposer();

          if (!composer) {
            throw new Error(
              "Could not safely identify the ChatGPT composer. " +
              "No text was inserted."
            );
          }

          composer.focus();

          if (composer instanceof HTMLTextAreaElement ||
              composer instanceof HTMLInputElement) {
            const prototype =
              composer instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;

            const valueSetter =
              Object.getOwnPropertyDescriptor(prototype, "value")?.set;

            if (!valueSetter) {
              throw new Error("Composer value setter is unavailable.");
            }

            const existing = composer.value;
            const separator = existing.trim() ? "\n\n" : "";

            valueSetter.call(composer, existing + separator + text);

            composer.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data: text
              })
            );
          } else if (composer.isContentEditable) {
            const existing = composer.innerText || "";
            const separator = existing.trim() ? "\n\n" : "";

            composer.focus();

            const selection = window.getSelection();
            const range = document.createRange();

            range.selectNodeContents(composer);
            range.collapse(false);

            selection.removeAllRanges();
            selection.addRange(range);

            if (separator) {
              document.execCommand("insertText", false, separator);
            }

            document.execCommand("insertText", false, text);

            composer.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data: text
              })
            );
          } else {
            throw new Error("Unsupported ChatGPT composer element.");
          }

          return true;
        };

        const panelHeader = panel.querySelector(".cwsl-header");
        let dragState = null;

        panelHeader.addEventListener("pointerdown", (event) => {
          if (event.button !== 0 || event.target.closest("button")) return;

          const rect = panel.getBoundingClientRect();

          dragState = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top
          };

          panelHeader.setPointerCapture(event.pointerId);
          panel.style.left = `${rect.left}px`;
          panel.style.top = `${rect.top}px`;
          panel.style.right = "auto";
          event.preventDefault();
        });

        panelHeader.addEventListener("pointermove", (event) => {
          if (!dragState || event.pointerId !== dragState.pointerId) return;

          const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
          const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);

          const left = Math.min(maxLeft, Math.max(0, event.clientX - dragState.offsetX));
          const top = Math.min(maxTop, Math.max(0, event.clientY - dragState.offsetY));

          panel.style.left = `${left}px`;
          panel.style.top = `${top}px`;
        });

        const stopDragging = (event) => {
          if (dragState && event.pointerId === dragState.pointerId) {
            dragState = null;
          }
        };

        panelHeader.addEventListener("pointerup", stopDragging);
        panelHeader.addEventListener("pointercancel", stopDragging);

        closeButton.addEventListener("click", () => {
          if (healthTimer !== null) {
            clearInterval(healthTimer);
            healthTimer = null;
          }

          if (commandDetectionCleanup) {
            commandDetectionCleanup();
            commandDetectionCleanup = null;
          }

          panel.remove();
        });

        let expandedSize = null;

        minimizeButton.addEventListener("click", () => {
          const currentlyMinimized = panel.classList.contains("cwsl-minimized");

          if (!currentlyMinimized) {
            const rect = panel.getBoundingClientRect();
            expandedSize = {
              width: rect.width
            };

            panel.style.setProperty("--cwsl-header-height", `${panelHeader.getBoundingClientRect().height}px`);
            panel.style.setProperty("--cwsl-expanded-width", `${rect.width}px`);
          }

          const minimized = panel.classList.toggle("cwsl-minimized");

          if (!minimized && expandedSize) {
            panel.style.width = `${expandedSize.width}px`;
            panel.style.height = "auto";
          }

          minimizeButton.textContent = minimized ? "+" : "−";
          minimizeButton.title = minimized ? "Restore panel" : "Minimize panel";
          minimizeButton.setAttribute(
            "aria-label",
            minimized ? "Restore panel" : "Minimize panel"
          );
        });

        const connectToBridge = async ({initialCheck = false} = {}) => {
          connectButton.disabled = true;

          if (!initialCheck) {
            connectButton.textContent = "Connecting...";
            setStatus("Checking local HTTP bridge...", "#eab308");
          }

          try {
            const response = await sendMessage({
              type: initialCheck ? "CWSL_HEALTH" : "CWSL_PING"
            });

            if (!response?.ok) {
              throw new Error(response?.error || "Unexpected API response.");
            }

            connected = true;

            setStatus("WSL HTTP bridge connected", "#22c55e");

            setOutput(
              "HTTP connection successful.\n" +
              `Service: ${response.service}\n` +
              `Status: ${response.status}\n` +
              `Workspace: ${response.workspace}\n\n` +
              "Operations require explicit approval."
            );

            connectButton.textContent = "Connected";
            connectButton.disabled = true;
            updateApproval();

            if (healthTimer === null) {
              healthTimer = setInterval(async () => {
                if (!panel.isConnected) {
                  clearInterval(healthTimer);
                  healthTimer = null;
                  return;
                }

                if (!connected || healthCheckInProgress) return;

                healthCheckInProgress = true;

                try {
                  const health = await sendMessage({
                    type: "CWSL_HEALTH"
                  });

                  if (!health?.ok) {
                    throw new Error(
                      health?.error || "HTTP bridge health check failed."
                    );
                  }
                } catch (error) {
                  connected = false;
                  setStatus("WSL HTTP bridge disconnected", "#ef4444");
                  setOutput(
                    "The local WSL HTTP bridge is no longer available.\n\n" +
                    "Click \"Connect to WSL\" to reconnect."
                  );
                  connectButton.disabled = false;
                  connectButton.textContent = "Connect to WSL";
                  updateApproval();
                } finally {
                  healthCheckInProgress = false;
                }
              }, 3000);
            }
          } catch (error) {
            connected = false;
            setStatus(
              initialCheck
                ? "WSL HTTP bridge not connected"
                : "Connection failed",
              "#ef4444"
            );
            setOutput(
              initialCheck
                ? "The local WSL HTTP bridge is not available.\n\n" +
                  "Click \"Connect to WSL\" to start or reconnect it."
                : error.message
            );
            connectButton.disabled = false;
            connectButton.textContent = "Connect to WSL";
            updateApproval();
          }
        };

        connectButton.addEventListener("click", () => {
          connectToBridge();
        });

        connectToBridge({initialCheck: true});

        commandInput.addEventListener("input", updateApproval);

        clearButton.addEventListener("click", () => {
          setOutput("Output cleared.");
          latestResultText = "";
          insertButton.disabled = true;
        });

        insertButton.addEventListener("click", () => {
          if (!latestResultText) return;

          try {
            insertIntoComposer(latestResultText);
            setStatus("Result inserted into unsent ChatGPT draft", "#22c55e");
          } catch (error) {
            setStatus("Insertion failed", "#ef4444");
            setOutput(`Result insertion failed:\n${error.message}`);
          }
        });

        approveButton.addEventListener("click", async () => {
          if (!connected || busy) return;

          const operation = getOperation();

          if (!isOperationValid(operation)) {
            setOutput("Please complete the operation fields.");
            return;
          }

          busy = true;
          latestResultText = "";
          insertButton.disabled = true;
          approveButton.disabled = true;
          approveButton.textContent = "Running...";

          setOutput(
            "Approved shell command\n" +
            `Command: ${operation.command}\n` +
            `Working directory: ${operation.cwd}\n` +
            `Timeout: ${operation.timeoutMs / 1000} seconds\n\n` +
            "Waiting for API response..."
          );

          try {
            const response = await sendMessage({
              type: "CWSL_OPERATION",
              operation
            });

            if (!response?.ok) {
              throw new Error(response?.error || "Operation failed.");
            }

            latestResultText = formatResult(response.result);
            setOutput(latestResultText);
            insertButton.disabled = false;
          } catch (error) {
            setOutput(`Operation failed:\n${error.message}`);
          } finally {
            busy = false;
            approveButton.textContent = "Approve and Run";
            updateApproval();
          }
        });

        updateApproval();
        commandDetectionCleanup = startCommandDetection();
      },
      args: [html, settings]
    });

    window.close();
  } catch (error) {
    status.textContent = `Error: ${error.message}`;
  }
});
