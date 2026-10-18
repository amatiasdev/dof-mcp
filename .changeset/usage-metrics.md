---
"dof-mcp": patch
---

Hosted endpoint: each request's log line now records the JSON-RPC method, the tool name, the client's self-reported name and version, and whether the tool returned an error. IPs and tool arguments are never logged; client-supplied labels are sanitized and truncated.
