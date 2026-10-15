"use strict";

const API_BASE = "http://127.0.0.1:8765";

const ALLOWED_ACTIONS = new Set([
  "list_directory",
  "read_file",
  "execute"
]);

const REQUEST_TIMEOUT_MS = 135_000;
const NATIVE_HOST_NAME = "com.chatgpt.wsl_terminal";
const BRIDGE_START_TIMEOUT_MS = 10_000;

async function checkBridgeHealth() {
  const response = await fetch(`${API_BASE}/health`, {
    method: "GET",
    cache: "no-store"
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

async function ensureBridge() {
  try {
    return await checkBridgeHealth();
  } catch (initialError) {
    let startupError = null;

    try {
      await startBridge();
    } catch (error) {
      startupError = error;
    }

    const deadline = Date.now() + 10000;
    let lastError = startupError || initialError;

    while (Date.now() < deadline) {
      try {
        return await checkBridgeHealth();
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }

    const detail = startupError
      ? `Native startup: ${startupError.message}; HTTP health: ${lastError.message}`
      : lastError.message;

    throw new Error(`HTTP bridge did not become ready: ${detail}`);
  }
}

function startBridge() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      port.disconnect();
      reject(new Error("Native bridge startup timed out."));
    }, BRIDGE_START_TIMEOUT_MS);

    port.onMessage.addListener(message => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port.disconnect();

      if (!message?.ok) {
        reject(new Error(message?.error || "Native bridge startup failed."));
        return;
      }

      resolve(message);
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(
        chrome.runtime.lastError?.message ||
        "Native Messaging host disconnected before startup completed."
      ));
    });

    port.postMessage({ action: "start_bridge" });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CWSL_HEALTH") {
    checkBridgeHealth()
      .then(data => sendResponse(data))
      .catch(error => {
        sendResponse({
          ok: false,
          error: `HTTP bridge connection failed: ${error.message}`
        });
      });

    return true;
  }

  if (message?.type === "CWSL_PING") {
    ensureBridge()
      .then(data => sendResponse(data))
      .catch(error => {
        sendResponse({
          ok: false,
          error: `HTTP bridge connection failed: ${error.message}`
        });
      });

    return true;
  }

  if (message?.type === "CWSL_OPERATION") {
    const operation = message.operation;

    if (!operation || !ALLOWED_ACTIONS.has(operation.action)) {
      sendResponse({
        ok: false,
        error: "Operation is not permitted."
      });
      return false;
    }

    if (operation.action === "execute") {
      if (
        typeof operation.command !== "string" ||
        !operation.command.trim()
      ) {
        sendResponse({
          ok: false,
          error: "Command must be a non-empty string."
        });
        return false;
      }

      if (typeof operation.cwd !== "string" || !operation.cwd.trim()) {
        sendResponse({
          ok: false,
          error: "A workspace-relative working directory is required."
        });
        return false;
      }

      if (
        !Number.isInteger(operation.timeoutMs) ||
        operation.timeoutMs < 1000 ||
        operation.timeoutMs > 120000
      ) {
        sendResponse({
          ok: false,
          error: "Timeout must be between 1000 and 120000 milliseconds."
        });
        return false;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

    fetch(`${API_BASE}/api/operation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify(operation)
    })
      .then(async response => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }

        sendResponse(data);
      })
      .catch(error => {
        sendResponse({
          ok: false,
          error: error.name === "AbortError"
            ? "HTTP operation timed out."
            : `HTTP operation failed: ${error.message}`
        });
      })
      .finally(() => clearTimeout(timer));

    return true;
  }

  return false;
});
