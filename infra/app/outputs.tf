output "acm_validation_records" {
  description = "Create these CNAMEs in Cloudflare as DNS only (grey cloud), then apply with dns_validated=true"
  value = [
    for option in aws_acm_certificate.mcp.domain_validation_options : {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  ]
}

output "cloudflare_cname_target" {
  description = "Point the domain's CNAME here in Cloudflare (proxied, orange cloud)"
  value       = var.dns_validated ? aws_apigatewayv2_domain_name.mcp[0].domain_name_configuration[0].target_domain_name : null
}

output "origin_secret" {
  description = "Value of the x-dof-origin-secret header Cloudflare must add (terraform output -raw origin_secret)"
  value       = random_password.origin_secret.result
  sensitive   = true
}

output "function_name" {
  value = aws_lambda_function.mcp.function_name
}
