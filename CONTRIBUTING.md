# Contributing

Issues and pull requests are welcome, in English or Spanish.

## Reporting bugs and requesting features

- **Bugs and feature requests:** open an issue at https://github.com/amatiasdev/dof-mcp/issues. For a bug, include the version (`npx dof-mcp --version`), the tool or method you called with its arguments, what you expected and what happened.
- **Security vulnerabilities:** do not open a public issue; follow [SECURITY.md](SECURITY.md).
- Issues and pull requests are public and searchable, and they are where discussion happens.

## Setup

Requires Node.js 22 or later.

```bash
npm install
npm run lint && npm run typecheck && npm test && npm run build
```

`npm test` runs the unit, server and property-based tests against recorded fixtures.
`npm run test:live` runs the contract tests against the live SIDOF API. Keep it to a few
requests; CI runs it nightly.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make the change with its tests (see the test policy below).
3. Run the four checks above; CI runs them on Node.js 22 and 24 and must pass.
4. Add a changeset for any user-facing change: `npx changeset`, then commit the generated file.
5. Open the pull request and describe what changed and why.

## Test policy

New functionality and bug fixes must come with automated tests in `test/`:

- A new endpoint needs a fixture recorded from the live API in `test/fixtures/`, plus tests for parsing, normalization and error paths. Never invent fields.
- A new tool needs tests through the MCP client (`test/server.test.ts`), including its error results.
- Code that handles untrusted input (SIDOF payloads, HTML, client requests) should also get property-based tests (`test/properties.test.ts`).
- A bug fix adds a test that fails without the fix.

## Guidelines

- **Validate at the boundary.** Every SIDOF payload gets a Zod schema; unexpected shapes fail loudly.
- **Style.** Biome formats and lints (`npx biome check --write .`); TypeScript runs in strict mode.
