import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface SiteStackProps extends cdk.StackProps {
  /** Apex domain, e.g. "ringmeplease.com". The "www." host is added automatically. */
  readonly domainName: string;
  /** GitHub repository allowed to deploy, in "owner/repo" form. */
  readonly githubRepo: string;
  /** Git branch allowed to deploy (matches the CI workflow trigger). */
  readonly githubBranch: string;
}

export class SiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);

    const { domainName, githubRepo, githubBranch } = props;
    const wwwName = `www.${domainName}`;

    // --- DNS (Route 53 zone already exists) -------------------------------
    const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', {
      domainName,
    });

    // --- Private origin bucket --------------------------------------------
    // No public access; CloudFront reads it via Origin Access Control. RETAIN
    // so tearing down the stack never deletes the live site by accident.
    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // --- TLS certificate (CloudFront requires us-east-1; this stack is) ----
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName,
      subjectAlternativeNames: [wwwName],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // --- URL-rewrite function (directory paths -> index.html) -------------
    const rewriteFunction = new cloudfront.Function(this, 'UrlRewrite', {
      code: cloudfront.FunctionCode.fromFile({
        filePath: path.join(__dirname, 'url-rewrite.js'),
      }),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Append index.html to directory-style request URIs',
    });

    // --- CloudFront distribution ------------------------------------------
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `RingMePlease (${domainName})`,
      defaultRootObject: 'index.html',
      domainNames: [domainName, wwwName],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // NA + EU edges (cheapest)
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations: [
          {
            function: rewriteFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
    });

    // --- DNS alias records: apex + www -> CloudFront ----------------------
    const aliasTarget = route53.RecordTarget.fromAlias(
      new targets.CloudFrontTarget(distribution),
    );
    for (const [hostId, recordName] of [
      ['Apex', domainName],
      ['Www', wwwName],
    ] as const) {
      new route53.ARecord(this, `Alias${hostId}A`, {
        zone: hostedZone,
        recordName,
        target: aliasTarget,
      });
      new route53.AaaaRecord(this, `Alias${hostId}Aaaa`, {
        zone: hostedZone,
        recordName,
        target: aliasTarget,
      });
    }

    // --- GitHub OIDC deploy role (no long-lived keys) ---------------------
    // Reuse an existing account-level GitHub OIDC provider if its ARN is passed
    // via context (`-c githubOidcProviderArn=...`); otherwise create one. An
    // account may only have a single provider per URL, so importing avoids a
    // CREATE_FAILED if you already use GitHub OIDC elsewhere.
    const existingProviderArn = this.node.tryGetContext('githubOidcProviderArn');
    const oidcProvider: iam.IOpenIdConnectProvider = existingProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          'GitHubOidc',
          existingProviderArn,
        )
      : new iam.OpenIdConnectProvider(this, 'GitHubOidc', {
          url: 'https://token.actions.githubusercontent.com',
          clientIds: ['sts.amazonaws.com'],
        });

    const deployRole = new iam.Role(this, 'GitHubDeployRole', {
      roleName: 'ringmeplease-github-deploy',
      description: 'Assumed by GitHub Actions to publish the site to S3 + CloudFront',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.OpenIdConnectPrincipal(oidcProvider, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          // Restrict to pushes/dispatches on the deploy branch of this repo.
          'token.actions.githubusercontent.com:sub': `repo:${githubRepo}:ref:refs/heads/${githubBranch}`,
        },
      }),
    });

    // Exactly the permissions CI needs: write objects to this bucket and
    // invalidate this distribution. Nothing else.
    bucket.grantReadWrite(deployRole);
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
        ],
      }),
    );

    // --- Outputs to paste into GitHub repo variables ----------------------
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
    });
    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: distribution.distributionDomainName,
    });
  }
}
