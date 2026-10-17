# dof-mcp

[![CI](https://github.com/amatiasdev/dof-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/amatiasdev/dof-mcp/actions/workflows/ci.yml)

Typed TypeScript client for Mexico's **Diario Oficial de la Federación** (DOF), built on the public SIDOF JSON API, with an MCP server on the roadmap so AI agents (Claude Code, Cursor, etc.) can search official publications.

## Why

The DOF is where federal laws, decrees, tax and customs rules, and official indicators are published. Its JSON API is public but undocumented, and there is no typed client or MCP server for it on npm. This project wraps it with validation, retries and a stable, normalized shape.

## Status

`v0.0.1`: the client works against the live API. The MCP server is next.

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

- [x] Typed client for daily publications
- [ ] MCP server (stdio + HTTP) with `search_notes`, `get_note`, `daily_summary` tools, paginated and summarized for agent context windows
- [ ] Indicators published in the DOF (FIX exchange rate, UDIS, TIIE)
- [ ] Scheduled contract test against the live API to detect breaking changes
- [ ] npm release with provenance

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
