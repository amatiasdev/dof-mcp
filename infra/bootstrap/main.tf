# One-time setup, applied by the owner with local credentials (AWS SSO profile "personal"):
# the S3 bucket for the app's Terraform state, GitHub's OIDC provider, and the role the release
# workflow assumes to update the Lambda code. Its own state stays local (terraform.tfstate here,
# git-ignored); it rarely changes.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.69"
    }
  }
}

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

variable "github_repository" {
  type    = string
  default = "amatiasdev/dof-mcp"
}

variable "function_name" {
  type    = string
  default = "dof-mcp"
}

provider "aws" {
  profile             = var.aws_profile
  region              = var.region
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = { Project = "dof-mcp", ManagedBy = "terraform" }
  }
}

resource "aws_s3_bucket" "state" {
  bucket = "dof-mcp-tfstate-${var.account_id}"
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# Only the release workflow's `release` environment (restricted to main on GitHub) can assume it.
data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:release"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "dof-mcp-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.deploy_trust.json
}

# Least privilege: replace the code of one function and wait for the update. Infrastructure
# changes stay with the owner's `terraform apply`.
data "aws_iam_policy_document" "deploy" {
  statement {
    actions = ["lambda:UpdateFunctionCode", "lambda:GetFunction", "lambda:GetFunctionConfiguration"]
    resources = [
      "arn:aws:lambda:${var.region}:${var.account_id}:function:${var.function_name}",
    ]
  }
}

resource "aws_iam_role_policy" "deploy" {
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

output "deploy_role_arn" {
  description = "Store as the AWS_DEPLOY_ROLE_ARN variable of the GitHub `release` environment"
  value       = aws_iam_role.deploy.arn
}
