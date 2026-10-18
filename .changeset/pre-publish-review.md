---
"dof-mcp": patch
---

Pre-publish review fixes:

- Unknown note ids and dates without data report "not found" (`DofNotFoundError`) instead of an upstream failure with a retry hint
- `dof_daily_summary` and `dof_get_indicators` reject future dates with a clear message
- `require("dof-mcp")` works on Node.js 22.12+ (`default` export condition)
- CLI: readable errors for unknown options and busy ports; `--help` lists `-h` and `-v`
- Network errors include the cause code (for example `ENOTFOUND`)
- README: client setup for Claude Desktop, Cursor and Windows; license scope of DOF content
- Security audit: note HTML nested more than 1000 levels fails fast with `HtmlTooDeepError` (htmlparser2's stack is O(depth) per tag); schema errors are summarized in a few hundred characters instead of serializing every issue; SIDOF dates are validated before they reach official URLs; only real network failures are reported as "could not reach SIDOF"
