# AWS-managed list of CloudFront origin-facing IP ranges. Only CloudFront can reach the API on port 80.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "web" {
  name        = "${local.name}-web-sg"
  description = "API server: HTTP from CloudFront, SSH from admin IP"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTP from CloudFront only"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  ingress {
    description = "SSH from admin IP (Ansible)"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_allowed_cidr]
  }

  egress {
    description = "Outbound to internet (Azure APIs, Cognito JWKS, package updates)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-web-sg" }
}

resource "aws_security_group" "db" {
  name        = "${local.name}-db-sg"
  description = "RDS MySQL: only reachable from the API server"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "MySQL from API server"
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.web.id]
  }

  tags = { Name = "${local.name}-db-sg" }
}
