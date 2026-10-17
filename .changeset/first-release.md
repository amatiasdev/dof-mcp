---
"dof-mcp": minor
---

First release: MCP server for the Diario Oficial de la Federación.

- Tools `dof_daily_summary`, `dof_get_note` and `dof_get_indicators` (FIX, UDIS, TIIE), over stdio or stateless Streamable HTTP
- Client methods for note detail and indicators, with provenance (`sourceUrl`, `fetchedAt`, `sha256`, `bytes`) on every result
- Hardened requests: no redirects, response size cap, backoff with jitter and `Retry-After`, bounded TTL cache with request de-duplication, concurrency and queue limits, real-date validation, linear-time HTML conversion
- Requires Node.js 22 or later
