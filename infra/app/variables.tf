variable "aws_profile" {
  type    = string
  default = "personal"
}

variable "region" {
  type    = string
  default = "mx-central-1"
}

variable "account_id" {
  description = "The only AWS account Terraform may touch. Set it in terraform.tfvars (git-ignored)."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit AWS account ID."
  }
}

variable "function_name" {
  type    = string
  default = "dof-mcp"
}

variable "domain_name" {
  description = "Public hostname of the endpoint"
  type        = string
  default     = "mcp.aldomatias.com"
}

variable "dns_validated" {
  description = <<-EOT
    Set to true once the ACM validation CNAME (output acm_validation_records) exists in
    Cloudflare. The custom domain and its API mapping are created only then.
  EOT
  type        = bool
  default     = false
}

variable "reserved_concurrency" {
  description = <<-EOT
    Hard cap on concurrent executions, and so on cost and on load sent to SIDOF. Needs the
    account's Lambda concurrency quota above 10; -1 leaves the function unreserved.
  EOT
  type        = number
  default     = 3
}

variable "throttle_rate" {
  description = "Steady-state requests per second API Gateway accepts across all clients"
  type        = number
  default     = 5
}

variable "throttle_burst" {
  type    = number
  default = 10
}

variable "budget_email" {
  description = "Where AWS Budgets sends cost alerts"
  type        = string
}

variable "budget_limit_usd" {
  type    = number
  default = 15
}
