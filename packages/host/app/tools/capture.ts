import { service } from '@ember/service';

import { captureOutputContentType, rri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

// The nested capture spec the `/_capture` endpoint accepts, assembled
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
  type?: 'pdf';
  media?: 'print';
}

// One capture as the endpoint reports it. `url` is the durable served URL the
// capture persisted under — the only reference this tool consumes. A pdf
// capture reports `pageCount` and null pixel dimensions.
interface EndpointCapture {
  name: string | null;
  url: string | null;
  width: number | null;
  height: number | null;
  deviceScaleFactor: number | null;
  pageCount?: number;
}

export default class CaptureTool extends HostBaseTool<
  typeof BaseToolModule.CaptureInput,
  typeof BaseToolModule.CaptureOutput
> {
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Capture';
  description =
    'Capture a rendered card as a PNG image (the default) or, with ' +
    'type "pdf", as a paged PDF document; media "print" lays a PDF out under ' +
    "the card's print CSS. The capture is persisted to the media cache and " +
    'its served URL is returned into the room; fetch the URL to inspect it.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CaptureInput } = commandModule;
    return CaptureInput;
  }

  requireInputFields = ['card', 'format'];

  protected async run(
    input: BaseToolModule.CaptureInput,
  ): Promise<BaseToolModule.CaptureOutput> {
    let { card, format } = input;
    let normalizedFormat = format?.trim();
    if (!card) {
      throw new Error('A linked card is required to take a capture.');
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
        'Linked card must be saved before capturing (no id available).',
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
    // Capturing reads the card and captures it; nothing is written into
    // a realm, so read access is what it needs. The ungated POST endpoint
    // enforces realm read itself (and the worker enforces it on the render
    // path); this is a fast, clear local failure for a caller who plainly
    // can't see the realm.
    if (!this.realm.canRead(cardRealm)) {
      throw new Error(
        `Cannot capture ${cardURL}: no read access to its realm ${cardRealm}.`,
      );
    }

    let captureSpec = this.buildCaptureSpec(input);
    let hasSpec = Object.keys(captureSpec).length > 0;

    // Realm-JWT auth: send the card realm's token as the bearer. The endpoint
    // stays on `jwtMiddleware`, which validates a realm token the same as a
    // realm-server session token — and unlike `realmServer.authedFetch`, a
    // realm token needs no Matrix client, so this works in headless
    // (run-command) contexts too.
    let token = this.realm.token(cardRealm);
    if (!token && this.realmServer.hasClient) {
      // A publicly-readable realm can be known without a session (public
      // reads need no auth), but the endpoint sits behind `jwtMiddleware`,
      // which rejects an unauthenticated POST outright. Mint a session
      // rather than sending a request that can only 401. The mint is gated
      // on a Matrix client being present: `createRealmSession` awaits the
      // client, so without one the login would wait indefinitely instead of
      // failing. Headless contexts get their sessions up front — the
      // command-runner route restores them from storage before any tool
      // runs — so a missing token with no client falls through to the clear
      // no-session error below.
      await this.realm.login(cardRealm);
      token = this.realm.token(cardRealm);
    }
    if (!token) {
      throw new Error(
        `Cannot capture ${cardURL}: no session for realm ${cardRealm}.`,
      );
    }
    let headers: Record<string, string> = {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${token}`,
    };

    let endpoint = new URL('/_capture', this.realmServer.url);
    let response = await vn.fetch(endpoint.href, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: {
          type: 'capture',
          attributes: {
            realmURL: cardRealm,
            cardId: cardURL,
            format: normalizedFormat,
            // We only ever want the served URL — never the bytes. Every capture
            // this tool makes is canonical (format + capture spec), so it persists
            // and answers with a `captures[].url`.
            includeBase64: false,
            ...(hasSpec ? { captureSpec } : {}),
          },
        },
      }),
    });

    if (response.status === 503) {
      let retryAfter = response.headers.get('retry-after');
      throw new Error(
        `Capture is still rendering; retry${
          retryAfter ? ` after ${retryAfter}s` : ''
        }.`,
      );
    }
    if (!response.ok) {
      let text = await response.text().catch(() => '');
      throw new Error(
        `Capture request failed (${response.status} ${response.statusText}): ${text}`,
      );
    }

    let body: any = await response.json();
    let attrs = body?.data?.attributes;
    let outputLabel = captureSpec.type === 'pdf' ? 'PDF' : 'PNG';
    if (!attrs || attrs.status !== 'ready') {
      let detail = attrs?.error ?? JSON.stringify(body);
      throw new Error(
        `Capture job did not produce a ${outputLabel}: ${detail}`,
      );
    }

    let endpointCaptures: EndpointCapture[] = Array.isArray(attrs.captures)
      ? attrs.captures
      : [];
    if (endpointCaptures.length === 0) {
      throw new Error('Capture job returned no captures.');
    }

    // The capture persists and comes back with a served URL. If it doesn't —
    // the instance isn't indexed yet, or the server has no media-cache store —
    // there is nothing servable to return, so say so plainly rather than hand
    // back a blank capture.
    if (!endpointCaptures[0]?.url) {
      throw new Error(
        'Capture could not be persisted (the card may not be indexed yet); retry once indexing completes.',
      );
    }

    let commandModule = await this.loadToolModule();
    const { CaptureOutput, Capture } = commandModule;
    // The endpoint names only declared-slot captures; the canonical captures
    // this tool requests come back unnamed. Synthesize a name from what the
    // tool knows — it becomes the rendered image's alt text in the room.
    let cardTitle = (card as any).cardTitle as string | undefined;
    let fallbackName = `${cardTitle ?? cardURL} (${normalizedFormat})`;
    let contentType = captureOutputContentType(captureSpec.type ?? 'png');
    let captures = endpointCaptures.map(
      (capture) =>
        new Capture({
          name: capture.name ?? fallbackName,
          url: capture.url ?? '',
          contentType,
          width: capture.width ?? undefined,
          height: capture.height ?? undefined,
          pageCount: capture.pageCount ?? undefined,
        }),
    );

    return new CaptureOutput({ captures });
  }

  // Fold the flat primitive input fields back into the endpoint's nested
  // capture spec. Only supplied fields are emitted; the paired fields
  // (viewport width/height, the four clip edges) are all-or-nothing so a
  // half-specified region fails here with a clear message rather than as an
  // opaque 400 downstream. `fullPage` is emitted only when true — false is
  // the engine default, and the shared parse elides default-valued fields
  // before the capture identity is derived anyway (see `elideDefaults` in
  // capture-spec.ts), so an explicit false adds nothing.
  private buildCaptureSpec(
    input: BaseToolModule.CaptureInput,
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
      type,
      media,
    } = input;
    let spec: CaptureSpecBody = {};

    let normalizedType = type?.trim() || 'png';
    if (normalizedType !== 'png' && normalizedType !== 'pdf') {
      throw new Error(`type must be "png" or "pdf" (got: ${type}).`);
    }
    let normalizedMedia = media?.trim() || 'screen';
    if (normalizedMedia !== 'screen' && normalizedMedia !== 'print') {
      throw new Error(`media must be "screen" or "print" (got: ${media}).`);
    }
    if (normalizedType === 'pdf') {
      // A pdf paginates the whole settled render onto paper, so the raster
      // geometry has nothing to act on; the endpoint refuses it too, but a
      // local message names the tool's own fields.
      let rasterFields = {
        viewportWidth,
        viewportHeight,
        deviceScaleFactor,
        fullPage: fullPage === true ? true : undefined,
        clipX,
        clipY,
        clipWidth,
        clipHeight,
      };
      let given = Object.entries(rasterFields)
        .filter(([, value]) => value != null)
        .map(([field]) => field);
      if (given.length > 0) {
        throw new Error(
          `type "pdf" cannot be combined with ${given.join(', ')}: a PDF paginates the whole render onto paper.`,
        );
      }
      spec.type = 'pdf';
    }
    // The defaults ('png', 'screen') stay off the spec, matching how the
    // endpoint elides them from the capture identity.
    if (normalizedMedia === 'print') {
      spec.media = 'print';
    }

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

// Aliases realm content imports and names in codeRefs, so each name it uses
// resolves to this tool.
export { CaptureTool as CaptureCardTool, CaptureTool as CaptureCardCommand };
