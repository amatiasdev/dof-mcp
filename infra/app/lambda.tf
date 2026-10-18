# The bundle comes from `npm run build && node scripts/build-lambda.mjs` (build/lambda/).
data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../build/lambda"
  output_path = "${path.module}/../../build/lambda.zip"
}

# Shared with Cloudflare, which adds it as a request header; the function refuses requests
# without it, so traffic that bypasses Cloudflare is turned away.
resource "random_password" "origin_secret" {
  length  = 48
  special = false
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = 7
}

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.function_name}-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

# Only writes its own logs: the function calls nothing else in AWS.
data "aws_iam_policy_document" "lambda_logs" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda.arn}:*"]
  }
}

resource "aws_iam_role_policy" "lambda_logs" {
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_logs.json
}

resource "aws_lambda_function" "mcp" {
  function_name    = var.function_name
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "dist/lambda.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  memory_size      = 512
  # The client gives up on SIDOF after ~11 s (5 s timeout, 1 retry); API Gateway waits 29 s.
  timeout                        = 15
  reserved_concurrent_executions = var.reserved_concurrency

  environment {
    variables = {
      NODE_OPTIONS      = "--enable-source-maps"
      DOF_ALLOWED_HOSTS = var.domain_name
      DOF_ORIGIN_SECRET = random_password.origin_secret.result
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.lambda.name
  }

  # After the first apply the release workflow owns the code; Terraform owns the rest.
  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}
