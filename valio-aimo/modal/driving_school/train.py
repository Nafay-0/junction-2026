"""
Driving school, step 2: LoRA fine-tune of Qwen/Qwen3-4B on the crash test's reference trajectories, on one Modal GPU.

    cd web && pnpm tsx scripts/crash-sft.ts --seeds 2-21 --out ../modal/driving_school/data/train.jsonl
    uv run --python 3.12 --with modal==1.6.4 modal run ../modal/driving_school/train.py

A plain recipe (transformers + peft, bf16, gradient checkpointing, batch 1 with gradient accumulation): each example is
rendered with the model's own chat template (tools included, the format vLLM renders at serving time) and only the
assistant turns (tool calls and the final message) carry loss. The adapter goes to the Modal Volume dock-driving-school
at /adapters/<run>, with the loss log and token statistics next to it.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import modal

app = modal.App("dock-driving-school-train")
VOL = modal.Volume.from_name("dock-driving-school", create_if_missing=True)
HF_CACHE = modal.Volume.from_name("huggingface-cache", create_if_missing=True)
BASE = "Qwen/Qwen3-4B"
DATA = Path(__file__).resolve().parent / "data" / "train.jsonl"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install("torch==2.9.1", "transformers==4.57.3", "peft==0.17.1", "accelerate==1.11.0")
    .env({"HF_XET_HIGH_PERFORMANCE": "1"})
    .add_local_file(DATA, "/data/train.jsonl")
)


@app.function(image=image, gpu="H100", timeout=2 * 3600, volumes={"/vol": VOL, "/root/.cache/huggingface": HF_CACHE})
def train(run: str = "run1", epochs: int = 2, lr: float = 2e-4, rank: int = 16, max_len: int = 24576, accum: int = 8) -> dict:
    import random

    import torch
    from peft import LoraConfig, get_peft_model
    from transformers import AutoModelForCausalLM, AutoTokenizer

    t0 = time.time()
    tok = AutoTokenizer.from_pretrained(BASE)
    rows = [json.loads(line) for line in open("/data/train.jsonl")]

    # Render each conversation with the model's own template and mark the assistant spans for the loss.
    START, END = "<|im_start|>assistant\n", "<|im_end|>"
    examples, lengths, dropped = [], [], []
    for r in rows:
        msgs = []
        for m in r["messages"]:
            m = dict(m)
            for tc in m.get("tool_calls", []) or []:
                tc["function"]["arguments"] = json.loads(tc["function"]["arguments"])
            msgs.append(m)
        text = tok.apply_chat_template(msgs, tools=r["tools"], tokenize=False)
        enc = tok(text, return_offsets_mapping=True, add_special_tokens=False)
        spans, i = [], 0
        while (s := text.find(START, i)) >= 0:
            e = text.find(END, s)
            spans.append((s + len(START), e + len(END)))
            i = e
        labels = [tid if any(a <= o0 and o1 <= b for a, b in spans) else -100 for tid, (o0, o1) in zip(enc["input_ids"], enc["offset_mapping"])]
        n = len(enc["input_ids"])
        lengths.append(n)
        if n > max_len:
            dropped.append({"id": r["id"], "tokens": n})
            continue
        examples.append((enc["input_ids"], labels))
    lengths.sort()
    stats = {"examples": len(rows), "kept": len(examples), "dropped": dropped, "tokens": {"min": lengths[0], "median": lengths[len(lengths) // 2], "max": lengths[-1], "total": sum(lengths)},
             "lossTokens": sum(sum(1 for x in lab if x != -100) for _, lab in examples)}
    print(json.dumps(stats))

    model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.bfloat16, attn_implementation="sdpa").cuda()
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.enable_input_require_grads()
    model = get_peft_model(model, LoraConfig(r=rank, lora_alpha=2 * rank, lora_dropout=0.05, target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"], task_type="CAUSAL_LM"))
    model.print_trainable_parameters()
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=lr, weight_decay=0.0)
    total = epochs * len(examples) // accum
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / 10) * max(0.0, 1 - s / max(1, total)))
    log, step, rng = [], 0, random.Random(0)
    model.train()
    for epoch in range(epochs):
        order = list(range(len(examples)))
        rng.shuffle(order)
        running = []
        for k, idx in enumerate(order):
            ids, lab = examples[idx]
            ids_t = torch.tensor([ids], device="cuda")
            lab_t = torch.tensor([lab], device="cuda")
            out = model(input_ids=ids_t, labels=lab_t)
            (out.loss / accum).backward()
            running.append(out.loss.item())
            if (k + 1) % accum == 0 or k == len(order) - 1:
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step()
                sched.step()
                opt.zero_grad(set_to_none=True)
                step += 1
                mean = sum(running) / len(running)
                log.append({"epoch": epoch, "step": step, "loss": round(mean, 4), "lr": sched.get_last_lr()[0], "elapsedS": round(time.time() - t0)})
                print(json.dumps(log[-1]), flush=True)
                running = []
    out_dir = Path(f"/vol/adapters/{run}")
    out_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(out_dir)
    tok.save_pretrained(out_dir)
    summary = {"run": run, "base": BASE, "epochs": epochs, "lr": lr, "rank": rank, "accum": accum, "maxLen": max_len, "data": stats, "log": log, "seconds": round(time.time() - t0), "gpu": "H100"}
    (out_dir / "training.json").write_text(json.dumps(summary, indent=2))
    VOL.commit()
    return {k: v for k, v in summary.items() if k != "log"} | {"firstLoss": log[0]["loss"] if log else None, "lastLoss": log[-1]["loss"] if log else None}


@app.local_entrypoint()
def main(run: str = "run1", epochs: int = 2):
    result = train.remote(run=run, epochs=epochs)
    print(json.dumps(result, indent=2))
    out = Path(__file__).resolve().parent / "data" / f"training-{run}.json"
    out.write_text(json.dumps(result, indent=2) + "\n")
