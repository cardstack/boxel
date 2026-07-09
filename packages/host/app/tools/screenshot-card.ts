import { service } from '@ember/service';

import { v4 as uuidv4 } from 'uuid';

import { rri } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import WriteBinaryFileTool from './write-binary-file';

import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';

function generateFilenameFromCard(cardId: string): string {
  const uniqueId = uuidv4().split('-')[0];
  let url: URL;
  try {
    url = new URL(cardId);
  } catch {
    return `screenshot-${uniqueId}`;
  }
  let lastSegment = decodeURIComponent(
    url.pathname.split('/').filter(Boolean).pop() ?? '',
  );
  let slug = lastSegment
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `${slug}-${uniqueId}` : `screenshot-${uniqueId}`;
}

export default class ScreenshotCardTool extends HostBaseTool<
  typeof BaseCommandModule.ScreenshotCardInput,
  typeof BaseCommandModule.ScreenshotCardOutput
> {
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Screenshot';
  description =
    "Screenshot a rendered card and save it as an ImageDef in the card's own realm";

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ScreenshotCardInput } = commandModule;
    return ScreenshotCardInput;
  }

  requireInputFields = ['card', 'format'];

  protected async run(
    input: BaseCommandModule.ScreenshotCardInput,
  ): Promise<BaseCommandModule.ScreenshotCardOutput> {
    let { card, format } = input;
    let normalizedFormat = format?.trim();
    if (!card) {
      throw new Error('A linked card is required to take a screenshot.');
    }
    if (normalizedFormat !== 'isolated' && normalizedFormat !== 'embedded') {
      throw new Error(
        `Format must be "isolated" or "embedded" (got: ${
          format ?? '<missing>'
        }).`,
      );
    }

    let cardId = (card as any).id as string | undefined;
    if (!cardId) {
      throw new Error(
        'Linked card must be saved before screenshotting (no id available).',
      );
    }

    // Resolve alias-form RRI to HTTP URL — the realm server does not know
    // the alias mapping and will fail to construct a URL from alias form.
    let vn = this.loaderService.loader.getVirtualNetwork()!;
    let cardURL = vn.toURL(cardId).href;

    // Target realm = the card's own realm. If the caller can't write there,
    // fail fast — no silent fallback to a different realm.
    let cardRealm = this.realm.realmOf(rri(cardURL));
    if (!cardRealm) {
      throw new Error(`Cannot determine realm for card ${cardURL}.`);
    }
    if (!this.realm.canWrite(cardRealm)) {
      throw new Error(
        `Cannot screenshot ${cardURL}: no write access to its realm ${cardRealm}.`,
      );
    }

    // Hit /_screenshot-card on the realm-server. The realm-server enqueues a
    // screenshot-card job; the worker drives Puppeteer through the prerender
    // pool to capture a settled PNG and we get base64 back.
    let endpoint = new URL('/_screenshot-card', this.realmServer.url);
    let response = await this.realmServer.authedFetch(endpoint.href, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'screenshot-card',
          attributes: {
            realmURL: cardRealm,
            cardId: cardURL, // wire field name kept as-is; CS-11458 will update endpoint to accept RRI
            format: normalizedFormat,
          },
        },
      }),
    });

    if (!response.ok) {
      let text = await response.text().catch(() => '');
      throw new Error(
        `Screenshot request failed (${response.status} ${response.statusText}): ${text}`,
      );
    }

    let body: any = await response.json();
    let attrs = body?.data?.attributes;
    if (!attrs || attrs.status !== 'ready' || !attrs.base64) {
      let detail = attrs?.error ?? JSON.stringify(body);
      throw new Error(`Screenshot job did not produce a PNG: ${detail}`);
    }

    // Write binary to the card's realm under Screenshots/. The realm indexer
    // promotes the PNG into a PngDef / ImageDef card automatically.
    let filename = `${generateFilenameFromCard(cardURL)}.png`;
    let filePath = `Screenshots/${filename}`;
    let writeResult = await new WriteBinaryFileTool(
      this.commandContext,
    ).execute({
      path: filePath,
      realm: cardRealm,
      base64Content: attrs.base64,
      contentType: 'image/png',
      useNonConflictingFilename: true,
    });

    if (!writeResult?.fileIdentifier) {
      throw new Error('Failed to write screenshot PNG to realm.');
    }

    let commandModule = await this.loadCommandModule();
    const { ScreenshotCardOutput } = commandModule;
    return new ScreenshotCardOutput({
      imageDefUrl: writeResult.fileIdentifier,
    });
  }
}
