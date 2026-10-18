# dof-mcp

[![CI](https://github.com/amatiasdev/dof-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/amatiasdev/dof-mcp/actions/workflows/ci.yml)
[![Contract](https://github.com/amatiasdev/dof-mcp/actions/workflows/contract.yml/badge.svg)](https://github.com/amatiasdev/dof-mcp/actions/workflows/contract.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/amatiasdev/dof-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/amatiasdev/dof-mcp)

MCP server and typed TypeScript client for Mexico's **Diario Oficial de la Federación** (DOF), built on the public SIDOF JSON API, so AI agents (Claude Code, Claude Desktop, Cursor, etc.) can read official publications and financial indicators.

## Why

The DOF is where federal laws, decrees, tax and customs rules, and official indicators are published. Its JSON API is public, with only sparse official documentation (https://sidof.segob.gob.mx/datos_abiertos), and there is no typed client or MCP server for it on npm. This project wraps it with validation, provenance and a stable, normalized shape.

## MCP server

Three read-only tools:

| Tool | What it returns |
|---|---|
| `dof_daily_summary` | A day's publications with counts by edition and organization; filter by edition or organization |
| `dof_get_note` | One publication as plain text, paged with `offset` / `maxChars` for long notes |
| `dof_get_indicators` | FIX exchange rate, UDI and TIIE rates for a day, or a daily series of one indicator |

Every result includes:

- `officialUrl`: the publication on dof.gob.mx, so a person can check the official text
- `provenance`: the SIDOF URL the data came from, when it was fetched (UTC) and a SHA-256 of the raw response

### Install

Requires Node.js 22 or later. The server runs over stdio; add it to your MCP client:

```json
{
  "mcpServers": {
    "dof": { "command": "npx", "args": ["-y", "dof-mcp"] }
  }
}
```

- **Claude Desktop:** Settings → Developer → Edit Config, which opens `claude_desktop_config.json` (`%APPDATA%\Claude\` on Windows, `~/Library/Application Support/Claude/` on macOS).
- **Cursor:** `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` for every project.
- **Claude Code:** `claude mcp add dof -- npx -y dof-mcp`
- **Windows:** if your client cannot start `npx` directly, use `"command": "cmd", "args": ["/c", "npx", "-y", "dof-mcp"]`.

### Hosted endpoint (no install)

A public instance runs at **`https://mcp.aldomatias.com/mcp`** (Streamable HTTP, no authentication, rate limited). Use it from clients that accept remote MCP servers, such as custom connectors in Claude, or:

```bash
claude mcp add --transport http dof https://mcp.aldomatias.com/mcp
```

It serves the same tools and the same release as the npm package. It is a free, best-effort service with no SLA; for heavy use, run the package yourself.

### Streamable HTTP

```bash
npx dof-mcp --http --port 3000   # endpoint http://127.0.0.1:3000/mcp, probe /healthz
```

The HTTP transport is stateless, binds to `127.0.0.1` and validates the `Host` and `Origin` headers (`--allowed-host <name>` adds hostnames). It has no authentication or rate limiting: to expose it beyond localhost, put it behind a reverse proxy that adds them. See [SECURITY.md](SECURITY.md).

## Client

The package is ESM. `import` works everywhere; `require("dof-mcp")` works on Node.js 22.12 and later (`require(esm)`).

```ts
import { DofClient } from "dof-mcp";

const dof = new DofClient();

const notes = await dof.getNotes("2026-10-16");
// [{ id: 5801377, title: "Acuerdo por el que se crea ...", date: "2026-10-16",
//    edition: "matutina", branch: "PODER EJECUTIVO",
//    organization: "SECRETARIA DE SEGURIDAD Y PROTECCION CIUDADANA", page: 4,
//    hasPdf: true, hasHtml: true,
//    officialUrl: "https://dof.gob.mx/nota_detalle.php?codigo=5801377&fecha=16/10/2026" }, ...]

const note = await dof.getNote(5801457); // full text as plain text
const fix = await dof.getIndicatorSeries("fix", "2026-10-01", "2026-10-16");

const { data, source } = await dof.getNotesWithSource("2026-10-16");
// source: { sourceUrl, fetchedAt, sha256, bytes }
```

Options (all optional):

| Option | Default | |
|---|---|---|
| `timeoutMs` | `15000` | Per-request timeout |
| `retries` | `2` | Retries for network errors, 429 and 5xx, with exponential backoff and full jitter; honors `Retry-After` up to 30 s |
| `maxResponseBytes` | 10 MiB | Larger responses are rejected unparsed |
| `cacheTtlMs` | 10 min | In-memory cache; identical concurrent requests share one fetch. `0` disables |
| `cacheMaxEntries` | `256` | LRU bound |
| `maxCacheableBytes` | 512 KiB | Larger responses are returned but not cached |
| `maxConcurrency` | `4` | Requests in flight to SIDOF at once |
| `maxQueue` | `64` | Requests waiting for a slot; beyond it they fail fast with `DofQueueFullError` |

## Design notes

- **Validation at the boundary.** Every response is parsed with Zod; an unexpected shape fails loudly instead of leaking `undefined` into callers.
- **Normalization.** SIDOF mixes section headers and publications in one list and writes some missing values as the string `"null"`; the client returns titled publications only, with ISO dates, booleans and plain-text content.
- **Polite to the source.** Identifying `User-Agent`, concurrency limit, cache, no redirects. SIDOF answers `406` to a bare `Accept: application/json`, so the client sends a header with a fallback.
- **Recorded fixtures.** Tests run against real recorded responses; a nightly contract test checks the live API still matches.

## Roadmap

- [x] Typed client for daily publications, note detail and indicators (FIX, UDIS, TIIE)
- [x] MCP server (stdio + Streamable HTTP) with `dof_daily_summary`, `dof_get_note`, `dof_get_indicators`
- [x] Hardening: size limits, backoff with jitter, cache, provenance; nightly contract test
- [x] Release pipeline: npm trusted publishing with provenance, MCP Registry
- [ ] Optional: hosted endpoint, local search index (`dof_search_notes`; SIDOF's own search is broken)

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) and [RELEASING.md](RELEASING.md).

```bash
npm install
npm run lint && npm run typecheck && npm test && npm run build
npm run test:live   # contract tests against the live API
```

## Disclaimer

Unofficial project, not affiliated with the Secretaría de Gobernación. Data comes from the public SIDOF API and may change without notice. The text this package returns is a plain-text conversion, not the official edition: the official DOF is the signed PDF on dof.gob.mx, so always confirm against it.

The MIT license covers this code, not DOF content. SIDOF's [legal notice](https://sidof.segob.gob.mx/avisoLegal) allows reproducing its content for non-commercial purposes when the source is cited; commercial use requires written consent from the Secretaría de Gobernación. If you republish content obtained with this package, cite the Diario Oficial de la Federación as the source.

## License

MIT
