import { service } from '@ember/service';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import { provide } from 'ember-provide-consume-context';
import RouteTemplate from 'ember-route-template';

import {
  CardContextName,
  SupportedMimeType,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import type { Loader } from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';
import RealmIframeHeightService from '@cardstack/host/lib/realm-iframe-height-service';
import {
  isRealmIframeSandboxConnect,
  realmIframeSandboxProtocol,
  type RealmIframeSandboxInbound,
  type RealmIframeSandboxDraft,
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

  private port?: MessagePort;
  private loader?: Loader;
  private fetchSequence = 0;
  private pendingFetches = new Map<string, PendingFetch>();
  private loadingMessageTimer?: ReturnType<typeof setTimeout>;
  private document?: LooseSingleCardDocument;
  private latestDraftRevision = -1;
  private pendingDraft = Promise.resolve();

  @provide(CardContextName)
  // @ts-ignore "context is declared but not used"
  private get context(): CardContext {
    return { mode: 'host', submode: 'host' } as CardContext;
  }

  connect = modifier((element: HTMLElement) => {
    let heightService = new RealmIframeHeightService(element, (dimensions) =>
      this.post({ type: 'resize', ...dimensions }),
    );
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
      this.port = event.ports[0];
      this.port.addEventListener('message', this.receive);
      this.port.start();
      heightService.start();
      this.loadingMessageTimer = globalThis.setTimeout(() => {
        if (!this.card && !this.error) {
          this.showLoadingMessage = true;
        }
      }, loadingMessageDelay);
      void this.loadCard(event.data.document, event.data.draft);
    };
    globalThis.addEventListener('message', acceptCapabilityPort);
    globalThis.parent.postMessage(
      { protocol: realmIframeSandboxProtocol, type: 'listening' },
      this.args.model.parentOrigin,
    );
    return () => {
      heightService.stop();
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

  private receive = (event: MessageEvent) => {
    let message = event.data as Partial<RealmIframeSandboxInbound>;
    if (message?.protocol !== realmIframeSandboxProtocol) {
      return;
    }
    if (message.type === 'draft') {
      if (
        typeof message.sourceURL === 'string' &&
        typeof message.source === 'string' &&
        typeof message.revision === 'number'
      ) {
        this.scheduleDraft(message as RealmIframeSandboxDraft);
      }
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

  private brokerFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let request = input instanceof Request ? input : new Request(input, init);
    let requestId = `iframe-fetch-${++this.fetchSequence}`;
    let result = new Promise<Response>((resolve, reject) => {
      this.pendingFetches.set(requestId, { resolve, reject });
    });
    this.post({
      type: 'fetch-request',
      requestId,
      url: request.url,
      init: {
        method: request.method,
        headers: [...request.headers.entries()],
      },
    });
    return result;
  };

  private async loadCard(
    document?: LooseSingleCardDocument,
    draft?: RealmIframeSandboxDraft,
  ) {
    try {
      let loader = this.loaderService.createDetachedLoader(this.brokerFetch);
      this.loader = loader;
      let documentPromise = document
        ? Promise.resolve(document)
        : this.fetchCardDocument(loader);
      let loadedDocument = await documentPromise;
      this.document = loadedDocument;
      this.latestDraftRevision = draft?.revision ?? -1;
      await this.deserializeCard(loader, loadedDocument);
      this.post({
        type: 'ready',
        cardID: this.args.model.cardID,
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
    let field: Field | undefined;
    if (this.args.model.fieldName) {
      let fields = api.getFields(card) as Record<string, Field | undefined>;
      field = fields[this.args.model.fieldName];
      if (!field) {
        throw new Error(`Could not resolve field ${this.args.model.fieldName}`);
      }
    }
    this.field = field;
    this.card = card;
    this.error = undefined;
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
          });
        }
      });
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
    <main class={{@model.format}} data-realm-sandbox-frame {{this.connect}}>
      {{#if this.card}}
        <CardRenderer
          @card={{this.card}}
          @field={{this.field}}
          @codeRef={{@model.codeRef}}
          @format={{@model.format}}
          @displayContainer={{@model.displayContainer}}
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
      main.isolated,
      main.fitted {
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
