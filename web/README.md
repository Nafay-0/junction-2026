# Dock (web)

Next.js 16 app plus the framework-free core. Everything runs locally with no API keys and no LLM.

```bash
pnpm install
pnpm test        # core + HTTP tests (vitest)
pnpm demo        # scripted buyer, in-process: the 1,000 L milk example, then 13 misbehaviour attempts
pnpm dev         # http://localhost:3000 (status page at /, API at /api/v1)
pnpm demo --url http://localhost:3000   # same script over HTTP; fills the page at /
pnpm lint && pnpm typecheck && pnpm build
```

## Layout

| Path | What |
|---|---|
| `src/core/` | Pure logic, no framework, no network, no LLM. `mandate` (buyer-signed Ed25519 JWT), `quote` (wholesaler-signed JWS), `policy` (the gate), `ledger` (hash chain), `catalog` (port + in-memory seed), `approval` (sign-off proof + notifier), `orders` (the flow + repository). |
| `src/server/` | Wiring: one in-memory runtime per process, HTTP helpers, dev fixtures (demo buyer org), in-process transport. |
| `src/app/api/v1/` | REST routes, thin wrappers over `createDock`. `GET /api/v1` lists them. |
| `src/app/page.tsx` | Functional status page. `src/app/approve/[approvalId]` is the page behind the approval link. |
| `scripts/demo.ts` | Scripted buyer agent. |

Agents send `Authorization: Mandate <jws>` and `Dock-Agent-Id: <id>`. Errors are `{ error: { code, rule, message, details } }`.
