# Author subscriptions and email notifications:
#   - SNS topic   : every new post is published here with an author_id attribute. Each reader has one
#                   email subscription whose filter policy lists the authors they follow.
#   - SES         : one-off emails (subscription welcome to the reader, "new subscriber" to the author).
#   - IAM role    : lets the EC2 API call SNS/SES without access keys, and enables SSM for the CD pipeline.

resource "aws_sns_topic" "author_posts" {
  name         = "${local.name}-author-posts"
  display_name = "CloudBlog" # shown as the sender name of SNS emails
}

# Sender address. AWS emails a verification link to it after `terraform apply`.
resource "aws_sesv2_email_identity" "sender" {
  count          = var.notification_sender_email == "" ? 0 : 1
  email_identity = var.notification_sender_email
}

# In the SES sandbox, recipients must be verified too. List your test accounts here.
resource "aws_sesv2_email_identity" "test_recipients" {
  for_each       = toset(var.notification_test_recipients)
  email_identity = each.value
}

# ---------- EC2 instance role ----------
resource "aws_iam_role" "api" {
  name = "${local.name}-api-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "api_notifications" {
  name = "notifications"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Sid    = "AuthorPostsTopic"
        Effect = "Allow"
        Action = [
          "sns:Publish",
          "sns:Subscribe",
          "sns:Unsubscribe",
          "sns:ListSubscriptionsByTopic",
          "sns:GetSubscriptionAttributes",
          "sns:SetSubscriptionAttributes",
        ]
        # Subscription ARNs are "<topic arn>:<id>"
        Resource = [aws_sns_topic.author_posts.arn, "${aws_sns_topic.author_posts.arn}:*"]
      }],
      var.notification_sender_email == "" ? [] : [{
        Sid       = "SendFromBlogAddress"
        Effect    = "Allow"
        Action    = ["ses:SendEmail"]
        Resource  = "*"
        Condition = { StringEquals = { "ses:FromAddress" = var.notification_sender_email } }
      }]
    )
  })
}

# Lets the GitHub Actions pipeline run the deploy script on the instance (no SSH needed).
resource "aws_iam_role_policy_attachment" "api_ssm" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "api" {
  name = "${local.name}-api-profile"
  role = aws_iam_role.api.name
}
