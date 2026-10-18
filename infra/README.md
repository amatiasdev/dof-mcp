# Hosted endpoint: https://mcp.aldomatias.com/mcp

```
MCP client ──HTTPS──> Cloudflare (proxy, rate limit, adds x-dof-origin-secret)
                          │
              API Gateway HTTP API, mx-central-1 (custom domain, 5 rps / burst 10)
                          │
              Lambda dof-mcp, Node 24 arm64 (reserved concurrency 3, 15 s timeout)
                          │
                        SIDOF
```

The function is the same server as the npm package (`dist/lambda.js` wraps `createDofHttpHandler`). It refuses requests whose Host is not `mcp.aldomatias.com` or that lack the origin secret, so traffic that bypasses Cloudflare is turned away. The `execute-api` URL is disabled.

Terraform pins every provider to one account (`allowed_account_ids`, from `account_id`), so a plan against any other account fails.

## Local settings (not in git)

The account ID and the state bucket name stay out of this public repository. Before the first `terraform init`, in each stack:

```bash
cp terraform.tfvars.example terraform.tfvars
cp backend.hcl.example backend.hcl
```

Fill in the account ID (and, for the app, the budget email). Both files are git-ignored. Both stacks keep their state in the S3 bucket the bootstrap creates; initialize each with `terraform init -backend-config=backend.hcl`.

## Prerequisites

- AWS SSO profile `personal` (`aws sso login --profile personal`)
- Lambda concurrency quota in mx-central-1 above 10 (needed for the reserved concurrency)
- Terraform 1.10 or later

## First deployment

1. **Bootstrap** (state bucket, GitHub OIDC provider, deploy role). Its state goes in the bucket it creates, so the very first time comment out the `backend "s3"` block, apply with local state, restore the block and migrate:
   ```bash
   cd infra/bootstrap && terraform init && terraform apply
   terraform init -migrate-state -backend-config=backend.hcl   # after restoring the backend block
   ```
   Day to day: `terraform init -backend-config=backend.hcl`.
   Store the `deploy_role_arn` output as the variable `AWS_DEPLOY_ROLE_ARN` of the GitHub environment `release` (Settings → Environments → release → Variables).

2. **Bundle**, from the repository root:
   ```bash
   npm ci && npm run build && node scripts/build-lambda.mjs
   ```

3. **App, phase 1** (function, API, certificate request, budget). The endpoint is unreachable at this point: no custom domain yet, and `execute-api` is off.
   ```bash
   cd infra/app && terraform init -backend-config=backend.hcl
   terraform apply
   ```
   If the concurrency quota is still pending, add `-var reserved_concurrency=-1` and apply again with the default (3) before going live.

4. **Cloudflare, certificate validation:** for each `acm_validation_records` output, add a CNAME with **Proxy status: DNS only** (grey cloud).

5. **App, phase 2** (custom domain and mapping; waits until ACM validates):
   ```bash
   terraform apply -var dns_validated=true
   ```

6. **Cloudflare, go live:**
   - DNS: CNAME `mcp` → `cloudflare_cname_target` output, **Proxied** (orange cloud).
   - SSL/TLS: encryption mode **Full (strict)**.
   - Rules → Transform Rules → Modify Request Header: for hostname `mcp.aldomatias.com`, set header `x-dof-origin-secret` to `terraform output -raw origin_secret`.
   - Security → WAF → Rate limiting rules: for hostname `mcp.aldomatias.com`, block a single IP above 60 requests per 10 seconds.

7. **Check:**
   ```bash
   curl -fsS https://mcp.aldomatias.com/healthz
   npx @modelcontextprotocol/inspector --cli https://mcp.aldomatias.com/mcp --method tools/list
   ```

After this, every release deploys new code automatically (`.github/workflows/deploy-lambda.yml`, called from `release.yml`). To redeploy the latest release by hand: Actions → Deploy Lambda → Run workflow on `main`, or `gh workflow run deploy-lambda.yml --ref main`.

## Manual code update

Releases deploy automatically. To push code by hand, zip `build/lambda/` with forward-slash paths: `zip -qr ../lambda.zip .` from Git Bash or Linux, not PowerShell 5.1's `Compress-Archive`, which writes `dist\lambda.js` with backslashes. Then:

```bash
aws lambda update-function-code --function-name dof-mcp --zip-file fileb://build/lambda.zip \
  --profile personal --region mx-central-1
```

## Monitoring

- **Request log:** one JSON line per request in `/aws/lambda/dof-mcp` (7-day retention): method, path, status, duration, JSON-RPC method, tool, the client's self-reported name and version, and `toolError` when a tool failed. No IPs or arguments.
- **Alarms** (email through SNS topic `dof-mcp-alerts`; confirm the subscription email once): Lambda errors (≥3 in 15 min), throttles (≥10 in 15 min), tool errors (≥10 in 15 min, usually SIDOF failing) and 5xx answers (≥3 in 15 min).
- **Saved queries** (CloudWatch → Logs Insights → Saved queries): `dof-mcp/distinct-clients-per-week`, the adoption metric and the kill criterion, and `dof-mcp/tool-usage`.
- **Cost:** budget alerts at $5 and $15 (`budget.tf`). Monitoring itself stays within the CloudWatch and SNS free tiers (4 alarms, 2 metrics, email).

## Kill switch

Any one of these takes the endpoint offline:

- Fastest: in Cloudflare, set the `mcp` record to DNS only and delete it, or pause the rule set.
- In AWS: `aws lambda put-function-concurrency --function-name dof-mcp --reserved-concurrent-executions 0 --profile personal --region mx-central-1` (every request then gets a 429 from Lambda).
- Everything: `terraform destroy` in `infra/app`.

Turn it off at once if the account or pipeline may be compromised or if SIDOF complains or blocks. Review it if cost passes $10 a month two months in a row, or if after 60 days fewer than 5 distinct clients a week use it.

## Rotating the origin secret

```bash
terraform apply -replace=random_password.origin_secret
```

Then update the Cloudflare Transform Rule with the new `origin_secret`. Requests fail with 403 between the two steps.
