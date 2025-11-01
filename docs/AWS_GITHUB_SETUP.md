# AWS GitHub Actions Setup Guide

## 1. Create IAM User for GitHub Actions

### Create IAM User
1. Go to AWS Console → IAM → Users
2. Click "Create user"
3. Username: `github-actions-ai-model-gateway`
4. Select "Programmatic access"

### Create IAM Policy
Create a custom policy with these permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "cloudformation:*",
                "s3:*",
                "lambda:*",
                "apigateway:*",
                "dynamodb:*",
                "elasticache:*",
                "ec2:*",
                "iam:*",
                "logs:*",
                "events:*",
                "ssm:*",
                "secretsmanager:*",
                "bedrock:*",
                "xray:*",
                "cloudwatch:*"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "sts:AssumeRole"
            ],
            "Resource": "*"
        }
    ]
}
```

### Attach Policy to User
1. Attach the custom policy to the user
2. Also attach: `AWSCloudFormationFullAccess`
3. Download the Access Key ID and Secret Access Key

## 2. Configure GitHub Repository Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions

### Required Secrets:

#### For Development Environment:
- `AWS_ACCESS_KEY_ID`: Your IAM user's access key ID
- `AWS_SECRET_ACCESS_KEY`: Your IAM user's secret access key  
- `AWS_ACCOUNT_ID`: Your 12-digit AWS account ID

#### For Production Environment (if different account):
- `AWS_ACCESS_KEY_ID_PROD`: Production IAM user's access key ID
- `AWS_SECRET_ACCESS_KEY_PROD`: Production IAM user's secret access key
- `AWS_ACCOUNT_ID_PROD`: Production AWS account ID

#### Optional (for security scanning):
- `SNYK_TOKEN`: Snyk API token for security scanning

## 3. Find Your AWS Account ID

You can find your AWS Account ID by:
1. AWS Console → Top right corner (account dropdown)
2. Or run: `aws sts get-caller-identity --query Account --output text`

## 4. Test the Setup

After adding the secrets, push a commit to trigger the pipeline:

```bash
git add .
git commit -m "test: trigger GitHub Actions deployment"
git push origin master
```

## 5. Monitor Deployment

1. Go to GitHub → Actions tab
2. Watch the deployment progress
3. Check AWS CloudFormation console for stack creation

## 6. Environment Configuration

The pipeline uses these environments:
- **Development**: Triggered on `develop` branch pushes
- **Production**: Triggered on `master` branch pushes (requires manual approval)

## 7. Troubleshooting

### Common Issues:
1. **Permission Denied**: Check IAM policy permissions
2. **Account ID Mismatch**: Verify AWS_ACCOUNT_ID secret
3. **Region Issues**: Ensure AWS_REGION is correct in workflow
4. **CDK Bootstrap**: May need to run `cdk bootstrap` manually first

### Manual CDK Bootstrap (if needed):
```bash
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1
```