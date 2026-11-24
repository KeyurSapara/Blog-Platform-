# CI/CD: GitHub Actions deploys with short-lived credentials from GitHub's OIDC provider
# (no AWS access keys stored in GitHub). Pipeline steps:
#   backend  -> tarball in the artifacts bucket -> SSM Run Command runs /usr/local/bin/blog-deploy on EC2
#   frontend -> s3 sync to the frontend bucket   -> CloudFront invalidation
# Infrastructure changes are still applied by hand with `terraform apply`.

data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  count           = var.create_github_oidc_provider ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}

locals {
  github_oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
}

resource "aws_s3_bucket" "artifacts" {
  bucket        = "${local.name}-artifacts-${random_id.suffix.hex}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "expire-old-builds"
    status = "Enabled"
    filter {}
    expiration {
      days = 14
    }
  }
}

# Only workflows on the main branch of this repository can assume the role.
resource "aws_iam_role" "github_deploy" {
  name = "${local.name}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/main"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "deploy"
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "BuildArtifacts"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.artifacts.arn}/*"
      },
      {
        Sid      = "FrontendFiles"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:PutObject", "s3:GetObject"]
        Resource = [aws_s3_bucket.frontend.arn, "${aws_s3_bucket.frontend.arn}/*"]
      },
      {
        Sid      = "InvalidateCdn"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = aws_cloudfront_distribution.main.arn
      },
      {
        Sid    = "RunDeployScript"
        Effect = "Allow"
        Action = ["ssm:SendCommand"]
        Resource = [
          aws_instance.api.arn,
          "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript",
        ]
      },
      {
        Sid      = "ReadDeployResult"
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
        Resource = "*"
      },
    ]
  })
}
