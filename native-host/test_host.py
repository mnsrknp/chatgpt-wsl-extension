import json
import os
import struct
import subprocess

host = os.environ.get("CHATGPT_WSL_HOST_PATH")
if not host:
    raise SystemExit(
        "Set CHATGPT_WSL_HOST_PATH to the Windows-accessible path of native-host/host.js."
    )

node_command = os.environ.get("CHATGPT_NODE_COMMAND", "node")

request = json.dumps({"action": "ping"}).encode("utf-8")
message = struct.pack("<I", len(request)) + request

result = subprocess.run(
    [node_command, host],
    input=message,
    capture_output=True,
    timeout=10,
)

print("Exit code:", result.returncode)
print("Stderr:", result.stderr.decode(errors="replace"))

if len(result.stdout) >= 4:
    length = struct.unpack("<I", result.stdout[:4])[0]
    response = result.stdout[4:4 + length]
    print("Response:", response.decode("utf-8"))
else:
    print("No valid Native Messaging response frame.")
    print("Raw stdout:", repr(result.stdout))
