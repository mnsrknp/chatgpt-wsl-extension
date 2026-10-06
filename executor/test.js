const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  executeOperation,
  WORKSPACE
} = require("./index");

console.log("Running executor security tests...\n");

// Test 1: Workspace listing
const listing = executeOperation({
  action: "list_directory",
  path: "."
});

assert.strictEqual(listing.workspace, WORKSPACE);
assert.ok(Array.isArray(listing.entries));

console.log("PASS: Workspace directory listing");

// Test 2: Read an existing project file
const manifest = executeOperation({
  action: "read_file",
  path: "extension/manifest.json"
});

assert.ok(manifest.content.includes("manifest_version"));
assert.ok(manifest.size > 0);

console.log("PASS: Read permitted project file");

// Test 3: Reject access outside workspace
assert.throws(
  () => executeOperation({
    action: "read_file",
    path: "/etc/passwd"
  }),
  /outside the approved workspace/
);

console.log("PASS: Reject external filesystem access");

// Test 4: Reject blocked .git directory
assert.throws(
  () => executeOperation({
    action: "list_directory",
    path: ".git"
  }),
  /blocked/
);

console.log("PASS: Reject blocked directory");

// Test 5: Execute a normal shell command
const execution = executeOperation({
  action: "execute",
  command: "printf 'hello\\n' && printf 'world\\n'",
  cwd: ".",
  timeoutMs: 10000
});

assert.strictEqual(execution.action, "execute");
assert.strictEqual(execution.exitCode, 0);
assert.strictEqual(execution.timedOut, false);
assert.strictEqual(execution.stdout, "hello"+String.fromCharCode(10)+"world"+String.fromCharCode(10));
assert.strictEqual(execution.stderr, "");
assert.strictEqual(execution.cwd, ".");

console.log("PASS: Execute Bash shell command with &&");

// Test 6: Reject an invalid shell timeout
assert.throws(
  () => executeOperation({
    action: "execute",
    command: "printf 'test\\n'",
    cwd: ".",
    timeoutMs: 500
  }),
  /Timeout must be between/
);

console.log("PASS: Reject invalid shell timeout");

// Test 7: Reject invalid operation
assert.throws(
  () => executeOperation({
    action: "delete_file",
    path: "extension/manifest.json"
  }),
  /not permitted/
);

console.log("PASS: Reject unsupported operation");

console.log("\nAll executor security tests passed.");
