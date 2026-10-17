# Contributing

Issues and pull requests are welcome.

## Setup

Requires Node.js 22 or later.

```bash
npm install
npm run lint && npm run typecheck && npm test && npm run build
```

`npm run test:live` runs the contract tests against the live SIDOF API. Keep it to a few
requests; CI runs it nightly.

## Guidelines

- **Fixtures from real responses.** A new endpoint needs a fixture recorded from the live API in
  `test/fixtures/`, plus tests for parsing, normalization and error paths. Never invent fields.
- **Validate at the boundary.** Every SIDOF payload gets a Zod schema; unexpected shapes fail
  loudly.
- **Changesets.** Any user-facing change needs a changeset: run `npx changeset` and commit the
  generated file.
- **Style.** Biome formats and lints (`npx biome check --write .`).
