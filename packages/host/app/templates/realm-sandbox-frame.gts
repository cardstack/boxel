import { service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import { provide } from 'ember-provide-consume-context';
import RouteTemplate from 'ember-route-template';

import { safeModifier } from '@cardstack/boxel-ui/modifiers';

import {
  CardContextName,
  SupportedMimeType,
  type Loader,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';
import {
  compileCodePreviewDraftSource,
  sameCodePreviewModuleURL,
} from '@cardstack/host/lib/code-preview-sandbox';
import RealmIframeHeightService from '@cardstack/host/lib/realm-iframe-height-service';
import RealmIframeMediaBridge from '@cardstack/host/lib/realm-iframe-media-bridge';
import {
  isRealmIframeSandboxInbound,
  isRealmIframeSandboxConnect,
  realmIframeSandboxProtocol,
  type RealmIframeSandboxInbound,
  type RealmIframeSandboxDraft,
  type RealmIframeSandboxPresentation,
  type RealmIframeSandboxTypePresentation,
} from '@cardstack/host/lib/realm-iframe-sandbox-protocol';

import type { RealmSandboxFrameModel } from '@cardstack/host/routes/realm-sandbox-frame';
import type LoaderService from '@cardstack/host/services/loader-service';

import type * as CardAPI from '@cardstack/base/card-api';
import type { BaseDef, CardContext, Field } from '@cardstack/base/card-api';

interface Signature {
  Args: { model: RealmSandboxFrameModel };
}

type PendingFetch = {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
};

interface SafeElementSize {
  height: number;
  width: number;
}

// Avoid flashing transient transport state inside otherwise polished cards.
// Errors still render immediately; this copy is only for a genuinely slow
// module graph (for example, a cold Three.js CDN load).
const loadingMessageDelay = 3_000;

class RealmSandboxFrame extends Component<Signature> {
  @service declare private loaderService: LoaderService;

  @tracked private card?: BaseDef;
  @tracked private field?: Field;
  @tracked private error?: string;
  @tracked private showLoadingMessage = false;
  @tracked private presentation?: RealmIframeSandboxPresentation;

  private port?: MessagePort;
  private loader?: Loader;
  private fetchSequence = 0;
  private pendingFetches = new Map<string, PendingFetch>();
  private compiledDrafts = new WeakMap<
    RealmIframeSandboxDraft,
    Promise<string>
  >();
  private loadingMessageTimer?: ReturnType<typeof setTimeout>;
  private document?: LooseSingleCardDocument;
  private activeDraft?: RealmIframeSandboxDraft;
  private embeddedSize?: SafeElementSize;
  private mediaBridge?: RealmIframeMediaBridge;
  private latestDraftRevision = -1;
  private pendingDraft = Promise.resolve();

  @provide(CardContextName)
  // @ts-ignore "context is declared but not used"
  private get context(): CardContext {
    return { mode: 'host', submode: 'host' } as CardContext;
  }

  connect = modifier((element: HTMLElement) => {
    // Every iframe format reports intrinsic dimensions. The parent format CSS
    // remains authoritative for clipping, scrolling, and stretching. Embedded
    // additionally uses the safe modifier below so nested FieldDef content is
    // measured at the exact delegated root without giving authored code a DOM
    // or MessagePort capability.
    let heightService = new RealmIframeHeightService(element, (dimensions) =>
      this.post({ type: 'resize', ...dimensions }),
    );
    let announceListening = () =>
      globalThis.parent.postMessage(
        {
          protocol: realmIframeSandboxProtocol,
          type: 'listening',
          bootstrapID: this.args.model.bootstrapID,
        },
        this.args.model.parentOrigin,
      );
    // A warm iframe route can finish booting before the parent Glimmer
    // modifier has installed its bootstrap listener (and before it observes
    // the iframe load event). Keep advertising only the inert protocol marker
    // until the origin-checked MessagePort arrives. This makes the handshake
    // independent of module-cache timing without granting any capability.
    let listeningTimer = globalThis.setInterval(announceListening, 250);
    let acceptCapabilityPort = (event: MessageEvent) => {
      if (
        event.source !== globalThis.parent ||
        event.origin !== this.args.model.parentOrigin ||
        !isRealmIframeSandboxConnect(event.data) ||
        event.ports.length !== 1 ||
        this.port
      ) {
        return;
      }
      globalThis.clearInterval(listeningTimer);
      this.port = event.ports[0];
      globalThis.removeEventListener('message', acceptCapabilityPort);
      this.port.addEventListener('message', this.receive);
      this.port.start();
      heightService.start();
      this.mediaBridge = new RealmIframeMediaBridge(
        element,
        this.brokerFetch,
        event.data.rootModuleURL,
      );
      this.mediaBridge.start();
      if (this.embeddedSize) {
        this.post({ type: 'resize', ...this.embeddedSize });
      }
      this.loadingMessageTimer = globalThis.setTimeout(() => {
        if (!this.card && !this.error) {
          this.showLoadingMessage = true;
        }
      }, loadingMessageDelay);
      this.applyPresentation(event.data.presentation);
      void this.loadCard(event.data.document, event.data.draft);
    };
    globalThis.addEventListener('message', acceptCapabilityPort);
    announceListening();
    return () => {
      globalThis.clearInterval(listeningTimer);
      heightService.stop();
      this.mediaBridge?.stop();
      this.mediaBridge = undefined;
      globalThis.removeEventListener('message', acceptCapabilityPort);
      this.port?.removeEventListener('message', this.receive);
      this.port?.close();
      this.loader?.dispose();
      if (this.loadingMessageTimer) {
        globalThis.clearTimeout(this.loadingMessageTimer);
      }
      let error = new Error('Iframe renderer was destroyed');
      for (let pending of this.pendingFetches.values()) {
        pending.reject(error);
      }
      this.pendingFetches.clear();
    };
  });

  private post(message: Record<string, unknown>) {
    this.port?.postMessage({
      protocol: realmIframeSandboxProtocol,
      ...message,
    });
  }

  private reportEmbeddedSize = (dimensions: SafeElementSize) => {
    if (this.currentPresentation.format !== 'embedded') {
      return;
    }
    this.embeddedSize = dimensions;
    this.post({ type: 'resize', ...dimensions });
  };

  private receive = (event: MessageEvent) => {
    if (event.data?.type === 'fetch-response' && event.data.response) {
      console.error('Child received iframe fetch response', {
        valid: isRealmIframeSandboxInbound(event.data),
        bodyType: event.data.response.body?.constructor?.name,
        bodyLength: event.data.response.body?.byteLength,
      });
    }
    if (!isRealmIframeSandboxInbound(event.data)) {
      return;
    }
    let message: RealmIframeSandboxInbound = event.data;
    if (message.type === 'draft') {
      this.scheduleDraft(message);
      return;
    }
    if (message.type === 'render') {
      this.applyPresentation(message.presentation);
      return;
    }
    if (
      message.type !== 'fetch-response' ||
      typeof message.requestId !== 'string'
    ) {
      return;
    }
    let pending = this.pendingFetches.get(message.requestId);
    if (!pending) {
      return;
    }
    this.pendingFetches.delete(message.requestId);
    if (message.error || !message.response) {
      pending.reject(new Error(message.error ?? 'Host returned no response'));
      return;
    }
    let response = new Response(message.response.body, {
      headers: message.response.headers,
      status: message.response.status,
      statusText: message.response.statusText,
    });
    try {
      Object.defineProperty(response, 'url', {
        configurable: true,
        value: message.response.url,
      });
    } catch {
      // Response.url is diagnostic only; Loader retains the requested URL.
    }
    pending.resolve(response);
  };

  private brokerFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    let request = input instanceof Request ? input : new Request(input, init);
    if (request.headers.get('accept') === 'image/*') {
      console.error('Child requested iframe image', request.url);
    }
    let draft = this.activeDraft;
    if (draft && sameCodePreviewModuleURL(request.url, draft.sourceURL)) {
      let compiledSource = this.compiledDrafts.get(draft);
      if (!compiledSource) {
        compiledSource = compileCodePreviewDraftSource(draft);
        this.compiledDrafts.set(draft, compiledSource);
      }
      return new Response(await compiledSource, {
        status: 200,
        headers: { 'content-type': SupportedMimeType.CardSource },
      });
    }
    let requestId = `iframe-fetch-${++this.fetchSequence}`;
    let result = new Promise<Response>((resolve, reject) => {
      this.pendingFetches.set(requestId, { resolve, reject });
    });
    if (request.headers.get('accept') === 'image/*') {
      console.error('Child image broker port state', Boolean(this.port));
    }
    this.post({
      type: 'fetch-request',
      requestId,
      url: request.url,
      init: {
        method: request.method,
        headers: [...request.headers.entries()],
      },
    });
    return await result;
  };

  private async loadCard(
    document?: LooseSingleCardDocument,
    draft?: RealmIframeSandboxDraft,
  ) {
    try {
      let loader = this.loaderService.createDetachedLoader(this.brokerFetch);
      this.loader = loader;
      this.activeDraft = draft;
      let documentPromise = document
        ? Promise.resolve(document)
        : this.fetchCardDocument(loader);
      let loadedDocument = await documentPromise;
      this.document = loadedDocument;
      this.latestDraftRevision = draft?.revision ?? -1;
      await this.deserializeCard(loader, loadedDocument);
      // Let Glimmer commit the authored template, then enqueue declarative
      // media fetches before `ready`. The parent may react to presentation
      // metadata by replacing render state, so capability requests discovered
      // after `ready` could otherwise target a superseded MessagePort.
      await new Promise<void>((resolve) =>
        globalThis.requestAnimationFrame(() => resolve()),
      );
      await this.mediaBridge?.refresh();
      this.post({
        type: 'ready',
        cardID: this.args.model.cardID,
        typePresentation: this.typePresentationFor(this.card!),
        ...(draft ? { revision: draft.revision } : {}),
      });
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.post({
        type: 'ready',
        cardID: this.args.model.cardID,
        ...(draft
          ? {
              revision: draft.revision,
              error: this.error,
            }
          : {}),
      });
    } finally {
      if (this.loadingMessageTimer) {
        globalThis.clearTimeout(this.loadingMessageTimer);
        this.loadingMessageTimer = undefined;
      }
      this.showLoadingMessage = false;
    }
  }

  private async deserializeCard(
    loader: Loader,
    loadedDocument: LooseSingleCardDocument,
  ) {
    let api = await loader.import<typeof CardAPI>('@cardstack/base/card-api');
    let card = (await api.createFromSerialized(
      loadedDocument.data,
      loadedDocument,
      new URL(this.args.model.cardID),
      { loader },
    )) as BaseDef;
    let field = this.resolveFieldFor(card, api);
    this.cardAPI = api;
    this.card = card;
    this.field = field;
    this.error = undefined;
  }

  private cardAPI?: typeof CardAPI;

  private get currentPresentation(): RealmIframeSandboxPresentation {
    return (
      this.presentation ?? {
        format: this.args.model.format,
        fieldName: this.args.model.fieldName,
        codeRef: this.args.model.codeRef,
        displayContainer: this.args.model.displayContainer,
      }
    );
  }

  private applyPresentation(presentation: RealmIframeSandboxPresentation) {
    this.presentation = presentation;
    if (this.card && this.cardAPI) {
      try {
        this.field = this.resolveFieldFor(this.card, this.cardAPI);
        this.error = undefined;
      } catch (error) {
        this.field = undefined;
        this.error = error instanceof Error ? error.message : String(error);
      }
    }
  }

  private resolveFieldFor(card: BaseDef, api: typeof CardAPI) {
    let fieldName = this.currentPresentation.fieldName;
    if (!fieldName) {
      return undefined;
    }
    let fields = api.getFields(card) as Record<string, Field | undefined>;
    let field = fields[fieldName];
    if (!field) {
      throw new Error(`Could not resolve field ${fieldName}`);
    }
    return field;
  }

  private scheduleDraft(draft: RealmIframeSandboxDraft) {
    if (draft.revision <= this.latestDraftRevision) {
      return;
    }
    this.latestDraftRevision = draft.revision;
    this.pendingDraft = this.pendingDraft
      .catch(() => undefined)
      .then(async () => {
        if (
          draft.revision !== this.latestDraftRevision ||
          !this.loader ||
          !this.document
        ) {
          return;
        }
        this.activeDraft = draft;
        this.loader.invalidateModule(draft.sourceURL);
        try {
          await this.deserializeCard(this.loader, this.document);
        } catch (error) {
          // Keep the last valid card visible while the editor contains a
          // transient syntax/type error. The next valid revision retries the
          // same invalidated module graph.
          if (!this.card) {
            this.error = error instanceof Error ? error.message : String(error);
          }
          this.post({
            type: 'ready',
            cardID: this.args.model.cardID,
            revision: draft.revision,
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        if (draft.revision === this.latestDraftRevision) {
          this.post({
            type: 'ready',
            cardID: this.args.model.cardID,
            revision: draft.revision,
            typePresentation: this.typePresentationFor(this.card!),
          });
        }
      });
  }

  private typePresentationFor(
    card: BaseDef,
  ): RealmIframeSandboxTypePresentation {
    let definition = card.constructor as unknown as Record<string, unknown>;
    let rawDisplayName = definition.displayName;
    let fallbackName = definition.name;
    let displayName =
      typeof rawDisplayName === 'string' && rawDisplayName.length > 0
        ? rawDisplayName
        : typeof fallbackName === 'string' && fallbackName.length > 0
          ? fallbackName
          : 'Card';
    let rawHeaderColor = definition.headerColor;
    return {
      displayName: displayName.slice(0, 1_024),
      headerColor:
        typeof rawHeaderColor === 'string'
          ? rawHeaderColor.slice(0, 128)
          : null,
      prefersWideFormat: definition.prefersWideFormat === true,
    };
  }

  private async fetchCardDocument(loader: Loader) {
    let response = await loader.fetch(this.args.model.cardID, {
      headers: { Accept: SupportedMimeType.CardJson },
    });
    if (!response.ok) {
      throw new Error(
        `Could not load card (${response.status} ${response.statusText})`,
      );
    }
    return (await response.json()) as LooseSingleCardDocument;
  }

  <template>
    <main
      class={{this.currentPresentation.format}}
      data-realm-sandbox-frame
      {{this.connect}}
      {{safeModifier 'observe-size' this.reportEmbeddedSize}}
    >
      {{#if this.card}}
        <CardRenderer
          @card={{this.card}}
          @field={{this.field}}
          @codeRef={{this.currentPresentation.codeRef}}
          @format={{this.currentPresentation.format}}
          @displayContainer={{this.currentPresentation.displayContainer}}
        />
      {{else if this.error}}
        <div class='realm-sandbox-frame-error' role='alert'>
          Cannot render sandboxed card:
          {{this.error}}
        </div>
      {{else if this.showLoadingMessage}}
        <div class='realm-sandbox-frame-loading'>Loading sandboxed card…</div>
      {{/if}}
    </main>
    <style scoped>
      :global(html),
      :global(body) {
        margin: 0;
        background: transparent;
      }
      main {
        width: 100%;
        overflow: hidden;
      }
      main.isolated {
        min-height: 100vh;
      }
      .realm-sandbox-frame-loading,
      .realm-sandbox-frame-error {
        box-sizing: border-box;
        padding: 1rem;
        font:
          0.875rem/1.4 system-ui,
          sans-serif;
      }
      .realm-sandbox-frame-error {
        color: #b42318;
      }
    </style>
  </template>
}

export default RouteTemplate(RealmSandboxFrame);
