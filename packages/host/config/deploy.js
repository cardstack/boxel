/* eslint-env node */

// `immutable` is only ever a safe promise about a content-addressed filename:
// the name changes whenever the content does, so a copy a browser holds forever
// can never be the wrong one. The build writes exactly those files under
// `assets/`.
//
// Every other path in the dist keeps its name from one build to the next, so an
// immutable copy of one is a copy the browser will keep using until the entry is
// evicted. `index.html` matters most — it is the only document that names the
// current bundle, so a pinned shell pins the whole app to the build it first
// loaded — but the Embroider virtual entrypoints (which carry `EmberENV` and the
// app stylesheet) and the service worker are the same hazard under equally
// stable URLs. Those revalidate on every request: a few small documents against
// an ETag, answered 304.
const CONTENT_ADDRESSED = 'assets/**';
const IMMUTABLE_CACHE_CONTROL = 'max-age=63072000, public, immutable';
const REVALIDATE_CACHE_CONTROL = 'no-cache, max-age=0, must-revalidate';
// `Expires` is ignored wherever `Cache-Control` is understood; it is set in the
// past so an HTTP/1.0-era cache reaches the same conclusion.
const REVALIDATE_EXPIRES = new Date(0);

// One dist, uploaded in two passes so each half carries the directive its
// filenames can back up. The patterns are complements, so every file is uploaded
// by exactly one pass.
const IMMUTABLE_UPLOAD = 's3-content-addressed';
const REVALIDATING_UPLOAD = 's3-stable-named';

module.exports = function (deployTarget) {
  let s3 = () => ({
    allowOverwrite: true,
    bucket: process.env.AWS_S3_BUCKET,
    region: process.env.AWS_REGION,
  });

  let ENV = {
    pipeline: {
      activateOnDeploy: true,
      alias: {
        s3: { as: [IMMUTABLE_UPLOAD, REVALIDATING_UPLOAD] },
      },
    },
    build: {},
    [IMMUTABLE_UPLOAD]: {
      ...s3(),
      filePattern: CONTENT_ADDRESSED,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    },
    [REVALIDATING_UPLOAD]: {
      ...s3(),
      filePattern: '**/*',
      fileIgnorePattern: CONTENT_ADDRESSED,
      cacheControl: REVALIDATE_CACHE_CONTROL,
      expires: REVALIDATE_EXPIRES,
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
    // A preview is rebuilt in place under one prefix, so nothing it serves is
    // content-addressed in a way that survives the next push to the PR. Every
    // file revalidates, so a reviewer returning later sees current state without
    // a shift-refresh.
    for (let upload of [IMMUTABLE_UPLOAD, REVALIDATING_UPLOAD]) {
      ENV[upload].prefix = process.env.PR_BRANCH_NAME;
      ENV[upload].cacheControl = REVALIDATE_CACHE_CONTROL;
      ENV[upload].expires = REVALIDATE_EXPIRES;
    }
  }

  return ENV;
};
