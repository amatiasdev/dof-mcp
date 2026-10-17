# dof-mcp

[![CI](https://github.com/amatiasdev/dof-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/amatiasdev/dof-mcp/actions/workflows/ci.yml)

Typed TypeScript client and MCP server for Mexico's **Diario Oficial de la Federación** (DOF), built on the public SIDOF JSON API, so AI agents (Claude Code, Cursor, etc.) can read official publications and indicators.

## Why

The DOF is where federal laws, decrees, tax and customs rules, and official indicators are published. Its JSON API is public, with only sparse official documentation (https://sidof.segob.gob.mx/datos_abiertos), and there is no typed client or MCP server for it on npm. This project wraps it with validation, retries and a stable, normalized shape.

## Status

`v0.0.1`, not yet on npm. The client and the MCP server work against the live API; the first npm release (v0.1) is next.

## MCP server

Three read-only tools:

| Tool | What it returns |
|---|---|
| `dof_daily_summary` | A day's publications with counts by edition and organization; filter by edition or organization |
| `dof_get_note` | One publication as plain text, paged with `offset` / `maxChars` for long notes |
| `dof_get_indicators` | FIX exchange rate, UDI and TIIE rates for a day, or a daily series of one indicator |

Every result includes an `officialUrl` on dof.gob.mx so a person can check the official publication.

From a local checkout (`npm install && npm run build`), add it to your MCP client over stdio:

```json
{
  "mcpServers": {
    "dof": { "command": "node", "args": ["/path/to/dof-mcp/dist/bin.js"] }
  }
}
```

Or serve Streamable HTTP (stateless, bound to `127.0.0.1` by default, with Host and Origin checks):

```bash
node dist/bin.js --http --port 3000   # endpoint: http://127.0.0.1:3000/mcp, probe: /healthz
```

## Client

```ts
import { DofClient } from "dof-mcp";

const dof = new DofClient();
const notes = await dof.getNotes("2026-10-16");
// [{ id: 5801377, title: "Acuerdo por el que se crea ...", date: "2026-10-16",
//    edition: "matutina", branch: "PODER EJECUTIVO",
//    organization: "SECRETARIA DE SEGURIDAD Y PROTECCION CIUDADANA", page: 4,
//    hasPdf: true, hasHtml: true }, ...]
```

## Design notes

- **Validation at the boundary.** Every response is parsed with Zod; an unexpected shape fails loudly instead of leaking `undefined` into callers.
- **Normalization.** SIDOF mixes section headers and publications in one list; only titled publications are returned, tagged by edition (matutina, vespertina, extraordinaria), with ISO dates and boolean flags.
- **Retries.** Network errors and 5xx responses are retried; 4xx responses are not.
- **Quirk handled.** SIDOF answers `406` to a bare `Accept: application/json`, so the client sends a header with a fallback.
- **Recorded fixtures.** Tests run against a real recorded response, not hand-written mocks.

## Roadmap

- [x] Typed client for daily publications, note detail and indicators (FIX, UDIS, TIIE)
- [x] MCP server (stdio + Streamable HTTP) with `dof_daily_summary`, `dof_get_note`, `dof_get_indicators`
- [ ] Hardening: host allowlist, response size limits, backoff with jitter, cache, provenance (`source_url`, `fetched_at`, `sha256`)
- [ ] v0.1 on npm with provenance, and in the MCP Registry
- [ ] Optional: hosted endpoint, local search index (`dof_search_notes`; SIDOF's own search is broken), nightly contract test against the live API

## Development

```bash
npm install
npm run lint && npm run typecheck && npm test
npm run build
```

## Disclaimer

Unofficial project, not affiliated with the Secretaría de Gobernación. Data comes from the public SIDOF API and may change without notice; always confirm against the official DOF publication.

## License

MIT
