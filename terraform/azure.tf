# Azure side of the multi-cloud design:
#   - Blob Storage "images"  : public-read container for blog images
#   - Blob Storage "backups" : private container for nightly RDS dumps (disaster recovery)
#   - AI Content Safety      : moderates comments before they are saved

resource "azurerm_resource_group" "main" {
  name     = "${local.name}-rg"
  location = var.azure_location
  tags     = local.tags
}

resource "random_string" "azure_suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "azurerm_storage_account" "media" {
  name                            = "${local.name}${random_string.azure_suffix.result}"
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = true # required for the public "images" container
  tags                            = local.tags
}

resource "azurerm_storage_container" "images" {
  name                  = "images"
  storage_account_id    = azurerm_storage_account.media.id
  container_access_type = "blob" # anonymous read of individual blobs, no listing
}

resource "azurerm_storage_container" "backups" {
  name                  = "backups"
  storage_account_id    = azurerm_storage_account.media.id
  container_access_type = "private"
}

# Automatically delete old backups.
resource "azurerm_storage_management_policy" "backups" {
  storage_account_id = azurerm_storage_account.media.id

  rule {
    name    = "expire-old-backups"
    enabled = true

    filters {
      blob_types   = ["blockBlob"]
      prefix_match = ["backups/"]
    }

    actions {
      base_blob {
        delete_after_days_since_modification_greater_than = var.backup_retention_days
      }
    }
  }
}

resource "azurerm_cognitive_account" "content_safety" {
  name                  = "${local.name}-safety-${random_string.azure_suffix.result}"
  custom_subdomain_name = "${local.name}-safety-${random_string.azure_suffix.result}"
  resource_group_name   = azurerm_resource_group.main.name
  location              = azurerm_resource_group.main.location
  kind                  = "ContentSafety"
  sku_name              = var.content_safety_sku
  tags                  = local.tags
}
