resource "aws_apigatewayv2_api" "mcp" {
  name          = var.function_name
  protocol_type = "HTTP"
  # Reachable only through the custom domain, which Cloudflare fronts.
  disable_execute_api_endpoint = true
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.mcp.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.mcp.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

# Only the routes the server answers; anything else is a 404 from API Gateway, before Lambda.
resource "aws_apigatewayv2_route" "routes" {
  for_each  = toset(["POST /mcp", "GET /mcp", "DELETE /mcp", "GET /healthz"])
  api_id    = aws_apigatewayv2_api.mcp.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.mcp.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = var.throttle_rate
    throttling_burst_limit = var.throttle_burst
  }
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mcp.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.mcp.execution_arn}/*/*"
}

resource "aws_acm_certificate" "mcp" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "mcp" {
  count           = var.dns_validated ? 1 : 0
  certificate_arn = aws_acm_certificate.mcp.arn
}

resource "aws_apigatewayv2_domain_name" "mcp" {
  count       = var.dns_validated ? 1 : 0
  domain_name = var.domain_name

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.mcp[0].certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "mcp" {
  count       = var.dns_validated ? 1 : 0
  api_id      = aws_apigatewayv2_api.mcp.id
  domain_name = aws_apigatewayv2_domain_name.mcp[0].id
  stage       = aws_apigatewayv2_stage.default.id
}
