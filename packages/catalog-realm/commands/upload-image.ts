import { tracked } from '@glimmer/tracking';

import { isCardInstance, Command } from '@cardstack/runtime-common';

import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import UrlField from 'https://cardstack.com/base/url';
import StringField from 'https://cardstack.com/base/string';

import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';
import { CloudflareImage, CLOUDFLARE_ACCOUNT_ID } from '../cloudflare-image';

const CLOUDFLARE_IMAGE_INGEST_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/images/v1`;
const CLOUDFLARE_DIRECT_UPLOAD_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/images/v2/direct_upload`;

type UploadProgressStep =
  | 'idle'
  | 'requesting-direct-upload-url'
  | 'parsing-data-uri'
  | 'fetching-local-file'
  | 'uploading-local-file'
  | 'uploading-remote-url'
  | 'saving-card'
  | 'completed'
  | 'error';

interface CloudflareUploadResponse {
  success: boolean;
  errors: unknown[];
  result?: {
    id?: string;
    uploadURL?: string;
    [key: string]: unknown;
  };
}

interface DirectUploadDetails {
  uploadURL: string;
  id: string;
}

export class UploadImageInput extends CardDef {
  @field sourceImageUrl = contains(UrlField);
  @field targetRealmUrl = contains(StringField);
}

export class CardIdCard extends CardDef {
  @field cardId = contains(StringField);
}

export default class UploadImageCommand extends Command<
  typeof UploadImageInput,
  typeof CardIdCard
> {
  static actionVerb = 'Upload';
  description =
    'Uploads an image to Cloudflare Images and saves a CloudflareImage card in the specified realm';

  @tracked progressStep: UploadProgressStep = 'idle';

  async getInputType() {
    return UploadImageInput;
  }

  protected async run(input: UploadImageInput): Promise<CardIdCard> {
    if (!input.sourceImageUrl) {
      throw new Error('sourceImageUrl is required');
    }
    if (!input.targetRealmUrl) {
      throw new Error('targetRealm is required');
    }

    const sourceImageUrl = input.sourceImageUrl.trim();

    let isBlobUrl = sourceImageUrl.startsWith('blob:');
    let isDataUri = sourceImageUrl.startsWith('data:');
    if (!isBlobUrl && !isDataUri && !sourceImageUrl.startsWith('http')) {
      throw new Error('sourceImageUrl must be a valid URL');
    }

    const sendRequestCommand = new SendRequestViaProxyCommand(
      this.commandContext,
    );
    let cloudflareId: string;

    try {
      if (isBlobUrl || isDataUri) {
        this.progressStep = 'requesting-direct-upload-url';
        let { uploadURL, id } = await this.requestDirectUploadUrl(
          sendRequestCommand,
        );

        let blobDetails;
        if (isDataUri) {
          this.progressStep = 'parsing-data-uri';
          blobDetails = this.parseDataUri(sourceImageUrl);
        } else {
          this.progressStep = 'fetching-local-file';
          blobDetails = await this.fetchBlobFromObjectUrl(sourceImageUrl);
        }
        let { blob, fileName, contentType } = blobDetails;

        this.progressStep = 'uploading-local-file';
        let uploadPayload = await this.uploadBlobToCloudflare(
          uploadURL,
          blob,
          fileName,
          contentType,
        );

        cloudflareId = uploadPayload.result?.id ?? id;
        if (!cloudflareId) {
          throw new Error(
            'Cloudflare upload succeeded but no image id was returned',
          );
        }
      } else {
        this.progressStep = 'uploading-remote-url';
        let payload = await this.forwardRemoteUrl(
          sendRequestCommand,
          sourceImageUrl,
        );

        const remoteUploadId = payload.result?.id;
        if (!remoteUploadId) {
          throw new Error(
            'Cloudflare upload succeeded but no image id was returned',
          );
        }
        cloudflareId = remoteUploadId;
      }

      this.progressStep = 'saving-card';

      let saveCardCommand = new SaveCardCommand(this.commandContext);
      let cloudflareImageCard: CloudflareImage = new CloudflareImage({
        cloudflareId,
      });
      await saveCardCommand.execute({
        card: cloudflareImageCard,
        realm: input.targetRealmUrl,
      });
      if (!isCardInstance(cloudflareImageCard)) {
        throw new Error(
          `Failed to save CloudflareImage card: ${JSON.stringify(cloudflareImageCard, null, 2)}`,
        );
      }

      if (!cloudflareImageCard.id) {
        throw new Error('Saved CloudflareImage card does not have an id');
      }

      this.progressStep = 'completed';

      return new CardIdCard({
        cardId: cloudflareImageCard.id,
      });
    } catch (error) {
      this.progressStep = 'error';
      throw error;
    }
  }

  private async requestDirectUploadUrl(
    sendRequestCommand: SendRequestViaProxyCommand,
  ): Promise<DirectUploadDetails> {
    const directUploadResult = await sendRequestCommand.execute({
      url: CLOUDFLARE_DIRECT_UPLOAD_URL,
      method: 'POST',
      requestBody: JSON.stringify({
        requireSignedURLs: false,
      }),
      multipart: true,
    });

    const responseText = await directUploadResult.response.text();
    if (!directUploadResult.response.ok) {
      throw new Error(
        `Cloudflare direct upload URL request failed: ${directUploadResult.response.status} - ${responseText}`,
      );
    }

    let payload: CloudflareUploadResponse;
    try {
      payload = JSON.parse(responseText) as CloudflareUploadResponse;
    } catch (parseError) {
      throw new Error(
        `Unable to parse Cloudflare direct upload response: ${String(parseError)}`,
      );
    }

    if (!payload.success) {
      throw new Error(
        `Cloudflare direct upload request failed: ${JSON.stringify(payload, null, 2)}`,
      );
    }
    let uploadURL = payload.result?.uploadURL;
    let id = payload.result?.id;
    if (!uploadURL || !id) {
      throw new Error(
        'Cloudflare direct upload response did not include required fields',
      );
    }

    return { uploadURL, id };
  }

  private parseDataUri(dataUri: string) {
    const trimmed = dataUri.trim();
    if (!trimmed.startsWith('data:')) {
      throw new Error('Invalid data URI: missing data: prefix');
    }

    const commaIndex = trimmed.indexOf(',');
    if (commaIndex === -1) {
      throw new Error('Invalid data URI: missing data payload');
    }

    const metadataSection = trimmed.substring(5, commaIndex); // remove "data:"
    const payloadSection = trimmed.substring(commaIndex + 1);

    if (!payloadSection) {
      throw new Error('Invalid data URI: empty data payload');
    }

    const metadataParts = metadataSection.split(';').filter(Boolean);

    let mimeType = 'text/plain;charset=US-ASCII';
    let isBase64 = false;
    let providedFileName: string | undefined;

    for (let part of metadataParts) {
      if (part === 'base64') {
        isBase64 = true;
        continue;
      }
      if (part.startsWith('name=')) {
        providedFileName = part.slice('name='.length);
        continue;
      }
      if (part.includes('/')) {
        mimeType = part;
      } else if (part.startsWith('charset=')) {
        // Preserve charset parameter when no explicit mime type provided
        if (!mimeType.includes('/')) {
          mimeType = `text/plain;${part}`;
        }
      }
    }

    if (!mimeType.includes('/')) {
      mimeType = 'application/octet-stream';
    }

    const cleanedPayload = payloadSection.replace(/\s+/g, '');
    if (!cleanedPayload) {
      throw new Error('Invalid data URI: payload contains no data');
    }

    let byteArray: Uint8Array;
    const nodeBuffer = (globalThis as any).Buffer as
      | { from(input: string, encoding: string): Uint8Array }
      | undefined;
    if (isBase64) {
      try {
        if (nodeBuffer) {
          byteArray = new Uint8Array(
            nodeBuffer.from(cleanedPayload, 'base64'),
          );
        } else if (typeof atob === 'function') {
          const binaryString = atob(cleanedPayload);
          byteArray = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            byteArray[i] = binaryString.charCodeAt(i);
          }
        } else {
          throw new Error('No base64 decoder available in this environment');
        }
      } catch (error) {
        throw new Error(`Failed to decode base64 data URI payload: ${String(error)}`);
      }
    } else {
      try {
        const decoded = decodeURIComponent(cleanedPayload);
        const TextEncoderCtor = (globalThis as any).TextEncoder as
          | { new (): { encode(input: string): Uint8Array } }
          | undefined;
        if (TextEncoderCtor) {
          byteArray = new TextEncoderCtor().encode(decoded);
        } else {
          byteArray = new Uint8Array(decoded.length);
          for (let i = 0; i < decoded.length; i++) {
            byteArray[i] = decoded.charCodeAt(i);
          }
        }
      } catch (error) {
        throw new Error(`Failed to decode data URI payload: ${String(error)}`);
      }
    }

    const blob = new Blob([byteArray], { type: mimeType });
    if (providedFileName) {
      providedFileName = providedFileName.replace(/^"(.*)"$/, '$1');
      try {
        providedFileName = decodeURIComponent(providedFileName);
      } catch {
        // ignore decoding errors and keep original value
      }
    }
    const fileName =
      providedFileName ?? this.deriveFileNameFromMimeType(mimeType);
    const contentType = mimeType || 'application/octet-stream';

    return { blob, fileName, contentType };
  }

  private deriveFileNameFromMimeType(mimeType: string) {
    const extensionMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/avif': 'avif',
    };

    const extension = extensionMap[mimeType] ?? 'bin';
    return `upload.${extension}`;
  }

  private async fetchBlobFromObjectUrl(objectUrl: string) {
    let response: Response;
    try {
      response = await fetch(objectUrl);
    } finally {
      if (typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // Ignore - the browser may already have released the URL.
        }
      }
    }

    if (!response.ok) {
      throw new Error(
        `Failed to read local file from object URL: ${response.status} ${response.statusText}`,
      );
    }
    const blob = await response.blob();

    const maybeFile = blob as Blob & { name?: string };
    const fileName =
      typeof maybeFile.name === 'string' && maybeFile.name
        ? maybeFile.name
        : 'upload';
    const contentType = blob.type || 'application/octet-stream';

    return { blob, fileName, contentType };
  }

  private async uploadBlobToCloudflare(
    uploadURL: string,
    blob: Blob,
    fileName: string,
    contentType: string,
  ) {
    let fileForUpload: Blob;
    if (typeof File === 'function') {
      if (blob instanceof File) {
        fileForUpload = blob;
      } else {
        fileForUpload = new File([blob], fileName, { type: contentType });
      }
    } else {
      fileForUpload = blob;
    }

    const formData = new FormData();
    formData.append('file', fileForUpload, fileName);

    const response = await fetch(uploadURL, {
      method: 'POST',
      body: formData,
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Cloudflare direct upload failed: ${response.status} - ${responseText}`,
      );
    }

    let payload: CloudflareUploadResponse;
    try {
      payload = JSON.parse(responseText) as CloudflareUploadResponse;
    } catch (parseError) {
      throw new Error(
        `Unable to parse Cloudflare direct upload result: ${String(parseError)}`,
      );
    }

    if (!payload.success) {
      throw new Error(
        `Cloudflare direct upload failed: ${JSON.stringify(payload, null, 2)}`,
      );
    }

    return payload;
  }

  private async forwardRemoteUrl(
    sendRequestCommand: SendRequestViaProxyCommand,
    sourceImageUrl: string,
  ) {
    const proxyResult = await sendRequestCommand.execute({
      url: CLOUDFLARE_IMAGE_INGEST_URL,
      method: 'POST',
      requestBody: JSON.stringify({
        url: sourceImageUrl,
      }),
      multipart: true,
    });

    const responseText = await proxyResult.response.text();
    if (!proxyResult.response.ok) {
      throw new Error(
        `Cloudflare upload failed: ${proxyResult.response.status} - ${responseText}`,
      );
    }

    let payload: CloudflareUploadResponse;
    try {
      payload = JSON.parse(responseText) as CloudflareUploadResponse;
    } catch (parseError) {
      throw new Error(
        `Unable to parse Cloudflare upload response: ${String(parseError)}`,
      );
    }
    if (!payload.success) {
      throw new Error(
        `Cloudflare upload failed: ${JSON.stringify(payload, null, 2)}`,
      );
    }

    return payload;
  }

}
