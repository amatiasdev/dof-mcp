---
"dof-mcp": minor
---

Hosted endpoint support and source citations:

- `dof_get_note` returns a `citation` in the format SIDOF's legal notice requires when reproducing its content (`citeNote` is exported too)
- `createDofHttpHandler` accepts `requiredHeader` (a shared secret a CDN adds in front of a public deployment), `maxRequestBodySize` and `maxSubscriptions`
- `dist/lambda.js` adapts the server to AWS Lambda behind API Gateway HTTP API; it refuses to start without `DOF_ALLOWED_HOSTS` and `DOF_ORIGIN_SECRET`
