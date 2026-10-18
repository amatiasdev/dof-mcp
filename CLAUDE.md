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
- `src/html.ts`: `htmlToText` for note content, built on the htmlparser2 tokenizer (no regex over HTML)
- `src/server.ts`: `createDofServer` (MCP tools); `src/http.ts`: `createDofHttpHandler` (stateless Streamable HTTP, Host/Origin checks, `/healthz`); `src/bin.ts`: CLI (stdio default, `--http`); `src/lambda.ts`: AWS Lambda adapter for the hosted endpoint (not exported from the index)
- `infra/`: Terraform for the hosted endpoint (`bootstrap/` once, `app/` for Lambda, API Gateway, ACM, budget); runbook in `infra/README.md`
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

## Hosted endpoint (https://mcp.aldomatias.com/mcp)

- The owner's personal AWS account (SSO profile `personal`), region `mx-central-1`. Its ID lives only in the git-ignored `infra/*/terraform.tfvars` and `infra/app/backend.hcl`; never commit it. Never deploy to any other account: the default CLI profile on this machine points elsewhere, and Terraform pins `allowed_account_ids`
- Cloudflare (zone aldomatias.com, free plan) proxies `mcp`, enforces Full (strict) TLS and a per-IP rate limit, and adds the `x-dof-origin-secret` header; the Lambda refuses requests without it
- Hard caps: API Gateway throttling 5 rps / burst 10 and Lambda reserved concurrency 3. Budget alerts at $5 and $15 to contacto@aldomatias.com
- Never print or paste the origin secret; rotate it with `terraform apply -replace=random_password.origin_secret` and update the Cloudflare rule from the clipboard
- Releases deploy new code automatically (`build-lambda` without AWS access, `deploy-lambda` with OIDC); infrastructure changes go through the owner's `terraform apply`

## Roadmap

- **v0.1** (released 2026-10-18): MCP server and client, hardening, provenance, release pipeline, MCP Registry
- **Hosted endpoint** (live since 2026-10-18): `https://mcp.aldomatias.com/mcp`, verified end to end with modern and legacy (SDK v1) clients; requests that bypass Cloudflare get 403
- **Later, optional:** local search index for `dof_search_notes` (SIDOF's search is broken), Banxico SIE indicators, PDF signature verification

Out of scope: hosted paid service, monitoring or alerting products, RAG/embeddings, full historical backfill.
