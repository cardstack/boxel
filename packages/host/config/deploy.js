/* eslint-env node */

module.exports = function (deployTarget) {
  let ENV = {
    pipeline: {
      activateOnDeploy: true,
    },
    build: {},
    s3: {
      allowOverwrite: true,
      bucket: process.env.AWS_S3_BUCKET,
      region: process.env.AWS_REGION,
      filePattern: '**/*',
    },
    cloudfront: {
      objectPaths: ['/*'],
      distribution: process.env.AWS_CLOUDFRONT_DISTRIBUTION,
    },
  };

  if (deployTarget === 'staging') {
    ENV.build.environment = 'production';
  }

  if (deployTarget === 'production') {
    ENV.build.environment = 'production';
  }

  if (deployTarget === 'build-only') {
    ENV.build.environment = 'production';
    // Run only the build; skip S3 upload, CloudFront, compression, etc.
    ENV.pipeline.disabled = { allExcept: ['build'] };
  }

  if (
    deployTarget === 's3-preview-staging' ||
    deployTarget === 's3-preview-production'
  ) {
    ENV.s3.prefix = process.env.PR_BRANCH_NAME;
    // Previews should always serve the latest build for the PR, so a reviewer
    // returning later sees current state without a shift-refresh. The default
    // is `max-age=63072000, public` plus a 2029 Expires, which pins assets in
    // the browser for ~2 years.
    ENV.s3.cacheControl = 'no-cache, max-age=0, must-revalidate';
    ENV.s3.expires = new Date(0);
  }

  return ENV;
};
