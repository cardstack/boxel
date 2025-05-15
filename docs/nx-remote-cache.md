# Nx S3 Remote Cache Setup

This document outlines how to configure and use the S3 remote cache for Nx in both local development and CI environments.

## Overview

We use the `@nx/s3-cache` plugin to enable remote caching with S3-compatible storage for our Nx workspace. This helps:

- Speed up CI builds by reusing results from previous runs
- Share build results across developers to speed up local development
- Reduce redundant builds of the same code

## Local Development Setup

1. Copy `.env.example` to `.env` in the project root (this file is gitignored)
2. Fill in your S3 credentials:
   ```
   NX_S3_ACCESS_KEY=your_access_key_here
   NX_S3_SECRET_KEY=your_secret_key_here
   NX_S3_BUCKET=cardstack-boxel-nx-cache
   NX_S3_REGION=us-east-1
   ```

3. Run Nx commands as usual - they'll now use remote caching

## CI Setup

In CI environments:

1. GitHub Secrets need to be set up with the following values:
   - `NX_S3_ACCESS_KEY`
   - `NX_S3_SECRET_KEY`
   - `NX_S3_BUCKET`
   - `NX_S3_REGION`

2. Ensure your CI workflow imports the `nx-cache-config.yml` workflow to set up the environment variables.

## Implementation Details

The cache configuration is set up in `nx.json` using environment variables:

```json
"tasksRunnerOptions": {
  "default": {
    "runner": "@nx/s3-cache:s3",
    "options": {
      "cacheableOperations": ["build"],
      "accessKey": "${NX_S3_ACCESS_KEY}", 
      "secretKey": "${NX_S3_SECRET_KEY}",
      "bucket": "${NX_S3_BUCKET}",
      "region": "${NX_S3_REGION}"
    }
  }
}
```

## Common Commands

- Check cache status: `nx run-many --target=build --all --verbose`
- Clear local cache: `nx reset`
- Skip cache: `nx build boxel-icons --skip-nx-cache`
