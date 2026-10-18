# dof-mcp

## 0.2.2

### Patch Changes

- [#17](https://github.com/amatiasdev/dof-mcp/pull/17) [`731a419`](https://github.com/amatiasdev/dof-mcp/commit/731a419f126494b9ef6b6d6e957e3cdc774ca120) Thanks [@amatiasdev](https://github.com/amatiasdev)! - README on npm: hosted endpoint privacy notice, project badges, and links to the new documentation (`docs/`: index and full tool reference).

## 0.2.1

### Patch Changes

- [#8](https://github.com/amatiasdev/dof-mcp/pull/8) [`5b9801a`](https://github.com/amatiasdev/dof-mcp/commit/5b9801a255fba7ba36737d2609c9558a432e1f7e) Thanks [@amatiasdev](https://github.com/amatiasdev)! - Hosted endpoint: each request's log line now records the JSON-RPC method, the tool name, the client's self-reported name and version, and whether the tool returned an error. IPs and tool arguments are never logged; client-supplied labels are sanitized and truncated.

## 0.2.0

### Minor Changes

- [#4](https://github.com/amatiasdev/dof-mcp/pull/4) [`d6cbe24`](https://github.com/amatiasdev/dof-mcp/commit/d6cbe24db51077db8984472e487ef4a067ab103e) Thanks [@amatiasdev](https://github.com/amatiasdev)! - Hosted endpoint support and source citations:
  
  - `dof_get_note` returns a `citation` in the format SIDOF's legal notice requires when reproducing its content (`citeNote` is exported too)
  - `createDofHttpHandler` accepts `requiredHeader` (a shared secret a CDN adds in front of a public deployment), `maxRequestBodySize` and `maxSubscriptions`
  - `dist/lambda.js` adapts the server to AWS Lambda behind API Gateway HTTP API; it refuses to start without `DOF_ALLOWED_HOSTS` and `DOF_ORIGIN_SECRET`

## 0.1.0

### Minor Changes

- [#1](https://github.com/amatiasdev/dof-mcp/pull/1) [`eadfee3`](https://github.com/amatiasdev/dof-mcp/commit/eadfee3b12e3efeadc59c0883894b8b62651cb34) Thanks [@amatiasdev](https://github.com/amatiasdev)! - First release: MCP server for the Diario Oficial de la Federación.
  
  - Tools `dof_daily_summary`, `dof_get_note` and `dof_get_indicators` (FIX, UDIS, TIIE), over stdio or stateless Streamable HTTP
  - Client methods for note detail and indicators, with provenance (`sourceUrl`, `fetchedAt`, `sha256`, `bytes`) on every result
  - Hardened requests: no redirects, response size cap, backoff with jitter and `Retry-After`, bounded TTL cache with request de-duplication, concurrency and queue limits, real-date validation, note HTML converted to text with htmlparser2 (linear time on malformed input)
  - Requires Node.js 22 or later

### Patch Changes

- [#3](https://github.com/amatiasdev/dof-mcp/pull/3) [`362d361`](https://github.com/amatiasdev/dof-mcp/commit/362d36146e2d7b463893836042ab4b04227211c6) Thanks [@amatiasdev](https://github.com/amatiasdev)! - Pre-publish review fixes:
  
  - Unknown note ids and dates without data report "not found" (`DofNotFoundError`) instead of an upstream failure with a retry hint
  - `dof_daily_summary` and `dof_get_indicators` reject future dates with a clear message
  - `require("dof-mcp")` works on Node.js 22.12+ (`default` export condition)
  - CLI: readable errors for unknown options and busy ports; `--help` lists `-h` and `-v`
  - Network errors include the cause code (for example `ENOTFOUND`)
  - README: client setup for Claude Desktop, Cursor and Windows; license scope of DOF content
  - Security audit: note HTML nested more than 1000 levels fails fast with `HtmlTooDeepError` (htmlparser2's stack is O(depth) per tag); schema errors are summarized in a few hundred characters instead of serializing every issue; SIDOF dates are validated before they reach official URLs; only real network failures are reported as "could not reach SIDOF"
