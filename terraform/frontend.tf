# S3 (private) + CloudFront. CloudFront serves the single-page frontend from S3 and
# forwards /api/* to the EC2 instance, so the whole app lives on one HTTPS domain.

resource "random_id" "suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "frontend" {
  bucket        = "${local.name}-frontend-${random_id.suffix.hex}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.name}-frontend-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

# API responses are not cached. The Authorization header must be part of the
# cache key for CloudFront to forward it, so we use a 0-second TTL policy.
resource "aws_cloudfront_cache_policy" "api" {
  name        = "${local.name}-api-no-cache"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 1

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Authorization"]
      }
    }
    query_strings_config {
      query_string_behavior = "all"
    }
  }
}

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  comment             = "${local.name} blog"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  origin {
    origin_id                = "s3-frontend"
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  origin {
    origin_id   = "ec2-api"
    domain_name = aws_eip.api.public_dns

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    compress               = true
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "ec2-api"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.api.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.main.arn } }
    }]
  })
}

# ---------- Upload the frontend files ----------
locals {
  frontend_dir   = "${path.module}/../app/frontend"
  frontend_files = setsubtract(fileset(local.frontend_dir, "**"), ["config.js", "config.example.js"])
  mime_types = {
    html = "text/html"
    css  = "text/css"
    js   = "application/javascript"
    svg  = "image/svg+xml"
    png  = "image/png"
    ico  = "image/x-icon"
  }
}

resource "aws_s3_object" "frontend" {
  for_each = local.frontend_files

  bucket        = aws_s3_bucket.frontend.id
  key           = each.value
  source        = "${local.frontend_dir}/${each.value}"
  etag          = filemd5("${local.frontend_dir}/${each.value}")
  content_type  = lookup(local.mime_types, reverse(split(".", each.value))[0], "application/octet-stream")
  cache_control = "no-cache"
}

resource "aws_s3_object" "frontend_config" {
  bucket        = aws_s3_bucket.frontend.id
  key           = "config.js"
  content_type  = "application/javascript"
  cache_control = "no-cache"
  content = templatefile("${path.module}/templates/config.js.tftpl", {
    region    = var.aws_region
    user_pool = aws_cognito_user_pool.main.id
    client_id = aws_cognito_user_pool_client.web.id
  })
}

# Clear the CloudFront cache whenever frontend files change (needs the AWS CLI).
resource "terraform_data" "invalidate_frontend" {
  triggers_replace = [
    sha1(join(",", [for k, o in aws_s3_object.frontend : o.etag])),
    aws_s3_object.frontend_config.etag,
  ]

  provisioner "local-exec" {
    command = "aws cloudfront create-invalidation --distribution-id ${aws_cloudfront_distribution.main.id} --paths '/*' > /dev/null"
  }
}
