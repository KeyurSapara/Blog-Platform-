# CloudBlog – Plan A: EC2-Based Multi-Cloud Architecture (AWS + Azure)

A simple, low-cost blog platform deployed across **two clouds**:

- **AWS** hosts the main application: frontend, API server, login, database, and author-subscription emails (SNS + SES).
- **Azure** handles blog image storage, AI comment moderation, and disaster-recovery backups.

Infrastructure is created with **Terraform**, the EC2 server is configured with **Ansible**, and every push to `main` is tested and deployed by an **AWS CodePipeline** (CodeBuild + CodeDeploy).


---

## 1. Architecture

```
                         ┌──────────────┐
                         │    Users     │
                         └──────┬───────┘
                                │ HTTPS (https://dxxxx.cloudfront.net)
                     ┌──────────▼───────────┐
                     │   AWS CloudFront     │  CDN + free SSL certificate
                     └─────┬──────────┬─────┘
              static files │          │ /api/*
              ┌────────────▼──┐   ┌───▼─────────────────────┐      ┌──────────────┐
              │   AWS S3      │   │  AWS EC2 (Elastic IP)   │◄────►│ AWS Cognito  │
              │  (frontend)   │   │  Nginx → Node.js API    │      │ (Login/JWT)  │
              └───────────────┘   │  (systemd service)      │      └──────────────┘
                                  └──┬─────────┬────────┬───┘
                        private      │         │        │  IAM role ┌──────────────────────┐
                        subnet ┌─────▼───────┐ │        ├──────────►│ AWS SNS topic        │──► email to
                               │ AWS RDS     │ │        │           │ (new-post alerts)    │    subscribers
                               │ MySQL 8.4   │ │        ├──────────►│ AWS SES (welcome /   │──► email to
                               └─────┬───────┘ │        │           │ new-subscriber mail) │    reader + author
                                     │         │        │           └──────────────────────┘
 ════════════════════════════════════│═ AZURE ═│════════│═════════════════════
                         nightly cron│  images │        │ comment check
                   ┌─────────────────▼┐ ┌──────▼──────┐ ┌▼────────────────────┐
                   │ Azure Blob       │ │ Azure Blob  │ │ Azure AI Content    │
                   │ "backups" (DR)   │ │ "images"    │ │ Safety              │
                   └──────────────────┘ └─────────────┘ └─────────────────────┘

        Monitoring: AWS CloudWatch alarms (EC2 CPU / status) + Azure Monitor (storage metrics)
        CI/CD:      git push ─► GitHub ─► AWS CodePipeline: CodeBuild (test + package)
                                                       ├─► CodeDeploy agent on EC2 (backend)
                                                       └─► CodeBuild: S3 sync + CloudFront invalidation (frontend)
```

### Services Used

| Cloud | Service | Purpose |
|---|---|---|
| AWS | **CloudFront** | Single HTTPS entry point. Routes `/` → S3 and `/api/*` → EC2 |
| AWS | **S3** (private, with Origin Access Control) | Hosts the frontend (HTML/CSS/JS) |
| AWS | **EC2** t3.micro + Elastic IP | Runs the Node.js API behind Nginx |
| AWS | **Cognito** User Pool | Sign-up, email verification, login (JWT) |
| AWS | **RDS** MySQL 8.4 (private subnet) | Users, posts, comments |
| AWS | **VPC**, Security Groups | Network isolation. EC2 accepts HTTP only from CloudFront's IP ranges |
| AWS | **CloudWatch** | CPU and status-check alarms |
| AWS | **SNS** topic | Emails a new post to everyone subscribed to its author (filter policy per reader) |
| AWS | **SES** | Welcome email to the subscriber and "new subscriber" email to the author |
| AWS | **IAM** instance role | EC2 calls SNS/SES and downloads releases without access keys |
| AWS | **CodePipeline** + **CodeConnections** | Starts on every push to `main` of the GitHub repo |
| AWS | **CodeBuild** | Runs the unit tests and packages the release (`buildspec.yml`); also deploys the frontend to S3 |
| AWS | **CodeDeploy** | In-place deploy of the API to EC2 with health check and auto-rollback (`deploy/codedeploy/`) |
| GitHub | **Actions** | Extra CI checks on pull requests (MySQL smoke test, Terraform/Ansible validation) |
| Azure | **Blob Storage** – `images` | Blog post images (public read) |
| Azure | **Blob Storage** – `backups` | Nightly gzipped MySQL dumps, Cool tier, auto-deleted after 30 days |
| Azure | **AI Content Safety** | Rejects hateful, violent, sexual or self-harm comments |

### Request Flow

1. **Read a blog:** Browser → CloudFront → S3 (frontend) → `GET /api/posts` → CloudFront → EC2 (Nginx → Node.js) → RDS.
2. **Login:** Browser → Cognito (`InitiateAuth`) → receives an ID token (JWT) → sends `Authorization: Bearer <token>` on API calls. The API verifies the token against Cognito's public keys.
3. **Upload an image:** Browser → `POST /api/media` → EC2 uploads it to **Azure Blob** → the URL is saved with the post in RDS.
4. **Comment:** Browser → `POST /api/comments` → EC2 calls **Azure AI Content Safety** → saved if clean, rejected with HTTP 422 if flagged.
5. **Backup:** Cron on EC2 at 02:00 UTC runs `mysqldump` (over TLS) → gzip → **Azure Blob `backups`**. Cross-cloud disaster recovery.
6. **Subscribe to an author:** Browser → `POST /api/subscriptions` → the row is saved in RDS → EC2 creates (or updates) the reader's **SNS email subscription**. Its filter policy is `{"author_id": [<every author they follow>]}`. The first time, AWS emails the reader a *Confirm subscription* link. **SES** then emails the reader ("You're subscribed to …") and the author ("… subscribed to your posts").
7. **New post alert:** `POST /api/posts` → EC2 publishes to the **SNS topic** with the `author_id` message attribute → SNS emails only the confirmed subscribers of that author.

> One SNS subscription per reader (not per author) is required. SNS allows a single subscription per email address per topic, so following a second author updates the filter policy instead of subscribing again.

---

## 2. Folder Structure

```
plan-a-ec2/
├── buildspec.yml              # AWS CodeBuild: test + package backend/frontend artifacts
├── deploy/codedeploy/         # appspec.yml + hook scripts (install deps, restart, health check)
├── .github/workflows/
│   └── ci.yml                 # GitHub CI: tests + MySQL smoke test, terraform validate, ansible check
├── terraform/                 # Infrastructure as Code (AWS + Azure)
│   ├── versions.tf            # providers: aws, azurerm, random, local
│   ├── variables.tf
│   ├── terraform.tfvars.example
│   ├── network.tf             # VPC, subnets, internet gateway, routes
│   ├── security.tf            # security groups (CloudFront-only HTTP, SSH from your IP)
│   ├── ec2.tf                 # Ubuntu 24.04 instance, Elastic IP, CloudWatch alarms
│   ├── rds.tf                 # MySQL 8.4 in private subnets
│   ├── cognito.tf             # user pool + web client
│   ├── frontend.tf            # S3 bucket, CloudFront, frontend upload + cache invalidation
│   ├── azure.tf               # resource group, storage account, containers, Content Safety
│   ├── notifications.tf       # SNS topic, SES identities, EC2 IAM role (SNS/SES/SSM)
│   ├── cicd.tf                # CodePipeline, CodeBuild, CodeDeploy, GitHub connection, artifacts bucket
│   ├── ansible.tf             # writes Ansible inventory + variables
│   ├── outputs.tf
│   └── templates/config.js.tftpl
├── ansible/                   # Server configuration
│   ├── ansible.cfg
│   ├── site.yml               # Node.js, Nginx, systemd, RDS CA, backup cron, CodeDeploy agent
│   └── templates/             # .env, systemd unit, nginx site
└── app/
    ├── frontend/              # plain HTML/CSS/JS single-page app
    └── backend/               # Node.js + Express REST API
        └── src/
            ├── index.js       # app entry
            ├── config.js, db.js, auth.js, azure.js, util.js
            ├── notifications.js  # SNS subscriptions / publish + SES emails
            ├── backup.js      # RDS → Azure Blob backup script
            └── routes/        # posts, comments, users, media, subscriptions
        └── test/              # unit tests (node --test), run by CI
```

---

## 3. Prerequisites

| Tool | Check | Install (macOS) |
|---|---|---|
| Terraform ≥ 1.5 | `terraform -version` | `brew install terraform` |
| Ansible ≥ 2.15 | `ansible --version` | `brew install ansible` |
| AWS CLI v2 | `aws --version` | `brew install awscli` |
| Azure CLI | `az version` | `brew install azure-cli` |

Accounts:

- **AWS account** (Free Tier works). Run `aws configure` with an IAM user's access key, **or** `aws login`.
- **Azure subscription** (Azure for Students works). Run `az login`.

> **Using `aws login`?** Terraform's AWS provider can't read its `login_session` credentials yet ("No valid credential sources found"). Add this profile to `~/.aws/config` and run Terraform with `AWS_PROFILE=terraform`:
>
> ```ini
> [profile terraform]
> credential_process = /opt/homebrew/bin/aws configure export-credentials --profile default --format process
> region = ap-southeast-2
> ```
>
> **Restricted accounts:** some AWS organizations only allow one region (check with `aws ec2 describe-instances --region us-east-1`). Set `aws_region` to match. Azure for Students only allows a few regions (`az policy assignment list`), so set `azure_location` to one that offers Content Safety, e.g. `koreacentral`.

---

## 4. Deployment (Step by Step)

### Step 1: Create an SSH key for the server

```bash
ssh-keygen -t ed25519 -f ~/.ssh/cloudblog -N ""
```

### Step 2: Configure Terraform variables

```bash
cd plan-a-ec2/terraform
cp terraform.tfvars.example terraform.tfvars

# Fill these two values into terraform.tfvars:
az account show --query id -o tsv          # → azure_subscription_id
curl -s https://checkip.amazonaws.com      # → ssh_allowed_cidr = "<ip>/32"

# Optional, for SES emails (welcome / new subscriber):
#   notification_sender_email    = "you@gmail.com"
#   notification_test_recipients = ["friend@gmail.com"]
```

> **SES sandbox:** new AWS accounts can only send SES email to **verified** addresses. After `terraform apply`, every address above gets an "Amazon Web Services – Email Address Verification Request" email. Click the link in each one. To email anyone, request production access in the SES console. SNS new-post alerts don't need this, because each subscriber confirms their own subscription.

### Step 3: Create the infrastructure (about 10–15 minutes)

```bash
terraform init
terraform plan
terraform apply
```

This creates every AWS and Azure resource, uploads the frontend to S3, and writes:

- `ansible/inventory.ini` (the EC2 IP address)
- `ansible/group_vars/blog.yml` (database password, Cognito IDs, Azure keys; git-ignored)

### Step 4: Configure the server and deploy the API

```bash
cd ../ansible
ansible-playbook site.yml
```

The playbook installs Node.js 24, Nginx and the MySQL client, uploads the backend, writes `.env`, starts the `blog-api` systemd service, and schedules the nightly backup. It finishes by calling `/api/health`.

### Step 5: Open the blog

```bash
cd ../terraform
terraform output blog_url
```

Open the URL, then **sign up**, enter the code from your email, **log in**, and **write a post** with an image.

### Step 6: Turn on the CI/CD pipeline (one time)

Terraform created an **AWS CodePipeline** for `KeyurSapara/Blog-Platform-` (`github_repo` in `terraform.tfvars`). Its GitHub connection starts as **Pending**, and AWS requires a person to approve it once:

1. Open `terraform output -raw github_connection_url`.
2. Select **blogec2-github** → **Update pending connection** → **Install a new app**, and allow the *AWS Connector for GitHub* to access the repository → **Connect**. The status becomes **Available**.
3. Start the first run: `aws codepipeline start-pipeline-execution --name blogec2-pipeline`

From now on, every `git push` to `main` runs the pipeline (`terraform output -raw codepipeline_url`):

| Stage | Service | What happens |
|---|---|---|
| **Source** | CodeConnections | Pulls the pushed commit from GitHub |
| **Build** | CodeBuild (`buildspec.yml`) | `npm ci`, syntax check, unit tests, then packages `BackendArtifact` (CodeDeploy bundle) and `FrontendArtifact` |
| **Deploy: Backend-EC2** | CodeDeploy (`deploy/codedeploy/appspec.yml`) | The agent on EC2 copies the release to `/opt/blog/backend`, runs `npm install`, restarts `blog-api`, and checks `/api/health`. A failed check rolls back automatically |
| **Deploy: Frontend-S3** | CodeBuild | `aws s3 sync` to the frontend bucket + CloudFront invalidation |

GitHub Actions (`.github/workflows/ci.yml`) also runs a MySQL smoke test and Terraform/Ansible checks on every push and pull request. Infrastructure changes (`terraform/*.tf`) are still applied by hand with `terraform apply`.

---

## 5. Testing the Cloud Features

| Feature | How to test |
|---|---|
| Azure Blob images | Create a post with an image. Right-click the image: the URL is `https://<account>.blob.core.windows.net/images/...` |
| Azure AI moderation | Post an abusive comment. You get *"Comment rejected by content moderation (Hate)"* |
| Cognito auth | Call `curl -X POST <blog_url>/api/posts` without logging in. You get `401 Login required` |
| Backup to Azure | Run the backup command below, then check the `backups` container in the Azure Portal |
| Security group | `curl http://<ec2_public_ip>/api/health` from your laptop times out, because only CloudFront is allowed in |
| SNS subscription | Log in as user B, open user A's post, click **Subscribe to A**. B gets an "AWS Notification – Subscription Confirmation" email. Click **Confirm subscription**. *Profile → My subscriptions* then shows "Email alerts are active" |
| SNS new-post alert | Log in as A and publish a post. B receives "New post from A: …" from CloudBlog (no-reply@sns.amazonaws.com) |
| SES emails | With `notification_sender_email` set and the addresses verified: B gets "You're subscribed to A" and A gets "B subscribed to your CloudBlog posts" |
| CI/CD | Push a change to `main` and watch the pipeline in the CodePipeline console: Source → Build → Deploy |

Run a backup now instead of waiting for 02:00:

```bash
ssh -i ~/.ssh/cloudblog ubuntu@$(terraform output -raw ec2_public_ip) \
  "sudo -u blog bash -c 'cd /opt/blog/backend && node src/backup.js'"
```

---

## 6. Updating the App

| Change | Command |
|---|---|
| Backend code (`app/backend`) | `git push` to `main` (CodePipeline), or `cd ansible && ansible-playbook site.yml` |
| Frontend (`app/frontend`) | `git push` to `main` (CodePipeline), or `cd terraform && terraform apply` |
| Settings in `.env` (new Terraform outputs) | `cd ansible && ansible-playbook site.yml` |
| Infrastructure (`terraform/*.tf`) | `cd terraform && terraform apply` |

Useful server commands:

```bash
ssh -i ~/.ssh/cloudblog ubuntu@<ec2_public_ip>
sudo systemctl status blog-api
sudo journalctl -u blog-api -f          # API logs
cat /opt/blog/logs/backup.log           # backup logs
```

---

## 7. API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | – | Health check (also tests the DB) |
| GET | `/api/posts?limit=&offset=` | – | List posts |
| GET | `/api/posts/:id` | – | Get one post |
| POST | `/api/posts` | ✅ | `{ title, content, imageUrl? }` |
| PUT | `/api/posts/:id` | ✅ owner | Update a post |
| DELETE | `/api/posts/:id` | ✅ owner | Delete a post (its comments are deleted too) |
| GET | `/api/comments?postId=` | – | List a post's comments |
| POST | `/api/comments` | ✅ | `{ postId, body }`, moderated by Azure |
| DELETE | `/api/comments/:id` | ✅ owner | Delete a comment |
| GET | `/api/users/me` | ✅ | Get or create your profile |
| PUT | `/api/users/me` | ✅ | `{ displayName, bio }` |
| POST | `/api/media` | ✅ | multipart field `image` (≤ 5 MB) → `{ url }` |
| GET | `/api/subscriptions` | ✅ | Authors I follow + whether my SNS email subscription is confirmed |
| GET | `/api/subscriptions/authors/:authorId` | – | `{ subscribers }` count |
| POST | `/api/subscriptions` | ✅ | `{ authorId }`: subscribe (SNS subscription + SES emails) |
| DELETE | `/api/subscriptions/:authorId` | ✅ | Unsubscribe (updates or removes the SNS subscription) |

---

## 8. Cloud Computing Concepts Shown

- **Multi-cloud:** AWS for compute, database and identity; Azure for storage, AI and DR. No single-vendor lock-in.
- **Service models:** IaaS (EC2, VPC), PaaS (RDS, Blob Storage, Cognito), AI as a service (Content Safety), messaging as a service (SNS, SES).
- **Pub/sub messaging:** an SNS topic with message-attribute filter policies fans each post out to only that author's subscribers.
- **CI/CD and DevOps:** AWS CodePipeline → CodeBuild → CodeDeploy tests and releases every push to `main`, with health checks and automatic rollback.
- **Infrastructure as Code:** Terraform creates about 30 resources across two clouds, and Ansible handles configuration management.
- **Security:**
  - private subnet for RDS
  - security group chaining (EC2 → RDS)
  - HTTP to EC2 allowed only from CloudFront IPs
  - SSH allowed only from your IP
  - TLS to MySQL, verified with the RDS CA
  - IMDSv2 and encrypted EBS and RDS storage
  - JWT verification
  - a private S3 bucket behind Origin Access Control
- **Disaster recovery:** daily cross-cloud backups with lifecycle-based retention.
- **CDN and edge caching:** CloudFront caches the frontend. API calls are never cached.
- **Monitoring:** CloudWatch alarms. Azure Monitor shows storage and Content Safety metrics.

### Limitations (Covered by Plan B)

- A single EC2 instance is a **single point of failure**, and scaling is **vertical** only (change `instance_type`).
- Deployments restart the service, causing a few seconds of downtime.
- Plan B (EKS) adds microservices, auto-scaling, self-healing and zero-downtime rolling updates.

---

## 9. Cost

| Resource | Cost |
|---|---|
| EC2 t3.micro, RDS db.t3.micro, 20 GB storage | Free Tier (first 12 months / credits). Otherwise about $8 + $13 per month |
| Elastic IP (public IPv4) | about $3.60/month |
| CloudFront, S3, Cognito | Free Tier |
| Azure Blob Storage | A few cents |
| Azure Content Safety F0 | Free (5,000 text records/month) |
| SNS email, SES | Free tier: 1,000 SNS emails/month. SES costs $0.10 per 1,000 emails |
| CodePipeline V2, CodeBuild, CodeDeploy | About $0.002 per pipeline minute and 100 free CodeBuild minutes/month. CodeDeploy to EC2 is free |

---

## 10. Clean Up (Avoid Charges)

```bash
cd plan-a-ec2/terraform
terraform destroy
```

---

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| `terraform apply` fails on the Content Safety F0 SKU | Only one F0 Content Safety resource is allowed per subscription. Set `content_safety_sku = "S0"` or delete the old one |
| Azure: *public access is not permitted on this storage account* | Your subscription policy blocks public blobs. Set `container_access_type = "private"` and serve images via SAS URLs, or use a personal subscription |
| Ansible: `UNREACHABLE` | Check that `ssh_allowed_cidr` matches your current IP (`curl -s https://checkip.amazonaws.com`), then run `terraform apply` again |
| Blog shows "Request failed (502/504)" | The API is down. SSH in and run `sudo journalctl -u blog-api -n 50` |
| No verification email | Check spam. Cognito's default sender is limited to about 50 emails/day |
| Old frontend still showing | Hard refresh. Terraform already invalidates the CloudFront cache when files change |
| Subscribed but no new-post emails | Click **Confirm subscription** in the AWS Notification email (check spam). *Profile → My subscriptions* shows the status |
| No SES welcome / new-subscriber email | SES sandbox: verify both the sender and the recipient (see Step 2), or request production access. Errors are logged in `journalctl -u blog-api` |
| `No valid credential sources found` (Terraform) | You logged in with `aws login`. Use the `terraform` profile described in Prerequisites |
| Pipeline **Source** fails: connection not available | Finish Step 6 (authorize the GitHub connection), then **Release change** |
| CodeDeploy: *no instances found* / agent errors | Run `ansible-playbook site.yml` (installs the agent), then `sudo systemctl status codedeploy-agent` and `/var/log/aws/codedeploy-agent/codedeploy-agent.log` on EC2 |
