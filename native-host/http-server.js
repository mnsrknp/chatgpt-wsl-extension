"use strict";

const http = require("node:http");
const { executeOperation, WORKSPACE } = require("../executor");

const HOST = "127.0.0.1";
const PORT = 8765;
const EXTENSION_ID = process.env.CHATGPT_EXTENSION_ID;

if (!EXTENSION_ID || !/^[a-p]{32}$/.test(EXTENSION_ID)) {
  throw new Error(
    "CHATGPT_EXTENSION_ID must be a valid 32-character Chrome extension ID."
  );
}

const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

const MAX_BODY_SIZE = 64 * 1024;

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });

  res.end(body);
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;

  if (origin && origin !== EXTENSION_ORIGIN) {
    sendJson(res, 403, {
      ok: false,
      error: "Origin not permitted."
    });
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", EXTENSION_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "chatgpt-wsl-http-bridge",
      status: "ready",
      workspace: WORKSPACE
    });
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/operation") {
    sendJson(res, 404, {
      ok: false,
      error: "Route not found."
    });
    return;
  }

  let body = "";
  let rejected = false;

  req.setEncoding("utf8");

  req.on("data", chunk => {
    if (rejected) return;

    body += chunk;

    if (Buffer.byteLength(body, "utf8") > MAX_BODY_SIZE) {
      rejected = true;
      sendJson(res, 413, {
        ok: false,
        error: "Request body exceeds the size limit."
      });
      req.destroy();
    }
  });

  req.on("end", () => {
    if (rejected) return;

    try {
      const request = JSON.parse(body);
      const result = executeOperation(request);

      sendJson(res, 200, {
        ok: true,
        result
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message || "Operation failed."
      });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`HTTP bridge listening on http://${HOST}:${PORT}`);
  console.log(`Approved workspace: ${WORKSPACE}`);
});

server.on("error", error => {
  console.error("HTTP bridge error:", error.message);
  process.exitCode = 1;
});
