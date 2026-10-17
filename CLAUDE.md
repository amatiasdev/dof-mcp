# dof-mcp

Typed TypeScript client and MCP server for Mexico's Diario Oficial de la Federación, built on the public SIDOF JSON API. Public repo: https://github.com/amatiasdev/dof-mcp

Personal open source project, unrelated to any company or client work. Success is measured by adoption (npm installs, GitHub stars, issues and PRs from users), not revenue.

## Commands

```bash
npm run lint       # biome check .
npm run typecheck  # tsc --noEmit (TypeScript 7)
npm test           # vitest run
npm run build      # tsc -p tsconfig.build.json -> dist/
npm run test:live  # contract tests against the live SIDOF API (not part of npm test)
```

CI (`.github/workflows/ci.yml`, Node 22 and 24) runs all four on every push and PR. Keep it green. Other workflows: `contract.yml` (nightly live test, opens an issue on failure), `release.yml` (Changesets + npm trusted publishing + MCP Registry, see RELEASING.md), `codeql.yml`, `scorecard.yml`. Actions are pinned by commit SHA.

## Layout

- `src/schema.ts`: Zod schemas for raw SIDOF payloads, normalized types, `INDICATORS` code table
- `src/client.ts`: `DofClient` (`getNotes`, `getNote`, `getIndicators`, `getIndicatorSeries`, each with a `*WithSource` variant returning provenance; no redirects, size cap, retries with jitter on network/429/5xx, TTL cache, concurrency limit), normalizers, `toSidofDate`, `officialNoteUrl`
- `src/html.ts`: `htmlToText` for note content
- `src/server.ts`: `createDofServer` (MCP tools); `src/http.ts`: `createDofHttpHandler` (stateless Streamable HTTP, Host/Origin checks, `/healthz`); `src/bin.ts`: CLI (stdio default, `--http`)
- `src/version.ts`: version reported to MCP clients; a test keeps it equal to package.json
- `src/index.ts`: public exports
- `scripts/sync-version.mjs`: copies the package.json version into `src/version.ts`, `server.json` and the lockfile (run by `npm run version-packages`)
- `test/fixtures/`: real recorded SIDOF responses; tests run against these, not hand-written mocks. `test/server.test.ts` drives the server with the official MCP client

## SIDOF API facts (verified 2026-10-17)

- The API has official documentation: https://sidof.segob.gob.mx/datos_abiertos (PDF guides and JSON samples; the PDFs are from 2016-2017 and name the `sidofqa` host, but the same paths answer on production)
- Base `https://sidof.segob.gob.mx/dof/sidof`, GET, no auth. Answers **406** to a bare `Accept: application/json`; the client sends `application/json, */*;q=0.8`
- Verified endpoints:
  - `/notas/{DD-MM-YYYY}`: daily notes (`NotasMatutinas`, `NotasVespertinas`, `NotasExtraordinarias`, `imagenesDiario`, `audioSumario`). Rows without `titulo` are section headers; `codOrgaDos` is optional
  - `/notas/nota/{codNota}`: one note with full HTML in `Nota.cadenaContenido`, plus top-level `tamanioExcesivo`. Some fields hold the **string** `"null"` (e.g. `codOrgaTres`, `tipoNota`)
  - `/notas/obtenerNotasPorDiario/{codDiario}`: notes of one issue; here absent values are real `null`
  - `/diarios/porFecha/{DD-MM-YYYY}`, `/diarios/{YYYY}`, `/diarios/obtieneDiario/{DD-MM-YYYY}/{MAT|VES}`: issue metadata
  - `/indicadores/`, `/indicadores/{DD-MM-YYYY}`, `/indicadores/{codTipo}/{ini}/{fin}`: `ListaIndicadores[{codIndicador, codTipoIndicador, fecha, valor}]`; `valor` is a string, sometimes with `%`. Types: 158 FIX, 159 UDIS, 165/166/174 TIIE 28/91/182, 175 TIIE de fondeo
  - `/documentos/doc/{codNota}` (Word) and `/documentos/pdf/{codDiario}` (issue PDF, several MB)
- **SIDOF search is broken** (`/busqueda/*` returns 0 results, `buscarNotas/*` 204 or 404). Any search must be built locally
- Field types differ between endpoints: every endpoint gets its own Zod schema, built from a recorded response
- Human link to a note: `https://dof.gob.mx/nota_detalle.php?codigo={codNota}&fecha={DD/MM/YYYY}` (no `www`: that host fails TLS). dof.gob.mx robots.txt has `Disallow: /nota_detalle.php?`, so emit it **only as a link for humans; never fetch it from code**
- Since 2012-07-05 the DOF PDF is the official edition and carries an advanced electronic signature
- Content license (https://sidof.segob.gob.mx/avisoLegal): reproduction allowed for non-profit use; commercial use needs written consent from SEGOB. Always cite the official source
- Banxico SIE (`https://www.banxico.org.mx/SieAPIRest/service/v1/`, free token) is the authoritative source for FIX/TIIE/UDIS
- Routes can still change without notice. Record new fixtures from real responses; never invent fields

## MCP facts (verified 2026-10-17)

- Current spec: **2026-07-28** (no `initialize` handshake, no sessions)
- SDK **v2**: `@modelcontextprotocol/server` 2.3.1 (not the v1 `@modelcontextprotocol/sdk`)
- HTTP transport is Streamable HTTP, stateless; `Origin` validation is mandatory. OAuth is optional and not needed for public data
- Tools: `readOnlyHint: true`, `outputSchema` plus `structuredContent`, input and upstream errors as `isError: true` with an actionable message
- MCP Registry name: `io.github.amatiasdev/dof-mcp` (`mcpName` in package.json must match `server.json`)

## Conventions

- Strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESM with `.js` import suffixes, 2-space indent, 100-char lines (biome)
- Validate at the boundary with Zod; fail loudly on unexpected shapes
- Every new endpoint gets a recorded fixture and tests for parsing, normalization and error paths
- Keep live-API calls out of the default test run; they go in `test/live/`
- User-facing changes need a changeset (`npx changeset`)
- Node.js 22+ (Node 20 is EOL)

## Roadmap (scope: v0.1)

- **F1** (done): client methods for note detail and indicators; MCP server (stdio + Streamable HTTP) with read-only tools `dof_daily_summary`, `dof_get_note`, `dof_get_indicators`
- **F2** (done in code): hardened client and provenance, pinned CI with CodeQL and Scorecard, Dependabot, SECURITY.md, nightly contract test, Changesets release pipeline with npm trusted publishing and MCP Registry publish. Still needs the owner's one-time steps in RELEASING.md (first manual npm publish, trusted publisher, `release` environment)
- **F3** (optional, after v0.1): hosted endpoint on the owner's personal AWS account (Lambda + EventBridge for nightly ingest + DynamoDB/S3) and a local search index for `dof_search_notes`

Out of scope: hosted paid service, monitoring or alerting products, RAG/embeddings, full historical backfill.
