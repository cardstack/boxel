import { v4 as uuidv4 } from 'uuid';

import {
  generateImage,
  imageExtension,
  sourceImageDataUrl,
} from '../lib/generate-image';
import HostBaseTool from '../lib/host-base-tool';

import PatchCardInstanceTool from './patch-card-instance';
import SendRequestViaProxyTool from './send-request-via-proxy';
import WriteBinaryFileTool from './write-binary-file';

import type * as CardAPI from '@cardstack/base/card-api';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

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

    const sourceUrlTrimmed = sourceImageUrl?.trim();
    const { mimeType, base64: base64Content } = await generateImage(
      {
        prompt: promptText,
        sourceImageDataUrl: sourceUrlTrimmed
          ? await sourceImageDataUrl(sourceUrlTrimmed, (url) => fetch(url))
          : undefined,
        model: input.llmModel,
      },
      async ({ url, requestBody }) =>
        (
          await new SendRequestViaProxyTool(this.toolContext).execute({
            url,
            method: 'POST',
            requestBody,
          })
        ).response,
    );
    const extension = imageExtension(mimeType);

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
