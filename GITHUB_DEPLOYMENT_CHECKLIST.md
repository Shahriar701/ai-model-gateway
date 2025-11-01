# 🚀 GitHub Actions AWS Deployment Checklist

## ✅ **Step-by-Step Setup**

### 1. **AWS Account Setup**
- [ ] Have AWS account ready
- [ ] Note down your 12-digit AWS Account ID
- [ ] Choose your preferred AWS region (default: us-east-1)

### 2. **Create IAM User for GitHub Actions**
- [ ] Go to AWS Console → IAM → Users
- [ ] Create user: `github-actions-ai-model-gateway`
- [ ] Select "Programmatic access" (Access Key)
- [ ] Create and attach the custom IAM policy (see `docs/iam-policy.json`)
- [ ] Download Access Key ID and Secret Access Key
- [ ] **⚠️ Keep credentials secure - never commit them to code**

### 3. **Bootstrap AWS CDK** (One-time setup)
```bash
# Make sure AWS CLI is configured
aws configure

# Run bootstrap script
./scripts/bootstrap-aws.sh
```

### 4. **Configure GitHub Repository Secrets**
Go to: `GitHub Repository → Settings → Secrets and variables → Actions`

**Add these secrets:**
- [ ] `AWS_ACCESS_KEY_ID` - Your IAM user's access key ID
- [ ] `AWS_SECRET_ACCESS_KEY` - Your IAM user's secret access key  
- [ ] `AWS_ACCOUNT_ID` - Your 12-digit AWS account ID

**Optional secrets:**
- [ ] `SNYK_TOKEN` - For security scanning (get from snyk.io)

### 5. **Test the Pipeline**
```bash
# Commit and push to trigger deployment
git add .
git commit -m "feat: setup AWS deployment pipeline"
git push origin master
```

### 6. **Monitor Deployment**
- [ ] Go to GitHub → Actions tab
- [ ] Watch the pipeline execution
- [ ] Check AWS CloudFormation console for stack creation
- [ ] Verify resources are created in AWS

## 🔧 **Pipeline Behavior**

| Branch | Trigger | Environment | Manual Approval |
|--------|---------|-------------|-----------------|
| `develop` | Push | Development | No |
| `master` | Push | Production | Yes (GitHub Environment) |
| Any | Pull Request | Test Only | No |

## 🛠 **Troubleshooting**

### Common Issues:
1. **"Access Denied"** → Check IAM policy permissions
2. **"Account ID mismatch"** → Verify `AWS_ACCOUNT_ID` secret
3. **"CDK not bootstrapped"** → Run bootstrap script
4. **"Region not supported"** → Check AWS region availability

### Debug Commands:
```bash
# Check AWS credentials
aws sts get-caller-identity

# Verify CDK bootstrap
aws cloudformation describe-stacks --stack-name CDKToolkit-ai-model-gateway

# Test CDK synthesis locally
npm run synth
```

## 🎯 **Next Steps After Setup**
1. ✅ Pipeline working → Continue with Bedrock provider implementation
2. ❌ Pipeline failing → Check troubleshooting section above
3. 🔄 Want to modify → Update IAM permissions or workflow as needed

## 📚 **Additional Resources**
- [AWS CDK Bootstrap Guide](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)
- [GitHub Actions AWS Guide](https://github.com/aws-actions/configure-aws-credentials)
- [IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)