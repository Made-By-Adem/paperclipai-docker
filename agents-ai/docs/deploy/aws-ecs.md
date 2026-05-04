---
title: AWS ECS Fargate
summary: Deploy AgentsAI to AWS using ECS Fargate, RDS Postgres, and EFS
---

Deploy AgentsAI to AWS with ECS Fargate (compute), RDS Postgres 17 (database), and EFS (persistent storage). This guide uses the AWS CLI and produces a single-task ECS service behind an ALB with HTTPS.

## Prerequisites

- AWS CLI v2 configured with a profile that has admin-level permissions
- Docker installed locally (for building and pushing the image)
- A registered domain with DNS you control (for the TLS certificate)
- The AgentsAI repo cloned locally

Set these shell variables for the rest of the guide:

```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export PAPERCLIP_DOMAIN=agentsai.example.com   # your domain
export DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
export AUTH_SECRET=$(openssl rand -base64 32)
```

## 1. Create ECR Repository

```bash
aws ecr create-repository \
  --repository-name agentsai-server \
  --image-scanning-configuration scanOnPush=true \
  --region $AWS_REGION
```

## 2. Build and Push Docker Image

```bash
cd /path/to/agentsai

# Authenticate Docker to ECR
aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin \
    $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Build
docker build -t agentsai-server .

# Tag and push
docker tag agentsai-server:latest \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/agentsai-server:latest

docker push \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/agentsai-server:latest
```

## 3. Networking (VPC, Subnets, Security Groups)

Use the default VPC or create a dedicated one. The guide assumes the default VPC with public and private subnets in two AZs.

```bash
# Get default VPC
VPC_ID=$(aws ec2 describe-vpcs \
  --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)

# Get two public subnets (for ALB)
SUBNET_IDS=$(aws ec2 describe-subnets \
  --filters Name=vpc-id,Values=$VPC_ID \
  --query 'Subnets[?MapPublicIpOnLaunch==`true`] | [0:2].SubnetId' \
  --output text)
SUBNET_1=$(echo $SUBNET_IDS | awk '{print $1}')
SUBNET_2=$(echo $SUBNET_IDS | awk '{print $2}')
```

Create security groups:

```bash
# ALB security group — inbound HTTPS
ALB_SG=$(aws ec2 create-security-group \
  --group-name agentsai-alb \
  --description "AgentsAI ALB" \
  --vpc-id $VPC_ID \
  --query 'GroupId' --output text)

aws ec2 authorize-security-group-ingress \
  --group-id $ALB_SG \
  --protocol tcp --port 443 --cidr 0.0.0.0/0

# Also open port 80 so the ALB can accept HTTP and redirect to HTTPS
aws ec2 authorize-security-group-ingress \
  --group-id $ALB_SG \
  --protocol tcp --port 80 --cidr 0.0.0.0/0

# ECS task security group — inbound from ALB only
ECS_SG=$(aws ec2 create-security-group \
  --group-name agentsai-ecs \
  --description "AgentsAI ECS tasks" \
  --vpc-id $VPC_ID \
  --query 'GroupId' --output text)

aws ec2 authorize-security-group-ingress \
  --group-id $ECS_SG \
  --protocol tcp --port 3100 \
  --source-group $ALB_SG

# RDS security group — inbound from ECS only
RDS_SG=$(aws ec2 create-security-group \
  --group-name agentsai-rds \
  --description "AgentsAI RDS" \
  --vpc-id $VPC_ID \
  --query 'GroupId' --output text)

aws ec2 authorize-security-group-ingress \
  --group-id $RDS_SG \
  --protocol tcp --port 5432 \
  --source-group $ECS_SG

# EFS security group — inbound NFS from ECS only
EFS_SG=$(aws ec2 create-security-group \
  --group-name agentsai-efs \
  --description "AgentsAI EFS" \
  --vpc-id $VPC_ID \
  --query 'GroupId' --output text)

aws ec2 authorize-security-group-ingress \
  --group-id $EFS_SG \
  --protocol tcp --port 2049 \
  --source-group $ECS_SG
```

## 4. Create RDS Postgres Instance

```bash
# Custom VPCs don't come with a default DB subnet group — create one
# that spans our two subnets so RDS can place the instance.
aws rds create-db-subnet-group \
  --db-subnet-group-name agentsai-db-subnet \
  --db-subnet-group-description "AgentsAI RDS subnets" \
  --subnet-ids $SUBNET_1 $SUBNET_2

aws rds create-db-instance \
  --db-instance-identifier agentsai-db \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version 17 \
  --master-username agentsai \
  --master-user-password "$DB_PASSWORD" \
  --allocated-storage 20 \
  --storage-type gp3 \
  --vpc-security-group-ids $RDS_SG \
  --db-subnet-group-name agentsai-db-subnet \
  --no-publicly-accessible \
  --backup-retention-period 7 \
  --no-multi-az \
  --db-name agentsai \
  --region $AWS_REGION

# Wait for it to become available (takes 5-10 min)
aws rds wait db-instance-available \
  --db-instance-identifier agentsai-db

# Get the endpoint
RDS_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier agentsai-db \
  --query 'DBInstances[0].Endpoint.Address' --output text)

DATABASE_URL="postgresql://agentsai:${DB_PASSWORD}@${RDS_ENDPOINT}:5432/agentsai"
```

## 5. Create EFS Filesystem

```bash
EFS_ID=$(aws efs create-file-system \
  --performance-mode generalPurpose \
  --throughput-mode bursting \
  --encrypted \
  --tags Key=Name,Value=agentsai-data \
  --query 'FileSystemId' --output text)

# Create mount targets in each subnet
for SUBNET in $SUBNET_1 $SUBNET_2; do
  aws efs create-mount-target \
    --file-system-id $EFS_ID \
    --subnet-id $SUBNET \
    --security-groups $EFS_SG
done

# Wait for mount targets
aws efs describe-mount-targets --file-system-id $EFS_ID
```

## 6. Store Secrets

```bash
aws secretsmanager create-secret \
  --name agentsai/database-url \
  --secret-string "$DATABASE_URL"

aws secretsmanager create-secret \
  --name agentsai/anthropic-api-key \
  --secret-string "YOUR_ANTHROPIC_KEY"

aws secretsmanager create-secret \
  --name agentsai/better-auth-secret \
  --secret-string "$AUTH_SECRET"

aws secretsmanager create-secret \
  --name agentsai/openai-api-key \
  --secret-string "YOUR_OPENAI_KEY"

aws secretsmanager create-secret \
  --name agentsai/github-token \
  --secret-string "YOUR_GITHUB_PAT"
```

## 7. IAM Roles

Create the ECS task execution role (pulls images, reads secrets) and the task role (application permissions).

```bash
# Task execution role
aws iam create-role \
  --role-name agentsai-ecs-execution \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy \
  --role-name agentsai-ecs-execution \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

# Allow reading secrets
aws iam put-role-policy \
  --role-name agentsai-ecs-execution \
  --policy-name SecretsAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:'$AWS_REGION':'$AWS_ACCOUNT_ID':secret:agentsai/*"
    }]
  }'

# Task role (application — add permissions as needed)
aws iam create-role \
  --role-name agentsai-ecs-task \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'
```

## 8. ECS Cluster and Task Definition

```bash
aws ecs create-cluster --cluster-name agentsai

aws logs create-log-group --log-group-name /ecs/agentsai
```

Register the task definition using the template at `docker/ecs-task-definition.json`. Before registering, replace the placeholder values:

```bash
sed -e "s|<ACCOUNT_ID>|$AWS_ACCOUNT_ID|g" \
    -e "s|<REGION>|$AWS_REGION|g" \
    -e "s|<EFS_ID>|$EFS_ID|g" \
    -e "s|<DOMAIN>|$PAPERCLIP_DOMAIN|g" \
    docker/ecs-task-definition.json > /tmp/agentsai-task-def.json

aws ecs register-task-definition \
  --cli-input-json file:///tmp/agentsai-task-def.json
```

## 9. ALB and TLS Certificate

Request a certificate (you must validate via DNS):

```bash
CERT_ARN=$(aws acm request-certificate \
  --domain-name $PAPERCLIP_DOMAIN \
  --validation-method DNS \
  --query 'CertificateArn' --output text)

# Get the CNAME record to add to your DNS
aws acm describe-certificate \
  --certificate-arn $CERT_ARN \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
```

Add the CNAME to your DNS provider, then wait for validation:

```bash
aws acm wait certificate-validated --certificate-arn $CERT_ARN
```

Create the ALB:

```bash
ALB_ARN=$(aws elbv2 create-load-balancer \
  --name agentsai-alb \
  --subnets $SUBNET_1 $SUBNET_2 \
  --security-groups $ALB_SG \
  --scheme internet-facing \
  --type application \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)

ALB_DNS=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns $ALB_ARN \
  --query 'LoadBalancers[0].DNSName' --output text)

# Target group
TG_ARN=$(aws elbv2 create-target-group \
  --name agentsai-tg \
  --protocol HTTP \
  --port 3100 \
  --vpc-id $VPC_ID \
  --target-type ip \
  --health-check-path /api/health \
  --health-check-interval-seconds 30 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

# HTTPS listener
LISTENER_ARN=$(aws elbv2 create-listener \
  --load-balancer-arn $ALB_ARN \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=$CERT_ARN \
  --default-actions Type=forward,TargetGroupArn=$TG_ARN \
  --query 'Listeners[0].ListenerArn' --output text)

# HTTP listener — redirect all :80 traffic to :443
HTTP_LISTENER_ARN=$(aws elbv2 create-listener \
  --load-balancer-arn $ALB_ARN \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=redirect,RedirectConfig='{Protocol=HTTPS,Port=443,StatusCode=HTTP_301}' \
  --query 'Listeners[0].ListenerArn' --output text)
```

Point your DNS to the ALB:
- Create a CNAME or ALIAS record for `$PAPERCLIP_DOMAIN` -> `$ALB_DNS`

## 10. Create ECS Service

```bash
aws ecs create-service \
  --cluster agentsai \
  --service-name agentsai-server \
  --task-definition agentsai-server \
  --desired-count 1 \
  --launch-type FARGATE \
  --deployment-configuration '{
    "deploymentCircuitBreaker": {"enable": true, "rollback": true},
    "maximumPercent": 200,
    "minimumHealthyPercent": 100
  }' \
  --network-configuration '{
    "awsvpcConfiguration": {
      "subnets": ["'$SUBNET_1'", "'$SUBNET_2'"],
      "securityGroups": ["'$ECS_SG'"],
      "assignPublicIp": "ENABLED"
    }
  }' \
  --load-balancers '[{
    "targetGroupArn": "'$TG_ARN'",
    "containerName": "agentsai-server",
    "containerPort": 3100
  }]'
```

> **Note:** `assignPublicIp: ENABLED` is needed if using public subnets without a NAT Gateway. For private subnets, set to `DISABLED` and ensure a NAT Gateway is configured for outbound internet access.

## 11. Verify Deployment

```bash
# Watch task come up
aws ecs describe-services \
  --cluster agentsai \
  --services agentsai-server \
  --query 'services[0].{desired:desiredCount,running:runningCount,status:status}'

# Check task health
aws ecs list-tasks --cluster agentsai --service-name agentsai-server
TASK_ARN=$(aws ecs list-tasks --cluster agentsai --service-name agentsai-server --query 'taskArns[0]' --output text)
aws ecs describe-tasks --cluster agentsai --tasks $TASK_ARN \
  --query 'tasks[0].{status:lastStatus,health:healthStatus}'

# Check logs
aws logs tail /ecs/agentsai --since 10m --follow

# Hit the health endpoint
curl -sf https://$PAPERCLIP_DOMAIN/api/health
```

**Healthy indicators:**
- ECS task status: `RUNNING`, health: `HEALTHY`
- Logs show `plugin job coordinator started` and `plugin-loader: loadAll complete`
- `/api/health` returns 200

## Post-Deploy Security Hardening

After the first user has signed up (which grants admin role), lock down the instance:

```bash
# Disable public sign-up (prevents unauthorized users from creating accounts)
# Add to the task definition environment section, then redeploy:
#   { "name": "PAPERCLIP_AUTH_DISABLE_SIGN_UP", "value": "true" }

# Or update via Secrets Manager / task def override, then force new deployment
aws ecs update-service \
  --cluster agentsai \
  --service agentsai-server \
  --force-new-deployment
```

Use the invite flow (added in v2026.416.0) to grant access to additional users after sign-up is disabled.

## Deploying Updates

Build, push, and force a new deployment:

```bash
# Build and push new image
docker build -t agentsai-server .
docker tag agentsai-server:latest \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/agentsai-server:latest
docker push \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/agentsai-server:latest

# Roll out
aws ecs update-service \
  --cluster agentsai \
  --service agentsai-server \
  --force-new-deployment

# Watch the deployment
aws ecs describe-services \
  --cluster agentsai \
  --services agentsai-server \
  --query 'services[0].deployments[*].{status:status,running:runningCount,desired:desiredCount,rollout:rolloutState}'
```

ECS performs a rolling update: starts a new task, waits for it to pass health checks, then drains the old task.

## Rollback

If the new deployment is unhealthy:

```bash
# ECS automatically rolls back if the new task fails health checks
# (circuit breaker is enabled in the service configuration above).
# To force rollback manually:

# 1. Find the previous task definition revision
aws ecs list-task-definitions \
  --family-prefix agentsai-server \
  --sort DESC \
  --query 'taskDefinitionArns[0:3]'

# 2. Update service to the previous revision
aws ecs update-service \
  --cluster agentsai \
  --service agentsai-server \
  --task-definition agentsai-server:<PREVIOUS_REVISION>
```

## Scaling to Zero (Cost Savings)

Scale down when not in use:

```bash
# Stop
aws ecs update-service \
  --cluster agentsai \
  --service agentsai-server \
  --desired-count 0

# Start
aws ecs update-service \
  --cluster agentsai \
  --service agentsai-server \
  --desired-count 1
```

RDS can also be stopped (auto-restarts after 7 days):

```bash
aws rds stop-db-instance --db-instance-identifier agentsai-db
aws rds start-db-instance --db-instance-identifier agentsai-db
```

## Teardown

Remove all resources in reverse order:

```bash
# 1. ECS service and cluster
aws ecs update-service --cluster agentsai --service agentsai-server --desired-count 0
aws ecs delete-service --cluster agentsai --service agentsai-server --force
aws ecs delete-cluster --cluster agentsai

# 2. ALB and ACM cert
aws elbv2 delete-listener --listener-arn $HTTP_LISTENER_ARN
aws elbv2 delete-listener --listener-arn $LISTENER_ARN
aws elbv2 delete-target-group --target-group-arn $TG_ARN
aws elbv2 delete-load-balancer --load-balancer-arn $ALB_ARN
aws acm delete-certificate --certificate-arn $CERT_ARN

# 3. RDS (creates final snapshot)
aws rds delete-db-instance \
  --db-instance-identifier agentsai-db \
  --final-db-snapshot-identifier agentsai-db-final
aws rds wait db-instance-deleted --db-instance-identifier agentsai-db
aws rds delete-db-subnet-group --db-subnet-group-name agentsai-db-subnet

# 4. EFS (mount targets must be deleted first)
for MT in $(aws efs describe-mount-targets --file-system-id $EFS_ID --query 'MountTargets[*].MountTargetId' --output text); do
  aws efs delete-mount-target --mount-target-id $MT
done
# Mount-target deletion is async; poll until none remain before deleting
# the filesystem, otherwise delete-file-system fails with FileSystemInUse.
echo "Waiting for mount targets to delete..."
while aws efs describe-mount-targets \
  --file-system-id $EFS_ID \
  --query 'MountTargets[0].MountTargetId' --output text 2>/dev/null | grep -q 'fsmt-'; do
  sleep 5
done
aws efs delete-file-system --file-system-id $EFS_ID

# 5. Secrets
for s in database-url anthropic-api-key better-auth-secret openai-api-key github-token; do
  aws secretsmanager delete-secret --secret-id agentsai/$s --force-delete-without-recovery
done

# 6. Security groups (after all dependents are gone)
for sg in $EFS_SG $RDS_SG $ECS_SG $ALB_SG; do
  aws ec2 delete-security-group --group-id $sg
done

# 7. ECR
aws ecr delete-repository --repository-name agentsai-server --force

# 8. IAM roles
aws iam delete-role-policy --role-name agentsai-ecs-execution --policy-name SecretsAccess
aws iam detach-role-policy --role-name agentsai-ecs-execution \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam delete-role --role-name agentsai-ecs-execution
aws iam delete-role --role-name agentsai-ecs-task

# 9. Log group
aws logs delete-log-group --log-group-name /ecs/agentsai
```

## Cost Reference

| Service | Config | Monthly |
|---------|--------|---------|
| ECS Fargate | 2 vCPU, 4 GB, 24/7 | ~$70 |
| RDS Postgres | db.t4g.micro, 20 GB | ~$15 |
| ALB | 1 LCU average | ~$22 |
| NAT Gateway | 1 AZ (if using private subnets) | ~$35 |
| EFS | 1 GB Standard | ~$0.30 |
| Secrets Manager | 5 secrets | ~$2 |
| CloudWatch Logs | ~1 GB/mo | ~$0.50 |
| ECR | ~1 GB | ~$0.10 |
| **Total (public subnets, no NAT)** | | **~$110/mo** |
| **Total (private subnets + NAT)** | | **~$145/mo** |

Use Fargate Spot and scheduled scaling to 0 during off-hours to reduce to ~$60-85/mo.
