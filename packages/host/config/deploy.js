/* eslint-env node */

module.exports = function (deployTarget) {
  let ENV = {
    pipeline: {
      activateOnDeploy: true,
    },
    plugins: [
      'build',
      'revision-data',
      'compress',
      's3',
      'fastboot-s3',
      'cloudfront',
      'smart-compress',
    ],
    build: {},
    s3: {
      allowOverwrite: true,
      bucket: process.env.AWS_S3_BUCKET,
      region: process.env.AWS_REGION,
      filePattern: '**/*',
    },
    'fastboot-s3': {
      bucket: process.env.AWS_S3_BUCKET,
      region: process.env.AWS_REGION,
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
    ENV.plugins = ['build', 'smart-compress'];
  }

  if (
    deployTarget === 's3-preview-staging' ||
    deployTarget === 's3-preview-production'
  ) {
    ENV.s3.prefix = process.env.PR_BRANCH_NAME;
    ENV['fastboot-s3'].prefix = process.env.PR_BRANCH_NAME;
  }

  return ENV;
};
