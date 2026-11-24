output "blog_url" {
  description = "Open this in your browser"
  value       = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "ec2_public_ip" {
  value = aws_eip.api.public_ip
}

output "ssh_command" {
  value = "ssh -i ${var.ssh_private_key_path} ubuntu@${aws_eip.api.public_ip}"
}

output "rds_endpoint" {
  value = aws_db_instance.main.address
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "frontend_bucket" {
  value = aws_s3_bucket.frontend.id
}

output "azure_storage_account" {
  value = azurerm_storage_account.media.name
}

output "azure_images_base_url" {
  value = "${azurerm_storage_account.media.primary_blob_endpoint}${azurerm_storage_container.images.name}/"
}

output "azure_content_safety_endpoint" {
  value = azurerm_cognitive_account.content_safety.endpoint
}

output "sns_topic_arn" {
  value = aws_sns_topic.author_posts.arn
}

output "codepipeline_url" {
  value = "https://${var.aws_region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${aws_codepipeline.main.name}/view?region=${var.aws_region}"
}

# One-time step: the GitHub connection starts as PENDING. Open this, click "Update pending connection"
# and install/authorize the AWS Connector GitHub app for the repository.
output "github_connection_url" {
  value = "https://${var.aws_region}.console.aws.amazon.com/codesuite/settings/connections?region=${var.aws_region}"
}
