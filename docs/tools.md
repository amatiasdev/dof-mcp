# Tool reference

All tools are read-only (`readOnlyHint: true`) and return both a JSON text block and `structuredContent` matching the tool's published `outputSchema`. Dates are `YYYY-MM-DD` and are interpreted on the Mexico City calendar.

Every successful result includes:

- `source`: a notice that the data is unofficial and should be confirmed against the official publication.
- `provenance`: `sourceUrl` (the SIDOF URL), `fetchedAt` (UTC), `sha256` and `bytes` of the raw SIDOF response.

## `dof_daily_summary`

Lists the publications of one day with counts by edition and issuing organization. Use the returned ids with `dof_get_note`.

**Input**

| Field | Type | Default | Notes |
|---|---|---|---|
| `date` | string `YYYY-MM-DD` | today (Mexico City) | Future dates are rejected |
| `edition` | `matutina` \| `vespertina` \| `extraordinaria` | all | Only this edition |
| `organization` | string, 2–200 chars | all | Case-insensitive substring of the issuing organization |
| `limit` | integer 1–200 | 100 | Maximum notes listed; the counts always cover the whole day |

**Output**

| Field | Description |
|---|---|
| `date` | The day summarized |
| `total` | Publications matching the filters |
| `byEdition` | Count per edition |
| `byOrganization` | `[{ organization, count }]`, most frequent first |
| `notes` | `[{ id, title, edition, organization?, page, officialUrl }]`, up to `limit` |
| `truncated` | `true` when more notes matched than `limit` |

Days without an issue (weekends, holidays) return `total: 0`.

## `dof_get_note`

Returns one publication with its content as plain text, paged for long notes.

**Input**

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | positive integer | required | Note id from `dof_daily_summary` |
| `offset` | integer ≥ 0 | 0 | Character offset into the text |
| `maxChars` | integer 1,000–50,000 | 20,000 | Maximum characters returned |

**Output**

| Field | Description |
|---|---|
| `id`, `title`, `date`, `edition?`, `section`, `page` | Publication metadata |
| `branch`, `organizations` | Branch of government and issuing bodies, general to specific |
| `hasPdf`, `hasDoc`, `contentTooLarge` | Availability flags reported by SIDOF |
| `officialUrl` | The publication on dof.gob.mx |
| `citation` | Citation in the format SIDOF's legal notice requires when reproducing the text |
| `text` | The requested slice of plain text (not HTML; escape it before rendering as HTML) |
| `offset`, `totalChars`, `nextOffset?` | Paging: when `nextOffset` is present, call again with `offset: nextOffset` |

## `dof_get_indicators`

Returns indicators published in the DOF.

**Input** (three modes)

| Mode | Fields | Notes |
|---|---|---|
| Today | none | What SIDOF lists for today; on weekends and holidays this can be only the UDI |
| One day | `date` | Values published that day; future dates are rejected |
| Series | `indicator`, `from`, `to` | Daily values of one indicator, at most 366 days; cannot be combined with `date` |

`indicator` is one of `fix` (FIX exchange rate, MXN/USD), `udis` (UDI value, MXN), `tiie28`, `tiie91`, `tiie182` (TIIE at 28, 91 and 182 days, %) and `tiieFondeo` (overnight TIIE, %).

**Output**

`indicators`: `[{ code, key?, name, unit?, date, value }]`. `key` is absent for indicator codes this version does not recognize.

## Errors

Errors are returned as tool results with `isError: true` and a message meant for the model:

| Situation | Message |
|---|---|
| Invalid input (bad date, out-of-range number) | Rejected by the input schema, or a message naming the problem |
| Future date | `<date> is in the future (today in Mexico City is …); nothing is published yet.` |
| Unknown note id, or no data for a date | `Note <id> does not exist in SIDOF` / `SIDOF has no data for … (HTTP 404)` (no retry suggested) |
| SIDOF failure or shape change | `SIDOF request failed: … Try again later.` |
| SIDOF unreachable | `Could not reach SIDOF (<cause>). Try again later.` |

## Example prompts

- "¿Qué se publicó en el DOF el 16 de octubre de 2026? Resume lo de Hacienda."
- "What was the FIX exchange rate from October 12 to 16, 2026?"
- "Give me the full text and the official citation of DOF note 5801457."
