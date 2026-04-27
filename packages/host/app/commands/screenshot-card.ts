import { service } from '@ember/service';

import { v4 as uuidv4 } from 'uuid';

import { logger } from '@cardstack/runtime-common';

const log = logger('screenshot-card');

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type NetworkService from '../services/network';

import PatchCardInstanceCommand from './patch-card-instance';
import WriteBinaryFileCommand from './write-binary-file';

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

function generateFilenameFromCardUrl(cardUrl: string): string {
  const uniqueId = uuidv4().split('-')[0];
  try {
    const url = new URL(cardUrl);
    const parts = url.pathname.split('/');
    const cardType = parts[parts.length - 2] || 'card';
    return `screenshot-${cardType}-${uniqueId}.png`;
  } catch {
    return `screenshot-${uniqueId}.png`;
  }
}

export default class ScreenshotCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.ScreenshotCardInput,
  typeof BaseCommandModule.ScreenshotCardOutput
> {
  @service declare private network: NetworkService;

  static actionVerb = 'Screenshot';
  description =
    'Take a Playwright screenshot of a card and save it as an ImageDef in the realm';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ScreenshotCardInput } = commandModule;
    return ScreenshotCardInput;
  }

  requireInputFields = ['cardUrl', 'targetRealmUrl'];

  protected async run(
    input: BaseCommandModule.ScreenshotCardInput,
  ): Promise<BaseCommandModule.ScreenshotCardOutput> {
    const {
      cardUrl,
      targetRealmUrl,
      format = 'fitted',
      browser,
      targetPath,
      targetCardId,
      screenshotIndex,
    } = input;

    if (!cardUrl?.trim()) {
      throw new Error('cardUrl is required');
    }

    if (!['isolated', 'embedded', 'fitted', 'atom'].includes(format)) {
      throw new Error('format must be one of: isolated, embedded, fitted, atom');
    }

    // Call the /_screenshot endpoint under the realm URL so authedFetch
    // finds the token automatically via the realm URL prefix match.
    const screenshotUrl = `${targetRealmUrl.replace(/\/$/, '')}/_screenshot`;
    const screenshotResponse = await this.network.authedFetch(screenshotUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'image/png',
      },
      body: JSON.stringify({ cardUrl, format, browser }),
    });

    if (!screenshotResponse.ok) {
      const errorBody = await screenshotResponse.text();
      throw new Error(
        `Failed to screenshot card: ${screenshotResponse.statusText} - ${errorBody}`,
      );
    }

    // Get the PNG bytes
    const pngArrayBuffer = await screenshotResponse.arrayBuffer();
    const base64Content = arrayBufferToBase64(pngArrayBuffer);

    // Write to realm
    const filename = generateFilenameFromCardUrl(cardUrl);
    const filePath = targetPath?.trim()
      ? `${targetPath.trim().replace(/\/$/, '')}/${filename}`
      : filename;

    const writeResult = await new WriteBinaryFileCommand(
      this.commandContext,
    ).execute({
      path: filePath,
      realm: targetRealmUrl,
      base64Content,
      contentType: 'image/png',
      useNonConflictingFilename: true,
    });

    if (!writeResult?.fileUrl) {
      throw new Error('Failed to write screenshot to realm.');
    }

    const imageDefUrl = writeResult.fileUrl;
    log.info('[screenshot-card] writeResult fileUrl: ' + imageDefUrl);

    if (targetCardId?.trim()) {
      const index = screenshotIndex ?? 0;
      const cardApiModule = await this.loaderService.loader.import<
        typeof CardAPI
      >('https://cardstack.com/base/card-api');

      await new PatchCardInstanceCommand(this.commandContext, {
        cardType: cardApiModule.CardDef as unknown as typeof CardDef,
      }).execute({
        cardId: targetCardId,
        patch: {
          relationships: {
            [`screenshots.${index}`]: { links: { self: imageDefUrl } },
          },
        },
      });
    }

    let commandModule = await this.loadCommandModule();
    const { ScreenshotCardOutput } = commandModule;
    return new ScreenshotCardOutput({ imageDefUrl });
  }
}
