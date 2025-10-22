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

    let isBlobUrl = input.sourceImageUrl.startsWith('blob:');
    if (!isBlobUrl && !input.sourceImageUrl.startsWith('http')) {
      throw new Error('sourceImageUrl must be a valid URL');
    }

    const sendRequestCommand = new SendRequestViaProxyCommand(
      this.commandContext,
    );
    let cloudflareId: string;

    try {
      if (isBlobUrl) {
        this.progressStep = 'requesting-direct-upload-url';
        let { uploadURL, id } = await this.requestDirectUploadUrl(
          sendRequestCommand,
        );

        this.progressStep = 'fetching-local-file';
        let {
          blob,
          fileName,
          contentType,
        } = await this.fetchBlobFromObjectUrl(input.sourceImageUrl);

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
          input.sourceImageUrl,
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
