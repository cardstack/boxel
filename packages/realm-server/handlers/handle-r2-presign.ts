import type Koa from 'koa';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SupportedMimeType, logger } from '@cardstack/runtime-common';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations';
import type { DBAdapter } from '@cardstack/runtime-common';

const log = logger('r2-presign');
const R2_DEFAULT_ENDPOINT_URL =
  process.env.R2_DEFAULT_ENDPOINT_URL ||
  'https://f555cbf0b7026091bfc32265980b548d.r2.cloudflarestorage.com/user-uploads/';

type R2Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
};

interface R2PresignRequest {
  url?: string;
  objectKey?: string;
  method?: string;
  expiresInSeconds?: number;
  contentType?: string;
}

export default function handleR2Presign({
  dbAdapter,
}: {
  dbAdapter: DBAdapter;
}) {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      const request = await fetchRequestFromContext(ctxt);
      const rawBody = await request.text();

      let body: R2PresignRequest;
      try {
        body = JSON.parse(rawBody || '{}');
      } catch (error) {
        log.warn('Failed to parse presign request body', error);
        await sendResponseForBadRequest(ctxt, 'Body must be valid JSON');
        return;
      }

      const destinations = AllowedProxyDestinations.getInstance(dbAdapter);
      const targetUrl = body.url;
      const objectKey = body.objectKey;

      if (!targetUrl && !objectKey) {
        await sendResponseForBadRequest(
          ctxt,
          'Either url or objectKey is required',
        );
        return;
      }

      let destinationConfig;
      let url: URL;

      if (targetUrl) {
        url = new URL(targetUrl);
        destinationConfig = await destinations.getDestinationConfig(
          url.toString(),
        );
      } else {
        // When only objectKey is provided, look up the default R2 endpoint directly
        destinationConfig = await destinations.getDestinationConfig(
          R2_DEFAULT_ENDPOINT_URL,
        );
        if (destinationConfig) {
          url = new URL(objectKey!, destinationConfig.url);
        } else {
          log.warn(
            'R2 default endpoint not found in proxy_endpoints. R2_DEFAULT_ENDPOINT_URL:',
            R2_DEFAULT_ENDPOINT_URL,
          );
          await sendResponseForBadRequest(
            ctxt,
            `R2 endpoint not configured. Add '${R2_DEFAULT_ENDPOINT_URL}' to proxy_endpoints.`,
          );
          return;
        }
      }

      if (!destinationConfig) {
        await sendResponseForBadRequest(
          ctxt,
          `Endpoint ${targetUrl ?? objectKey} is not whitelisted.`,
        );
        return;
      }

      const credentials = parseCredentials(destinationConfig.credentials);
      if (!credentials) {
        await sendResponseForBadRequest(
          ctxt,
          'Proxy endpoint credentials must be provided with accessKeyId and secretAccessKey',
        );
        return;
      }

      const method = (body.method || 'PUT').toUpperCase();
      const expiresInSeconds = clampExpiry(body.expiresInSeconds);

      const signedUrl = await presignUrl({
        url,
        method,
        expiresInSeconds,
        contentType: body.contentType,
        credentials,
      });

      const response = new Response(JSON.stringify({ url: signedUrl }), {
        status: 200,
        headers: {
          'content-type': SupportedMimeType.JSON,
        },
      });

      await setContextResponse(ctxt, response);
    } catch (error) {
      log.error('Error creating R2 presigned URL', error);
      await sendResponseForSystemError(
        ctxt,
        'An error occurred while creating the presigned URL',
      );
    }
  };
}

function parseCredentials(
  credentials: string | Record<string, unknown> | null | undefined,
): R2Credentials | null {
  if (credentials == null) {
    return null;
  }

  let candidate: unknown = credentials;

  if (typeof credentials === 'string') {
    try {
      candidate = JSON.parse(credentials);
    } catch (error) {
      log.warn('Expected JSON credentials for R2 presign', error);
      return null;
    }
  }

  if (
    candidate &&
    typeof candidate === 'object' &&
    'accessKeyId' in candidate &&
    'secretAccessKey' in candidate
  ) {
    const accessKeyId = (candidate as Record<string, unknown>).accessKeyId;
    const secretAccessKey = (candidate as Record<string, unknown>)
      .secretAccessKey;
    const region = (candidate as Record<string, unknown>).region;

    if (
      typeof accessKeyId === 'string' &&
      typeof secretAccessKey === 'string'
    ) {
      return {
        accessKeyId,
        secretAccessKey,
        region: typeof region === 'string' ? region : 'auto',
      };
    }
  }

  return null;
}

function clampExpiry(expiresInSeconds?: number) {
  const fallback = 900; // 15 minutes
  if (!expiresInSeconds || Number.isNaN(expiresInSeconds)) {
    return fallback;
  }
  return Math.min(Math.max(60, expiresInSeconds), 3600);
}

async function presignUrl({
  url,
  method,
  expiresInSeconds,
  contentType,
  credentials,
}: {
  url: URL;
  method: string;
  expiresInSeconds: number;
  contentType?: string;
  credentials: R2Credentials;
}): Promise<string> {
  const region = credentials.region || 'auto';

  // Extract bucket name and key from the URL
  // URL format: https://<account-id>.r2.cloudflarestorage.com/<bucket>/<key>
  const pathParts = url.pathname.split('/').filter(Boolean);
  const bucket = pathParts[0];
  const key = pathParts.slice(1).join('/');

  const client = new S3Client({
    region,
    endpoint: `https://${url.host}`,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });

  let command;
  if (method === 'PUT') {
    command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });
  } else {
    command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
  }

  const signedUrl = await getSignedUrl(client, command, {
    expiresIn: expiresInSeconds,
  });

  return signedUrl;
}
