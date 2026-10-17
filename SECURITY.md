# Security policy

## Supported versions

Only the latest minor release on npm receives fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on
https://github.com/amatiasdev/dof-mcp. Do not open a public issue.

You can expect an acknowledgement within 7 days. Fixes are released as a patch version with a
GitHub security advisory.

## Security model

- **Read-only.** Every tool only reads public data from the SIDOF API. There are no write tools,
  no credentials and no user data.
- **Fixed upstream.** Requests go only to the configured SIDOF base URL; tool inputs never choose
  the host. Redirects are rejected, responses are size-capped and validated with Zod.
- **Untrusted content.** Publication text is government data returned as tool output. MCP clients
  should treat it as data, never as instructions. `htmlToText` and the `text` field are plain
  text, not sanitized HTML: they can contain `<` and `>`, so escape them before rendering as HTML.
- **HTTP transport.** `--http` binds to `127.0.0.1` and validates `Host` (failing closed when it
  is missing) and `Origin`. Those checks guard against DNS rebinding and cross-site requests; they
  are not access control. There is no authentication or rate limiting, so if you expose it beyond
  localhost, put it behind a reverse proxy that adds them (the CLI warns when you bind elsewhere).
- **Bounded resources.** Responses are capped at 10 MiB, only responses up to 512 KiB are cached
  (256 entries), at most 4 requests run against SIDOF at once and at most 64 wait; beyond that,
  requests fail fast. Note HTML is converted to text in linear time.
- **Release jobs.** Dependencies are installed with `--ignore-scripts` in every release job, so a
  compromised dependency cannot run code where an npm OIDC token can be minted.
- **Provenance, not authenticity.** Each result carries the SIDOF URL, fetch time and a SHA-256
  of the raw response. That proves what SIDOF returned and when, not that it matches the official
  publication. The official edition is the signed PDF on dof.gob.mx.
- **Supply chain.** Releases are published from GitHub Actions with npm trusted publishing and
  provenance; workflow actions are pinned by commit SHA.
