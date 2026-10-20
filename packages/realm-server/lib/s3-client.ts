import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';

// The one place the runtime constructs S3 clients. Any store that speaks the
// S3 API can stand behind them (ADR 003 §1.3): AWS when S3_ENDPOINT is unset,
// or another S3-compatible store, such as Cloudflare R2, MinIO, or Google
// Cloud Storage's XML API, at the URL it names. Credentials come from the
// SDK's default chain: the task role on ECS, or AWS_ACCESS_KEY_ID and
// AWS_SECRET_ACCESS_KEY for a store that issues keys.
//
//   S3_ENDPOINT          the store's URL
//   S3_FORCE_PATH_STYLE  `true` to address buckets by path rather than by
//                        subdomain, as MinIO and most self-hosted stores need
//   AWS_REGION           the region, when the caller names none

const DEFAULT_REGION = 'us-east-1';

export function s3ClientConfig(
  { region }: { region?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): S3ClientConfig {
  let endpoint = env.S3_ENDPOINT?.trim();
  return {
    region: region?.trim() || env.AWS_REGION?.trim() || DEFAULT_REGION,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: env.S3_FORCE_PATH_STYLE?.trim() === 'true',
  };
}

export function createS3Client(opts: { region?: string } = {}): S3Client {
  return new S3Client(s3ClientConfig(opts));
}
