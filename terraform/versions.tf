terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.20"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.azure_subscription_id
}

locals {
  name = var.project_name
  tags = {
    Project      = var.project_name
    Architecture = "plan-a-ec2"
    ManagedBy    = "terraform"
  }
}
