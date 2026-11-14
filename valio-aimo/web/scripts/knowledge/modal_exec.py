"""Run knowledge-build model calls as parallel Modal jobs.

    modal run scripts/knowledge/modal_exec.py --infile <specs.jsonl> --outfile <answers.jsonl>

Called by `pnpm knowledge:build --executor modal`; not meant to be run by hand. Each input line is
{"key": <sha256 of the spec>, "spec": {model, effort, system, user, schema, schemaName, maxOutputTokens}}, the
same spec the in-process executor sends through the AI SDK. The lines are split into chunks, each chunk runs in
its own container with a small thread pool, and every answer comes back as one output line with the parsed JSON
output and token counts. The TypeScript side validates the output and writes it into the on-disk cache, so a
failed or missing answer is simply retried locally.

Only OpenAI models are wired here (the build's chosen model). The API key is read from the local environment at
launch and handed to the containers as an ephemeral Modal secret; it is never printed or written to disk.
"""

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

import modal

app = modal.App("dock-knowledge-build")
image = modal.Image.debian_slim(python_version="3.12").pip_install("openai==2.14.0")
secret = modal.Secret.from_dict({"OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY", "")})

THREADS = 12


def _call(item):
    from openai import OpenAI, APIStatusError, APIConnectionError, RateLimitError

    client = OpenAI(max_retries=0, timeout=180)
    spec = item["spec"]
    provider, _, model = spec["model"].partition(":")
    if provider != "openai":
        return {"key": item["key"], "error": f"provider {provider} is not wired on Modal"}
    body = dict(
        model=model,
        instructions=spec["system"],
        input=spec["user"],
        max_output_tokens=spec["maxOutputTokens"],
        text={"format": {"type": "json_schema", "name": spec["schemaName"], "schema": spec["schema"], "strict": True}},
    )
    body["reasoning"] = {"effort": "none" if spec["effort"] == "off" else "low"}
    t0 = time.time()
    for attempt in range(7):
        try:
            r = client.responses.create(**body)
            out = json.loads(r.output_text)
            u = r.usage
            return {
                "key": item["key"],
                "model": spec["model"],
                "output": out,
                "tokens": {
                    "input": u.input_tokens,
                    "output": u.output_tokens,
                    "cachedInput": getattr(u.input_tokens_details, "cached_tokens", 0) or 0,
                    "reasoning": getattr(u.output_tokens_details, "reasoning_tokens", 0) or 0,
                },
                "ms": int((time.time() - t0) * 1000),
                "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        except (RateLimitError, APIConnectionError) as e:
            err = type(e).__name__
        except APIStatusError as e:
            if e.status_code < 500 and e.status_code not in (408, 409, 429):
                return {"key": item["key"], "error": f"HTTP {e.status_code}"}
            err = f"HTTP {e.status_code}"
        except (json.JSONDecodeError, ValueError) as e:
            return {"key": item["key"], "error": f"unparseable output: {type(e).__name__}"}
        time.sleep(min(60, 2 * 2**attempt))
    return {"key": item["key"], "error": f"gave up after retries ({err})"}


@app.function(image=image, secrets=[secret], timeout=1800, max_containers=40)
def run_chunk(items):
    with ThreadPoolExecutor(THREADS) as pool:
        return list(pool.map(_call, items))


@app.local_entrypoint()
def main(infile: str, outfile: str, chunk: int = 24):
    items = [json.loads(line) for line in open(infile) if line.strip()]
    chunks = [items[i : i + chunk] for i in range(0, len(items), chunk)]
    t0 = time.time()
    print(f"modal: {len(items)} calls in {len(chunks)} chunks, {THREADS} threads per container")
    done = 0
    failed = 0
    with open(outfile, "w") as f:
        for answers in run_chunk.map(chunks):
            for a in answers:
                failed += 1 if "error" in a else 0
                f.write(json.dumps(a) + "\n")
            done += len(answers)
            print(f"modal: {done}/{len(items)} answered, {failed} failed, {int(time.time() - t0)} s")
    print(f"modal: finished in {int(time.time() - t0)} s")
