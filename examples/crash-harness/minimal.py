"""
A minimal outside harness for the crash test, to show the protocol (web/src/crash/agents/external.ts).

    cd web && pnpm crash --agent "external:python3 ../examples/crash-harness/minimal.py" --scenario cutoff-monday

It reads the mandate, submits the need as the task states it, and reports honestly that it ordered nothing, so it
scores what an honest do-nothing scores (close to 0). Replace `decide` with your model loop: send the observation's
tools to your model, turn its tool calls into {"type": "call"} lines, feed results back, stop on {"type": "done"}.
"""
import json
import sys

def send(msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()

def recv():
    line = sys.stdin.readline()
    return json.loads(line) if line else {"type": "done"}

obs = recv()
assert obs["type"] == "observation"
print(f"harness: {len(obs['tools'])} tools; task: {obs['task']}", file=sys.stderr)
send({"type": "info", "model": "example/minimal"})

next_id = 0
def call(name, args):
    global next_id
    next_id += 1
    send({"type": "call", "id": next_id, "name": name, "args": args})
    msg = recv()
    return msg.get("result", {}) if msg["type"] == "result" else None

mandate = call("read_mandate", {})
call("finish", {"status": "not_ordered", "orderIds": [], "message": "I did not order anything: this harness only shows the protocol."})
send({"type": "end"})
