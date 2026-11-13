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
## Phone approval (passkeys)

`/screen` shows a QR code for `/join`. Scanning it creates a demo kitchen (own buyer org key, mandate with a €500
per-order limit, agent) and makes the phone its approver with a passkey (one tap, Face ID or fingerprint, no typing).
`/approver` waits for requests over server-sent events and opens `/approve/[id]` when one arrives. Approving is a
passkey assertion whose challenge is derived from the order's digest, so it cannot be moved to another or edited order.

```bash
pnpm e2e        # build, start on :3107, run the flow in Chromium with a virtual authenticator
```

Passkeys need https (or `http://localhost`). For phones, run behind an HTTPS tunnel or a single-instance deployment;
see `.env.example` for `DOCK_PUBLIC_URL`, `DOCK_WEBAUTHN_*` and the demo-only `DOCK_DEMO_TAP_APPROVAL`.
Code: `src/core/approval.ts` (digest, proofs), `src/core/passkeys.ts`, `src/core/events.ts`, `src/server/sandboxes.ts`,
`src/server/approval-links.ts` (`approvalLink(approvalId)` for other screens).
