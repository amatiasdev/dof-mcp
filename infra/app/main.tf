# Public MCP endpoint: Cloudflare (proxy, rate limit, origin secret header)
#   -> API Gateway HTTP API (custom domain, throttling) -> Lambda (Node, arm64) -> SIDOF.
# Applied by the owner with the AWS SSO profile "personal". The release workflow only updates
# the function code afterwards (see infra/bootstrap).

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.69"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.8"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }

  # The bucket (which embeds the account ID) and the profile come from a local backend.hcl:
  # terraform init -backend-config=backend.hcl. See backend.hcl.example.
  backend "s3" {
    key          = "app/terraform.tfstate"
    region       = "mx-central-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  profile             = var.aws_profile
  region              = var.region
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = { Project = "dof-mcp", ManagedBy = "terraform" }
  }
}

# AWS Budgets is served from us-east-1 only.
provider "aws" {
  alias               = "us_east_1"
  profile             = var.aws_profile
  region              = "us-east-1"
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = { Project = "dof-mcp", ManagedBy = "terraform" }
  }
}
