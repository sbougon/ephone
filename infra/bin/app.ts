#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SiteStack } from '../lib/site-stack';

const app = new cdk.App();

// CloudFront ACM certificates must live in us-east-1, so the whole stack is
// pinned there to avoid cross-region references. The account comes from the
// credentials/profile used to run `cdk deploy`.
new SiteStack(app, 'RingMePleaseSite', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
  domainName: 'ringmeplease.com',
  // GitHub repo allowed to assume the deploy role, in `owner/repo` form.
  githubRepo: 'sbougon/ephone',
  // Only this git ref may deploy (matches the CI workflow trigger).
  githubBranch: 'main',
});
