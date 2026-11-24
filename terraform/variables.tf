variable "project_name" {
  description = "Short lowercase name used as a prefix for all resources"
  type        = string
  default     = "blogec2"

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{2,15}$", var.project_name))
    error_message = "Use 3-16 lowercase letters/digits (it is also used in the Azure storage account name)."
  }
}

# ---------- AWS ----------
variable "aws_region" {
  description = "AWS region for EC2, RDS, Cognito and S3"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type for the API server (t3.micro / t2.micro are Free Tier eligible)"
  type        = string
  default     = "t3.micro"
}

variable "ssh_public_key_path" {
  description = "Public key uploaded to EC2 as the key pair"
  type        = string
  default     = "~/.ssh/cloudblog.pub"
}

variable "ssh_private_key_path" {
  description = "Matching private key, written into the Ansible inventory"
  type        = string
  default     = "~/.ssh/cloudblog"
}

variable "ssh_allowed_cidr" {
  description = "Your public IP in CIDR form (e.g. 203.0.113.10/32). Only this IP can SSH to EC2."
  type        = string
}

variable "db_instance_class" {
  description = "RDS instance class (db.t3.micro / db.t4g.micro are Free Tier eligible)"
  type        = string
  default     = "db.t3.micro"
}

variable "db_name" {
  description = "MySQL database name"
  type        = string
  default     = "blogdb"
}

variable "db_username" {
  description = "MySQL master username"
  type        = string
  default     = "blogadmin"
}

# ---------- Notifications (SNS + SES) ----------
variable "notification_sender_email" {
  description = "From address for SES emails (welcome / new-subscriber). AWS sends it a verification link. Empty = SES emails off; SNS post alerts still work."
  type        = string
  default     = ""
}

variable "notification_test_recipients" {
  description = "Extra addresses to verify in SES. While SES is in sandbox mode it only delivers to verified addresses."
  type        = list(string)
  default     = []
}

# ---------- CI/CD (GitHub Actions) ----------
variable "github_repo" {
  description = "GitHub repository (owner/name) whose main branch may deploy to this stack"
  type        = string
  default     = "KeyurSapara/Blog-Platform-Cloud"
}

variable "create_github_oidc_provider" {
  description = "Set to false if your AWS account already has the token.actions.githubusercontent.com OIDC provider"
  type        = bool
  default     = true
}

# ---------- Azure ----------
variable "azure_subscription_id" {
  description = "Azure subscription ID (az account show --query id -o tsv)"
  type        = string
}

variable "azure_location" {
  description = "Azure region for Blob Storage and AI Content Safety"
  type        = string
  default     = "eastus"
}

variable "content_safety_sku" {
  description = "F0 = free tier (one per subscription), S0 = standard"
  type        = string
  default     = "F0"
}

variable "moderation_threshold" {
  description = "Reject comments when any Content Safety category severity >= this value (0, 2, 4, 6)"
  type        = number
  default     = 2
}

variable "backup_retention_days" {
  description = "Delete database backups in Azure Blob Storage after this many days"
  type        = number
  default     = 30
}
