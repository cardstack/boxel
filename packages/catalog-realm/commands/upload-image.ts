import { isCardInstance, Command } from '@cardstack/runtime-common';

import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import UrlField from 'https://cardstack.com/base/url';
import StringField from 'https://cardstack.com/base/string';

import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';
import { CloudflareImage, CLOUDFLARE_ACCOUNT_ID } from '../cloudflare-image';

const CLOUDFLARE_IMAGE_INGEST_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/images/v1`;

interface CloudflareUploadResponse {
  success: boolean;
  errors: unknown[];
  result?: {
    id?: string;
    [key: string]: unknown;
  };
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

  async getInputType() {
    return UploadImageInput;
  }

  protected async run(input: UploadImageInput): Promise<CardIdCard> {
    if (!input.sourceImageUrl) {
      throw new Error('sourceImageUrl is required');
    }
    if (!input.sourceImageUrl.startsWith('http')) {
      throw new Error('sourceImageUrl must be a valid URL');
    }
    if (!input.targetRealmUrl) {
      throw new Error('targetRealm is required');
    }

    const sendRequestCommand = new SendRequestViaProxyCommand(
      this.commandContext,
    );
    const proxyResult = await sendRequestCommand.execute({
      url: CLOUDFLARE_IMAGE_INGEST_URL,
      method: 'POST',
      requestBody: JSON.stringify({
        url: input.sourceImageUrl,
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

    const cloudflareId = payload.result?.id;
    if (!cloudflareId) {
      throw new Error(
        'Cloudflare upload succeeded but no image id was returned',
      );
    }

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

    return new CardIdCard({
      cardId: cloudflareImageCard.id,
    });
  }
}
