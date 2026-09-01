import { service } from '@ember/service';

import { rri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

// The nested capture spec the `/_screenshot-card` endpoint accepts, assembled
// from the tool's flat JSON-primitive input fields. Only the fields the caller
// supplied are set; an empty spec is the canonical (format-only) capture. Every
// field here is part of the capture's canonical identity, so a capture carrying
// any of them persists and serves under its own durable URL just like a
// format-only one.
interface CaptureSpecBody {
  viewport?: { width: number; height: number };
  deviceScaleFactor?: number;
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
}

// One capture as the endpoint reports it. `url` is the durable served URL the
// capture persisted under — the only reference this tool consumes.
interface EndpointCapture {
  name: string | null;
  url: string | null;
  width: number | null;
  height: number | null;
  deviceScaleFactor: number | null;
}

export default class ScreenshotCardTool extends HostBaseTool<
  typeof BaseToolModule.ScreenshotCardInput,
  typeof BaseToolModule.ScreenshotCardOutput
> {
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Screenshot';
  description =
    'Screenshot a rendered card. The capture is persisted to the media cache ' +
    'and its served URL is returned into the room, where it renders inline; ' +
    'fetch the URL to inspect the render.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { ScreenshotCardInput } = commandModule;
    return ScreenshotCardInput;
  }

  requireInputFields = ['card', 'format'];

  protected async run(
    input: BaseToolModule.ScreenshotCardInput,
  ): Promise<BaseToolModule.ScreenshotCardOutput> {
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

    let cardRealm = this.realm.realmOf(rri(cardURL));
    if (!cardRealm) {
      throw new Error(`Cannot determine realm for card ${cardURL}.`);
    }
    // Screenshotting reads the card; it no longer writes a file back, so read
    // access is what it needs. The ungated POST endpoint enforces realm read
    // itself (and the worker enforces it on the render path); this is a fast,
    // clear local failure for a caller who plainly can't see the realm.
    if (!this.realm.canRead(cardRealm)) {
      throw new Error(
        `Cannot screenshot ${cardURL}: no read access to its realm ${cardRealm}.`,
      );
    }

    let captureSpec = this.buildCaptureSpec(input);
    let hasGeometry = Object.keys(captureSpec).length > 0;

    // Realm-JWT auth: send the card realm's token as the bearer. The endpoint
    // stays on `jwtMiddleware`, which validates a realm token the same as a
    // realm-server session token — and unlike `realmServer.authedFetch`, a
    // realm token needs no Matrix client, so this works in headless
    // (run-command) contexts too.
    let token = this.realm.token(cardRealm);
    let headers: Record<string, string> = {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let endpoint = new URL('/_screenshot-card', this.realmServer.url);
    let response = await vn.fetch(endpoint.href, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: {
          type: 'screenshot-card',
          attributes: {
            realmURL: cardRealm,
            cardId: cardURL,
            format: normalizedFormat,
            // We only ever want the served URL — never the bytes. Every capture
            // this tool makes is canonical (format + geometry), so it persists
            // and answers with a `captures[].url`.
            includeBase64: false,
            ...(hasGeometry ? { captureSpec } : {}),
          },
        },
      }),
    });

    if (response.status === 503) {
      let retryAfter = response.headers.get('retry-after');
      throw new Error(
        `Screenshot is still rendering; retry${
          retryAfter ? ` after ${retryAfter}s` : ''
        }.`,
      );
    }
    if (!response.ok) {
      let text = await response.text().catch(() => '');
      throw new Error(
        `Screenshot request failed (${response.status} ${response.statusText}): ${text}`,
      );
    }

    let body: any = await response.json();
    let attrs = body?.data?.attributes;
    if (!attrs || attrs.status !== 'ready') {
      let detail = attrs?.error ?? JSON.stringify(body);
      throw new Error(`Screenshot job did not produce a PNG: ${detail}`);
    }

    let endpointCaptures: EndpointCapture[] = Array.isArray(attrs.captures)
      ? attrs.captures
      : [];
    if (endpointCaptures.length === 0) {
      throw new Error('Screenshot job returned no captures.');
    }

    // The capture persists and comes back with a served URL. If it doesn't —
    // the instance isn't indexed yet, or the server has no media-cache store —
    // there is nothing servable to return, so say so plainly rather than hand
    // back a blank capture.
    if (!endpointCaptures[0]?.url) {
      throw new Error(
        'Screenshot could not be persisted (the card may not be indexed yet); retry once indexing completes.',
      );
    }

    let commandModule = await this.loadToolModule();
    const { ScreenshotCardOutput, ScreenshotCapture } = commandModule;
    let captures = endpointCaptures.map(
      (capture) =>
        new ScreenshotCapture({
          name: capture.name ?? undefined,
          url: capture.url ?? '',
          width: capture.width ?? undefined,
          height: capture.height ?? undefined,
        }),
    );

    return new ScreenshotCardOutput({ captures });
  }

  // Fold the flat primitive input fields back into the endpoint's nested
  // capture spec. Only supplied fields are emitted; the paired fields
  // (viewport width/height, the four clip edges) are all-or-nothing so a
  // half-specified region fails here with a clear message rather than as an
  // opaque 400 downstream. `fullPage` is emitted only when true — false is the
  // engine default and would needlessly perturb the canonical capture identity.
  private buildCaptureSpec(
    input: BaseToolModule.ScreenshotCardInput,
  ): CaptureSpecBody {
    let {
      viewportWidth,
      viewportHeight,
      deviceScaleFactor,
      fullPage,
      clipX,
      clipY,
      clipWidth,
      clipHeight,
    } = input;
    let spec: CaptureSpecBody = {};

    if (viewportWidth != null || viewportHeight != null) {
      if (viewportWidth == null || viewportHeight == null) {
        throw new Error(
          'viewportWidth and viewportHeight must be provided together.',
        );
      }
      spec.viewport = { width: viewportWidth, height: viewportHeight };
    }

    if (deviceScaleFactor != null) {
      spec.deviceScaleFactor = deviceScaleFactor;
    }

    if (fullPage === true) {
      spec.fullPage = true;
    }

    let clipEdges = [clipX, clipY, clipWidth, clipHeight];
    if (clipEdges.some((edge) => edge != null)) {
      if (clipEdges.some((edge) => edge == null)) {
        throw new Error(
          'clipX, clipY, clipWidth, and clipHeight must be provided together.',
        );
      }
      spec.clip = {
        x: clipX!,
        y: clipY!,
        width: clipWidth!,
        height: clipHeight!,
      };
    }

    return spec;
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { ScreenshotCardTool as ScreenshotCardCommand };
