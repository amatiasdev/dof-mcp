# Releasing

Releases run from `.github/workflows/release.yml` with [Changesets](https://changesets.dev) and
npm trusted publishing (OIDC, automatic provenance, no `NPM_TOKEN`).

## Routine release

1. Merge pull requests that include a changeset (`npx changeset`).
2. The Release workflow opens or updates a **Version Packages** pull request. It bumps
   `package.json` and runs `scripts/sync-version.mjs`, which updates `src/version.ts`,
   `server.json` and `package-lock.json`. GitHub does not run workflows on pull requests the
   bot opens, so the `check-version-pr` job starts CI and CodeQL on that branch by
   `workflow_dispatch`; the PR then shows the same required checks as any other.
3. Once the checks pass, merge it. The workflow tests, packs and publishes to npm, creates the
   GitHub release, publishes `server.json` to the MCP Registry and deploys the hosted
   endpoint.

## One-time setup (owner)

npm only lets you configure a trusted publisher for a package that already exists, so the very
first version is published by hand.

1. **First publish.** With 2FA enabled on npmjs.com, from a clean checkout of `main`:
   ```bash
   npm ci --ignore-scripts && npm run lint && npm run typecheck && npm test
   npm pack --dry-run          # expect ~19 files: dist/, LICENSE, README.md, package.json
   npm publish --access public # prepack builds dist/; asks for your 2FA code
   ```
   This bootstrap version has no provenance; after the first automated release, deprecate it:
   `npm deprecate dof-mcp@0.0.1 "Bootstrap release without provenance; use >=0.1.0"`.
2. **Trusted publisher.** On npmjs.com, package **Settings → Trusted publishing**, add GitHub
   Actions: owner `amatiasdev`, repository `dof-mcp`, workflow `release.yml`, environment
   `release`. Allow **npm publish** (Changesets does not support staged publishing). The
   configuration expires unless a publish validates it within 2 days, so do the next step soon.
3. **GitHub.** Create the `release` environment (Settings → Environments), restricted to `main`.
   Enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull
   requests**.
4. **First automated release.** Merge the Version Packages pull request. Once it publishes, set
   npm **Publishing access** to *Require two-factor authentication and disallow tokens*.
5. **MCP Registry.** The workflow logs in with GitHub OIDC; the namespace
   `io.github.amatiasdev/*` belongs to the `amatiasdev` GitHub account. If the first automated
   registry publish fails, publish once by hand with `mcp-publisher login github` and
   `mcp-publisher publish`.
