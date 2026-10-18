# Operational alerts by email (confirm the SNS subscription from the first message it sends).
# Cost alerts live in budget.tf; these cover failures and saturation.

resource "aws_sns_topic" "alerts" {
  name = "${var.function_name}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.budget_email
}

# The Lambda logs one JSON line per request (src/lambda.ts); these filters turn fields of it into
# metrics. Tool errors are mostly SIDOF failing or rejecting requests.
resource "aws_cloudwatch_log_metric_filter" "tool_errors" {
  name           = "${var.function_name}-tool-errors"
  log_group_name = aws_cloudwatch_log_group.lambda.name
  pattern        = "{ $.toolError IS TRUE }"

  metric_transformation {
    name          = "ToolErrors"
    namespace     = "DofMcp"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "server_errors" {
  name           = "${var.function_name}-server-errors"
  log_group_name = aws_cloudwatch_log_group.lambda.name
  pattern        = "{ $.status >= 500 }"

  metric_transformation {
    name          = "ServerErrors"
    namespace     = "DofMcp"
    value         = "1"
    default_value = "0"
  }
}

locals {
  alarms = {
    lambda-errors = {
      description = "The function threw or timed out (a bug, or SIDOF hanging past the timeout)."
      namespace   = "AWS/Lambda"
      metric      = "Errors"
      dimensions  = { FunctionName = aws_lambda_function.mcp.function_name }
      threshold   = 3
    }
    lambda-throttles = {
      description = "Requests hit the reserved concurrency cap: abuse or real growth."
      namespace   = "AWS/Lambda"
      metric      = "Throttles"
      dimensions  = { FunctionName = aws_lambda_function.mcp.function_name }
      threshold   = 10
    }
    tool-errors = {
      description = "Several tool calls failed: SIDOF may be down, blocking AWS, or have changed shape."
      namespace   = "DofMcp"
      metric      = "ToolErrors"
      dimensions  = {}
      threshold   = 10
    }
    server-errors = {
      description = "The endpoint answered 5xx."
      namespace   = "DofMcp"
      metric      = "ServerErrors"
      dimensions  = {}
      threshold   = 3
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "alarms" {
  for_each            = local.alarms
  alarm_name          = "${var.function_name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# Adoption metric (and the kill criterion "fewer than 5 distinct clients a week"): run it in
# CloudWatch Logs Insights → Saved queries.
resource "aws_cloudwatch_query_definition" "weekly_clients" {
  name            = "${var.function_name}/distinct-clients-per-week"
  log_group_names = [aws_cloudwatch_log_group.lambda.name]
  query_string    = <<-EOT
    filter ispresent(client)
    | stats count_distinct(client) as clients, count(*) as sessions by bin(7d) as week
    | sort week desc
  EOT
}

# By tool only: 2025-era clients send their name just in `initialize`, and the endpoint is
# stateless, so a tools/call line usually has no client to group by.
resource "aws_cloudwatch_query_definition" "tool_usage" {
  name            = "${var.function_name}/tool-usage"
  log_group_names = [aws_cloudwatch_log_group.lambda.name]
  query_string    = <<-EOT
    filter rpc = "tools/call"
    | stats count(*) as calls, sum(toolError) as errors, avg(ms) as avg_ms by tool
    | sort calls desc
  EOT
}
