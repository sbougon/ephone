# RingMePlease infrastructure (CDK)

Provisions the AWS hosting for **ringmeplease.com**:

- private **S3** bucket (Origin Access Control — no public access)
- **CloudFront** distribution (HTTP/2+3, HTTPS-only) with a viewer function that
  rewrites directory URLs (`/app/` → `/app/index.html`)
- **ACM** certificate for the apex + `www`, DNS-validated via Route 53
- **Route 53** A/AAAA alias records for apex + `www`
- a **GitHub OIDC** role scoped to *only* this bucket + this distribution, assumed by
  the `deploy-aws.yml` workflow (no long-lived AWS keys anywhere)

## One-time setup

1. **Create a local admin identity (root used only here).** In the AWS console, create
   an IAM user `cdk-admin` with `AdministratorAccess`, make an access key, then put the
   root credentials away. Locally:
   ```bash
   aws configure --profile cdk-admin
   ```

2. **Install + bootstrap** (once per account/region):
   ```bash
   cd infra
   npm install
   npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1 --profile cdk-admin
   ```

3. **Deploy the infrastructure:**
   ```bash
   npx cdk deploy --profile cdk-admin
   ```
   Note the outputs: `BucketName`, `DistributionId`, `DeployRoleArn`.
   > Already use GitHub OIDC in this account? Pass your existing provider ARN so CDK
   > imports it instead of creating a duplicate:
   > `npx cdk deploy --profile cdk-admin -c githubOidcProviderArn=arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com`

4. **Wire up CI.** In GitHub → repo **Settings → Secrets and variables → Actions →
   Variables**, add three repository *variables* (not secrets):
   | Variable | Value (from step 3) |
   |---|---|
   | `AWS_DEPLOY_ROLE_ARN` | `DeployRoleArn` |
   | `S3_BUCKET` | `BucketName` |
   | `CLOUDFRONT_DISTRIBUTION_ID` | `DistributionId` |

5. **Deploy content.** Push to `main` (or run the **Deploy to AWS** workflow manually).
   The site goes live at https://ringmeplease.com.

## Day-to-day

- **Content change** → just push to `main`; `deploy-aws.yml` syncs + invalidates.
- **Infra change** → edit `lib/site-stack.ts`, then `npx cdk deploy --profile cdk-admin`.

`npx cdk deploy` requires admin AWS credentials; the CI deploy role intentionally cannot
modify infrastructure.
