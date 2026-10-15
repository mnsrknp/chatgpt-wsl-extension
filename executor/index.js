const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const WORKSPACE = fs.realpathSync(
  process.env.CHATGPT_WSL_WORKSPACE ||
    path.resolve(__dirname, "..")
);

const MAX_FILE_SIZE = 256 * 1024;
const MAX_OUTPUT_SIZE = 64 * 1024;
const MAX_DIRECTORY_ENTRIES = 200;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;

const BLOCKED_NAMES = new Set([
  ".git",
  ".env",
  ".ssh",
  "node_modules",
  "__pycache__"
]);

function isInsideWorkspace(target) {
  const relative = path.relative(WORKSPACE, target);

  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function resolveWorkspacePath(input = ".") {
  if (typeof input !== "string" || input.length > 1024) {
    throw new Error("Invalid path.");
  }

  if (input.includes("\0")) {
    throw new Error("Invalid path.");
  }

  const requested = path.resolve(WORKSPACE, input);

  if (!isInsideWorkspace(requested)) {
    throw new Error("Path is outside the approved workspace.");
  }

  let current = WORKSPACE;

  const relative = path.relative(WORKSPACE, requested);
  const parts = relative ? relative.split(path.sep) : [];

  for (const part of parts) {
    if (BLOCKED_NAMES.has(part)) {
      throw new Error("Access to this path is blocked.");
    }

    current = path.join(current, part);

    if (!fs.existsSync(current)) {
      throw new Error("Path does not exist.");
    }

    const real = fs.realpathSync(current);

    if (!isInsideWorkspace(real)) {
      throw new Error("Symlink points outside the approved workspace.");
    }
  }

  return fs.realpathSync(requested);
}

function listDirectory(input = ".") {
  const target = resolveWorkspacePath(input);
  const stat = fs.statSync(target);

  if (!stat.isDirectory()) {
    throw new Error("Requested path is not a directory.");
  }

  const entries = fs.readdirSync(target, {
    withFileTypes: true
  });

  const results = entries
    .filter(entry => !BLOCKED_NAMES.has(entry.name))
    .slice(0, MAX_DIRECTORY_ENTRIES)
    .map(entry => ({
      name: entry.name,
      type: entry.isDirectory()
        ? "directory"
        : entry.isFile()
          ? "file"
          : entry.isSymbolicLink()
            ? "symlink"
            : "other"
    }));

  return {
    workspace: WORKSPACE,
    path: path.relative(WORKSPACE, target) || ".",
    entries: results,
    truncated: entries.length > MAX_DIRECTORY_ENTRIES
  };
}

function readTextFile(input) {
  const target = resolveWorkspacePath(input);
  const stat = fs.statSync(target);

  if (!stat.isFile()) {
    throw new Error("Requested path is not a regular file.");
  }

  if (stat.size > MAX_FILE_SIZE) {
    throw new Error("File exceeds the 256 KB read limit.");
  }

  const buffer = fs.readFileSync(target);

  if (buffer.includes(0)) {
    throw new Error("Binary files are not permitted.");
  }

  const content = buffer.toString("utf8");

  if (Buffer.byteLength(content, "utf8") > MAX_OUTPUT_SIZE) {
    throw new Error("File exceeds the output limit.");
  }

  return {
    workspace: WORKSPACE,
    path: path.relative(WORKSPACE, target),
    size: stat.size,
    content
  };
}

function executeShellCommand(request) {
  if (typeof request.command !== "string") {
    throw new Error("Command must be a string.");
  }

  const command = request.command.trim();

  if (!command) {
    throw new Error("Command must be non-empty.");
  }

  const cwd = resolveWorkspacePath(request.cwd ?? ".");

  const timeoutMs = request.timeoutMs;

  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `Timeout must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} milliseconds.`
    );
  }

  const result = spawnSync(
    "/usr/bin/bash",
    ["-c", command],
    {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_SIZE
    }
  );

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";

  const truncated =
    Buffer.byteLength(stdout, "utf8") > MAX_OUTPUT_SIZE ||
    Buffer.byteLength(stderr, "utf8") > MAX_OUTPUT_SIZE ||
    result.error?.code === "ENOBUFS";

  const timedOut =
    result.error?.code === "ETIMEDOUT" ||
    result.signal === "SIGTERM";

  return {
    action: "execute",
    command,
    cwd: path.relative(WORKSPACE, cwd) || ".",
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal || null,
    timedOut,
    truncated,
    stdout: stdout.slice(0, MAX_OUTPUT_SIZE),
    stderr: stderr.slice(0, MAX_OUTPUT_SIZE)
  };
}

function executeOperation(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Invalid operation request.");
  }

  switch (request.action) {
    case "list_directory":
      return listDirectory(request.path);

    case "read_file":
      return readTextFile(request.path);

    case "execute":
      return executeShellCommand(request);

    default:
      throw new Error("Operation is not permitted.");
  }
}

module.exports = {
  executeOperation,
  WORKSPACE
};
