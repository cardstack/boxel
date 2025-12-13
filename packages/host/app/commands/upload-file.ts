import { service } from '@ember/service';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import HostBaseCommand from '../lib/host-base-command';
import type RealmServerService from '../services/realm-server';

const ALLOWED_TYPES = [
  'audio/',
  'application/pdf',
  'model/gltf+json',
  'model/gltf-binary',
  'application/octet-stream', // fallback for GLB or unknown binary
];

export default class UploadFileCommand extends HostBaseCommand<
  typeof BaseCommandModule.UploadFileInput,
  typeof BaseCommandModule.UploadFileResult
> {
  @service declare realmServer: RealmServerService;

  static actionVerb = 'Upload';
  description = 'Upload a file to R2 via presigned URL';

  async getInputType() {
    const module = await this.loadCommandModule();
    const { UploadFileInput } = module;
    return UploadFileInput;
  }

  private defaultPrefix(realmUrl?: string): string {
    // Build path: {user}/{realm_name}
    // e.g., "user_matrix.boxel.ai/experiments"
    const parts: string[] = [];

    // Get user ID from realm server claims
    try {
      const userId = (this.realmServer as any).claims?.user;
      if (userId) {
        // Sanitize: @user:matrix.boxel.ai -> user_matrix.boxel.ai
        const sanitizedUser = userId
          .replace(/^@/, '')
          .replace(/[^a-zA-Z0-9.-]/g, '_')
          .replace(/_+/g, '_');
        parts.push(sanitizedUser);
      }
    } catch {
      // No user available
    }

    // Get realm name from URL
    if (realmUrl) {
      try {
        const url = new URL(realmUrl);
        // Extract last path segment as realm name
        // e.g., "http://localhost:4201/experiments/" -> "experiments"
        const pathSegments = url.pathname.split('/').filter(Boolean);
        const realmName = pathSegments[pathSegments.length - 1] || 'default';
        parts.push(realmName);
      } catch {
        // Invalid URL
      }
    }

    // Fallback if no parts collected
    if (parts.length === 0) {
      return 'uploads';
    }

    return parts.join('/');
  }

  protected async run(
    input: BaseCommandModule.UploadFileInput,
  ): Promise<BaseCommandModule.UploadFileResult | undefined> {
    const {
      baseUrl: inputBaseUrl,
      fileName,
      contentType,
      fileDataUri,
      keyPrefix,
      realmUrl,
    } = input;
    const { UploadFileResult } = await this.loadCommandModule();

    // Log upload context for debugging
    const userId = (this.realmServer as any).claims?.user ?? '(not logged in)';
    console.log('[UploadFileCommand] Upload context:', {
      userId,
      realmUrl: realmUrl ?? '(not provided)',
      keyPrefix: keyPrefix ?? '(using default)',
      fileName,
      contentType,
    });

    const fileForAttachment = input.fileForAttachment as
      | {
          url?: string;
          sourceUrl?: string;
          name?: string;
          contentType?: string;
        }
      | undefined;

    let resolvedFileName = fileName;
    let resolvedContentType = contentType;
    let blob: Blob | null = null;

    if (fileForAttachment) {
      const sourceUrl = fileForAttachment.url ?? fileForAttachment.sourceUrl;
      if (!sourceUrl) {
        throw new Error('fileForAttachment is missing url/sourceUrl');
      }
      resolvedFileName = resolvedFileName ?? fileForAttachment.name ?? 'upload';
      resolvedContentType =
        resolvedContentType ?? fileForAttachment.contentType ?? '';

      const response = await fetch(sourceUrl);
      if (!response.ok) {
        const errorText = await safeReadText(response);
        throw new Error(
          `Failed to read attachment: ${response.status} ${response.statusText}${
            errorText ? ` - ${errorText}` : ''
          }`,
        );
      }
      blob = await response.blob();
      if (!resolvedContentType) {
        resolvedContentType = blob.type || 'application/octet-stream';
      }
    } else {
      if (!fileName || !contentType || !fileDataUri) {
        throw new Error(
          'fileName, contentType, and fileDataUri are required when fileForAttachment is not provided',
        );
      }
      resolvedFileName = fileName;
      resolvedContentType = contentType;
      blob = dataUriToBlob(fileDataUri, resolvedContentType).blob;
    }

    if (!resolvedContentType || !isAllowedContentType(resolvedContentType)) {
      throw new Error(`Unsupported content type: ${resolvedContentType}`);
    }

    const sanitizedFileName = slugifyFileName(resolvedFileName || 'upload');
    const defaultPrefix = this.defaultPrefix(realmUrl ?? undefined);
    const prefix =
      keyPrefix?.trim().replace(/\/+$/, '') || defaultPrefix || 'uploads';
    const objectKey = `${prefix}/${Date.now()}-${sanitizedFileName}`;
    const baseUrl = inputBaseUrl?.trim();

    // If baseUrl provided, send full URL; otherwise send objectKey and let server use default endpoint
    const presignArgs = baseUrl
      ? {
          url: joinUrl(baseUrl, objectKey),
          method: 'PUT',
          contentType: resolvedContentType,
        }
      : {
          objectKey,
          method: 'PUT',
          contentType: resolvedContentType,
        };

    const signedUrl = await this.realmServer.presignR2Upload(presignArgs);

    console.log('[UploadFileCommand] Presigned URL received:', signedUrl);
    console.log('[UploadFileCommand] Uploading blob:', {
      size: blob?.size,
      type: resolvedContentType,
    });

    let uploadResponse: Response;
    try {
      // Don't send Content-Type header with presigned URL uploads
      // R2/S3 will infer from the file or use application/octet-stream
      uploadResponse = await fetch(signedUrl, {
        method: 'PUT',
        body: blob,
      });
    } catch (fetchError: any) {
      console.error('[UploadFileCommand] Fetch error:', fetchError);
      throw new Error(
        `Upload fetch failed: ${fetchError?.message ?? fetchError}. This is likely a CORS issue - check R2 bucket CORS settings.`,
      );
    }

    console.log('[UploadFileCommand] Upload response:', {
      status: uploadResponse.status,
      statusText: uploadResponse.statusText,
      headers: Object.fromEntries(uploadResponse.headers.entries()),
    });

    if (!uploadResponse.ok) {
      const errorText = await safeReadText(uploadResponse);
      throw new Error(
        `Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}${
          errorText ? ` - ${errorText}` : ''
        }`,
      );
    }

    const etag = uploadResponse.headers.get('etag') ?? '';
    const uploadedUrl = presignArgs.url ?? signedUrl.split('?')[0] ?? '';
    return new UploadFileResult({
      uploadedUrl,
      etag,
    });
  }
}

function isAllowedContentType(contentType: string): boolean {
  return ALLOWED_TYPES.some((allowed) =>
    allowed.endsWith('/')
      ? contentType.startsWith(allowed)
      : contentType === allowed,
  );
}

function dataUriToBlob(
  dataUri: string,
  fallbackContentType: string,
): {
  blob: Blob;
  contentType: string;
} {
  const match = dataUri.match(/^data:([^;]+)?(;base64)?,(.*)$/);
  if (!match) {
    throw new Error('Invalid data URI provided');
  }

  const mimeType =
    match[1] || fallbackContentType || 'application/octet-stream';
  const isBase64 = match[2] === ';base64';
  const dataPart = match[3] || '';

  let byteArray: Uint8Array;
  if (isBase64) {
    const decoded =
      typeof atob === 'function'
        ? atob(dataPart)
        : Buffer.from(dataPart, 'base64').toString('binary');
    byteArray = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      byteArray[i] = decoded.charCodeAt(i);
    }
  } else {
    const decoded =
      typeof decodeURIComponent === 'function'
        ? decodeURIComponent(dataPart)
        : dataPart;
    byteArray = new TextEncoder().encode(decoded);
  }

  return {
    blob: new Blob([byteArray], { type: mimeType }),
    contentType: mimeType,
  };
}

function slugifyFileName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, '-');
  const parts = trimmed.split('.');
  if (parts.length > 1) {
    const ext = parts.pop();
    const base = parts.join('.').replace(/[^a-zA-Z0-9-_]/g, '');
    return `${base || 'file'}.${ext}`;
  }
  return trimmed.replace(/[^a-zA-Z0-9-_.]/g, '') || 'file.bin';
}

function joinUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
