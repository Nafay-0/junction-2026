"""
Driving school, step 3: serve Qwen/Qwen3-4B and the driving-school LoRA from one vLLM server on Modal, as an
OpenAI-compatible endpoint with tool calling, so the crash test runs both through Dock's own runner.

    uv run --python 3.12 --with modal==1.6.4 modal deploy ../modal/driving_school/serve.py
    # then, from web/ (key from the Modal Secret dock-school-vllm, never printed):
    OPENAI_COMPATIBLE_BASE_URL=<url>/v1 OPENAI_COMPATIBLE_API_KEY=... pnpm crash --agent model:compat:qwen3-4b --seed 101
    ... --agent model:compat:qwen3-4b-school ...
    uv run --python 3.12 --with modal==1.6.4 modal app stop dock-driving-school-serve    # stop the GPU when done

Served names: `qwen3-4b` (the base model, BEFORE) and `qwen3-4b-school` (base + adapter /vol/adapters/<ADAPTER>,
AFTER). Same server, same context length, same parsers: the only difference is the adapter.
"""

import os
import subprocess

import modal

app = modal.App("dock-driving-school-serve")
VOL = modal.Volume.from_name("dock-driving-school", create_if_missing=True)
HF_CACHE = modal.Volume.from_name("huggingface-cache", create_if_missing=True)
VLLM_CACHE = modal.Volume.from_name("vllm-cache", create_if_missing=True)
ADAPTER = os.environ.get("DOCK_SCHOOL_ADAPTER", "run1")

image = (
    modal.Image.from_registry("nvidia/cuda:12.9.0-devel-ubuntu22.04", add_python="3.12")
    .entrypoint([])
    .uv_pip_install("vllm==0.21.0", "transformers==5.8.1")
    .env({"HF_XET_HIGH_PERFORMANCE": "1", "DOCK_SCHOOL_ADAPTER": ADAPTER})
)


@app.function(
    image=image,
    gpu="H100",
    scaledown_window=10 * 60,
    timeout=60 * 60,
    secrets=[modal.Secret.from_name("dock-school-vllm")],
    volumes={"/vol": VOL, "/root/.cache/huggingface": HF_CACHE, "/root/.cache/vllm": VLLM_CACHE},
    max_containers=1,
)
@modal.concurrent(max_inputs=32)
@modal.web_server(port=8000, startup_timeout=15 * 60)
def serve():
    adapter = os.environ["DOCK_SCHOOL_ADAPTER"]
    cmd = [
        "vllm", "serve", "Qwen/Qwen3-4B",
        "--served-model-name", "qwen3-4b",
        "--host", "0.0.0.0", "--port", "8000",
        "--max-model-len", "40960",
        "--enable-lora", "--max-lora-rank", "16", "--lora-modules", f"qwen3-4b-school=/vol/adapters/{adapter}",
        "--enable-auto-tool-choice", "--tool-call-parser", "hermes", "--reasoning-parser", "qwen3",
        "--api-key", os.environ["VLLM_API_KEY"],
    ]
    subprocess.Popen(cmd)
