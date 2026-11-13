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

## Open interface

Any MCP-capable agent can use Dock with no custom integration: see [docs/connect-an-agent.md](docs/connect-an-agent.md).

| Path | What |
|---|---|
| `/api/mcp` | MCP over Streamable HTTP (2026-07-28 and 2025-era clients). Tools in `src/server/mcp/tools.ts`, one table. |
| `/api/v1/openapi.json` | OpenAPI 3.1, generated from the zod schemas (`src/server/openapi.ts`), kept in sync by `openapi.test.ts`. |
| `/.well-known/api-catalog` | RFC 9727 API catalog: the entry point from the base URL. |
| `/.well-known/jwks.json` | Wholesaler keys (RFC 7517 JWK Set, Ed25519) to verify quotes and receipts offline. |
| `/.well-known/dock.json`, `/llms.txt` | Dock's manifest (its own format, not a standard) and a brief for coding agents. |

```bash
pnpm demo:mcp --url http://localhost:3000   # stock MCP client, no LLM: the milk order end to end
pnpm verify:receipt order.json --url http://localhost:3000
export DOCK_MANDATE=$(pnpm -s dev:mandate)  # dev mandate for the demo buyer
```
