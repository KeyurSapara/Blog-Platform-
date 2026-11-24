# Hand-off from Terraform to Ansible: write the inventory and the app settings
# (secrets included) into the ansible/ folder. Both files are git-ignored.

resource "local_file" "ansible_inventory" {
  filename        = "${path.module}/../ansible/inventory.ini"
  file_permission = "0644"
  content         = <<-EOT
    [blog]
    ${aws_eip.api.public_ip} ansible_user=ubuntu ansible_ssh_private_key_file=${pathexpand(var.ssh_private_key_path)}
  EOT
}

resource "local_sensitive_file" "ansible_vars" {
  filename        = "${path.module}/../ansible/group_vars/blog.yml"
  file_permission = "0600"
  content = yamlencode({
    db_host                         = aws_db_instance.main.address
    db_port                         = aws_db_instance.main.port
    db_name                         = var.db_name
    db_user                         = var.db_username
    db_password                     = random_password.db.result
    cognito_user_pool_id            = aws_cognito_user_pool.main.id
    cognito_client_id               = aws_cognito_user_pool_client.web.id
    azure_storage_connection_string = azurerm_storage_account.media.primary_connection_string
    azure_images_container          = azurerm_storage_container.images.name
    azure_backups_container         = azurerm_storage_container.backups.name
    content_safety_endpoint         = azurerm_cognitive_account.content_safety.endpoint
    content_safety_key              = azurerm_cognitive_account.content_safety.primary_access_key
    moderation_threshold            = var.moderation_threshold
    aws_region                      = var.aws_region
    sns_topic_arn                   = aws_sns_topic.author_posts.arn
    ses_sender_email                = var.notification_sender_email
    blog_url                        = "https://${aws_cloudfront_distribution.main.domain_name}"
  })
}
