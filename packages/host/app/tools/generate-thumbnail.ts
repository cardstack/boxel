import { v4 as uuidv4 } from 'uuid';

import { DEFAULT_IMAGE_GENERATION_LLM } from '@cardstack/runtime-common/matrix-constants';

import HostBaseTool from '../lib/host-base-tool';

import PatchCardInstanceTool from './patch-card-instance';
import SendRequestViaProxyTool from './send-request-via-proxy';
import WriteBinaryFileTool from './write-binary-file';

import type * as CardAPI from '@cardstack/base/card-api';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const maybeBuffer = (globalThis as any).Buffer;

  if (typeof maybeBuffer !== 'undefined') {
    return maybeBuffer.from(buffer).toString('base64');
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  if (typeof btoa !== 'undefined') {
    return btoa(binary);
  }

  throw new Error('Unable to convert image to base64 in this environment');
}

function mimeTypeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
  };
  return map[mimeType] ?? 'png';
}

function generateFilenameFromCardName(cardName: string | undefined): string {
  const uniqueId = uuidv4().split('-')[0]; // Use first segment of UUID for brevity

  if (!cardName || !cardName.trim()) {
    return `thumbnail-${uniqueId}`;
  }

  // Take first two words and slugify
  const words = cardName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((word) => word.length > 0);

  if (words.length === 0) {
    return `thumbnail-${uniqueId}`;
  }

  return `${words.join('-')}-${uniqueId}`;
}

export default class GenerateThumbnailTool extends HostBaseTool<
  typeof BaseToolModule.GenerateThumbnailInput,
  typeof BaseToolModule.GenerateThumbnailOutput
> {
  static actionVerb = 'Generate';
  description =
    'Generate an AI thumbnail image and save it as an ImageDef in the realm';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { GenerateThumbnailInput } = commandModule;
    return GenerateThumbnailInput;
  }

  requireInputFields = ['prompt', 'targetRealmIdentifier'];

  protected async run(
    input: BaseToolModule.GenerateThumbnailInput,
  ): Promise<BaseToolModule.GenerateThumbnailOutput> {
    const {
      prompt,
      sourceImageUrl,
      targetRealmIdentifier,
      targetPath,
      targetCardId,
      cardName,
    } = input;

    let promptText = prompt?.trim();
    if (!promptText) {
      throw new Error('A prompt is required to generate a thumbnail.');
    }

    let imageUrlForMessage: string | undefined;
    const sourceUrlTrimmed = sourceImageUrl?.trim();

    if (sourceUrlTrimmed) {
      if (sourceUrlTrimmed.startsWith('data:image/')) {
        imageUrlForMessage = sourceUrlTrimmed;
      } else {
        const imageResponse = await fetch(sourceUrlTrimmed);
        if (!imageResponse.ok) {
          throw new Error(
            `Failed to fetch source image: ${imageResponse.statusText}`,
          );
        }
        const contentType =
          imageResponse.headers.get('content-type') ?? 'image/png';
        const arrayBuffer = await imageResponse.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);
        imageUrlForMessage = `data:${contentType};base64,${base64}`;
      }
    }

    const messages: any[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: promptText,
          },
          ...(imageUrlForMessage
            ? [
                {
                  type: 'image_url',
                  image_url: {
                    url: imageUrlForMessage,
                  },
                },
              ]
            : []),
        ],
      },
    ];

    const model = input.llmModel?.trim() || DEFAULT_IMAGE_GENERATION_LLM;

    const result = await new SendRequestViaProxyTool(this.toolContext).execute({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      method: 'POST',
      requestBody: JSON.stringify({
        model,
        messages,
      }),
    });

    if (!result.response.ok) {
      throw new Error(
        `Failed to generate thumbnail: ${result.response.statusText}`,
      );
    }

    const responseData = await result.response.json();
    const messageContent = responseData.choices?.[0]?.message;

    if (!messageContent?.images || !Array.isArray(messageContent.images)) {
      throw new Error('No image was generated in the response.');
    }

    const generatedDataUrl: string | undefined = messageContent.images
      .map((img: any) => img.image_url?.url)
      .find((url: string) => url && url.startsWith('data:image/'));

    if (!generatedDataUrl) {
      const errorMessage =
        responseData.choices?.[0]?.message?.content ||
        'No image was generated in the response.';
      throw new Error(`Thumbnail generation failed: ${errorMessage}`);
    }

    // Parse MIME type and base64 content from data URI
    const commaIndex = generatedDataUrl.indexOf(',');
    if (commaIndex === -1) {
      throw new Error(
        'Generated image data URL is malformed: missing comma separator.',
      );
    }
    const prefix = generatedDataUrl.slice(0, commaIndex);
    const base64Content = generatedDataUrl.slice(commaIndex + 1);
    const mimeMatch = prefix.match(/^data:([^;]+);base64$/);
    if (!mimeMatch) {
      throw new Error(
        'Generated image data URL has an unrecognisable MIME type.',
      );
    }
    const mimeType = mimeMatch[1];
    const extension = mimeTypeToExtension(mimeType);

    const filename = `${generateFilenameFromCardName(cardName)}.${extension}`;
    const filePath = targetPath?.trim()
      ? `${targetPath.trim().replace(/\/$/, '')}/${filename}`
      : filename;

    // Write binary to realm → realm indexes as PngDef/ImageDef automatically
    const writeResult = await new WriteBinaryFileTool(this.toolContext).execute(
      {
        path: filePath,
        realm: targetRealmIdentifier,
        base64Content,
        contentType: mimeType,
        useNonConflictingFilename: true,
      },
    );

    if (!writeResult?.fileIdentifier) {
      throw new Error('Failed to write binary file to realm.');
    }
    const imageDefIdentifier = writeResult.fileIdentifier;

    // If a targetCardId is provided, patch cardInfo.cardThumbnail to link the ImageDef
    if (targetCardId?.trim()) {
      const cardApiModule = await this.loaderService.loader.import<
        typeof CardAPI
      >('@cardstack/base/card-api');

      await new PatchCardInstanceTool(this.toolContext, {
        cardType: cardApiModule.CardDef as unknown as typeof CardDef,
      }).execute({
        cardId: targetCardId,
        patch: {
          relationships: {
            'cardInfo.cardThumbnail': {
              links: { self: imageDefIdentifier },
            },
          },
        },
      });
    }

    let commandModule = await this.loadToolModule();
    const { GenerateThumbnailOutput } = commandModule;
    return new GenerateThumbnailOutput({ imageDefIdentifier });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { GenerateThumbnailTool as GenerateThumbnailCommand };
