# Fixtures

Real responses recorded from the public SIDOF API (https://sidof.segob.gob.mx/dof/sidof), used
only to test parsing. Source: Diario Oficial de la Federación, Secretaría de Gobernación. They are
not shipped in the npm package.

| File | Endpoint | Recorded |
|---|---|---|
| `notas-16-10-2026.json` | `/notas/16-10-2026` | 2026-10-17 or earlier |
| `nota-5801457.json` | `/notas/nota/5801457` | 2026-10-17 |
| `nota-not-found.json` | `/notas/nota/1` (unknown id) | 2026-10-17 |
| `indicadores-16-10-2026.json` | `/indicadores/16-10-2026` | 2026-10-17 |
| `indicadores-158-01-10-2026-16-10-2026.json` | `/indicadores/158/01-10-2026/16-10-2026` | 2026-10-17 |
