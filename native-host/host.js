const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const BRIDGE_HOST = "127.0.0.1";
const BRIDGE_PORT = 8765;
const BRIDGE_SCRIPT = path.join(__dirname, "http-server.js");
const WSL_DISTRIBUTION = process.env.CHATGPT_WSL_DISTRIBUTION || "default";
const MAX_MESSAGE_SIZE = 1024 * 1024;

function getExtensionId() {
  const index = process.argv.indexOf("--extension-id");

  if (index === -1 || !process.argv[index + 1]) {
    throw new Error("Chrome extension ID is not configured.");
  }

  const extensionId = process.argv[index + 1];

  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error("Invalid Chrome extension ID.");
  }

  return extensionId;
}

const EXTENSION_ID = getExtensionId();

function readMessage() {
  return new Promise((resolve, reject) => {
    let header = Buffer.alloc(0);
    let body = Buffer.alloc(0);
    let expectedLength = null;

    function onData(chunk) {
      if (expectedLength === null) {
        header = Buffer.concat([header, chunk]);

        if (header.length < 4) return;

        expectedLength = header.readUInt32LE(0);

        if (expectedLength > MAX_MESSAGE_SIZE) {
          cleanup();
          reject(new Error("Message exceeds size limit."));
          return;
        }

        body = header.subarray(4);
      } else {
        body = Buffer.concat([body, chunk]);
      }

      if (expectedLength !== null && body.length >= expectedLength) {
        cleanup();

        try {
          resolve(JSON.parse(body.subarray(0, expectedLength).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      }
    }

    function onEnd() {
      cleanup();
      resolve(null);
    }

    function cleanup() {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
    }

    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
  });
}

function sendMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function isBridgeListening() {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: BRIDGE_HOST, port: BRIDGE_PORT });
    const finish = listening => {
      socket.destroy();
      resolve(listening);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function startBridge() {
  if (await isBridgeListening()) {
    return { started: false, status: "already-running" };
  }

  const child = spawn(process.execPath, [BRIDGE_SCRIPT], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      CHATGPT_EXTENSION_ID: EXTENSION_ID
    }
  });

  child.unref();

  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    if (await isBridgeListening()) {
      return { started: true, status: "ready" };
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { started: true, status: "starting" };
}

async function main() {
  const request = await readMessage();

  if (!request) return;

  if (request.action === "start_bridge") {
    const result = await startBridge();
    sendMessage({
      ok: true,
      host: "chatgpt-wsl-native-host",
      wslDistribution: WSL_DISTRIBUTION,
      ...result
    });
    return;
  }

  if (request.action === "ping") {
    sendMessage({
      ok: true,
      host: "chatgpt-wsl-native-host",
      wslDistribution: WSL_DISTRIBUTION,
      status: "ready"
    });
    return;
  }

  sendMessage({
    ok: false,
    error: "Unsupported action."
  });
}

main().catch(() => {
  process.exitCode = 1;
});
