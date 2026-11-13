"""
Create the Modal Secrets the crash-test Sandboxes use, one per model provider, from web/.env.local.

    pnpm crash:modal:secrets            (uv run --with modal python ../modal/make_secrets.py)

Each Sandbox gets only its own provider's key: an Anthropic episode cannot read the OpenAI key. Values are read
from the file and sent to Modal; nothing is printed except the names of the Secrets and of the variables in them.
An existing Secret is replaced.
"""

from __future__ import annotations

from pathlib import Path

import modal

ENV_FILE = Path(__file__).resolve().parent.parent / "web" / ".env.local"
SECRETS = {
    "dock-crash-anthropic": ["ANTHROPIC_API_KEY"],
    "dock-crash-openai": ["OPENAI_API_KEY"],
    "dock-crash-google": ["GEMINI_API_KEY"],
    "dock-crash-featherless": ["FEATHERLESS_API_KEY"],
}


def read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[k.strip().removeprefix("export ").strip()] = v
    return out


def main() -> None:
    env = read_env(ENV_FILE)
    for name, keys in SECRETS.items():
        values = {k: env[k] for k in keys if env.get(k)}
        if not values:
            print(f"{name}: skipped (no {', '.join(keys)} in {ENV_FILE.name})")
            continue
        try:
            modal.Secret.objects.delete(name)
        except Exception:
            pass
        modal.Secret.objects.create(name, values)
        print(f"{name}: created with {', '.join(values)}")


if __name__ == "__main__":
    main()
