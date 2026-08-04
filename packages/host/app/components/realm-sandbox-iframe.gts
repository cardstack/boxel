import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
// @ts-ignore - @glimmer/validator is provided by Ember but has no direct types
import { untrack } from '@glimmer/validator';

import { modifier } from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';

import {
  CardContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import {
  CardContextName,
  PermissionsContextName,
  type LooseSingleCardDocument,
  type Permissions,
} from '@cardstack/runtime-common';

import {
  isRealmIframeSandboxOutbound,
  realmIframeSandboxProtocol,
} from '@cardstack/host/lib/realm-iframe-sandbox-protocol';

import type { RealmIframeSandboxRender } from '@cardstack/host/services/realm-sandbox';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';

import type { CardContext, Format } from '@cardstack/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    format?: Format;
    sandbox: RealmIframeSandboxRender;
    displayContainer?: boolean;
    canWrite?: boolean;
    onCardDocumentUpdate?: (document: LooseSingleCardDocument) => Promise<void>;
    // Retained for the delegated FieldDef seam. Root-card persistence uses the
    // document update capability; a primitive delegated field may still emit
    // its existing data-only set effect.
    set?: (value: unknown) => void;
  };
}

function untrackedIframeModifier(
  callback: (element: HTMLIFrameElement) => void | (() => void),
) {
  return modifier((element: HTMLIFrameElement) =>
    untrack(() => callback(element)),
  );
}

// This is deliberately a renderer transport, not a card-specific adapter.
// Authored cards and FieldDefs run through the ordinary CardRenderer in the
// child document and never observe the iframe or its lifecycle protocol.
export default class RealmSandboxIframe extends Component<Signature> {
  @service declare private realmSandbox: RealmSandboxService;
  @consume(PermissionsContextName)
  declare private permissions: Permissions | undefined;
  @consume(CardContextName)
  declare private cardContext: CardContext | undefined;
  @tracked private status = 'loading';
  @tracked private appliedDraftRevision = -1;
  @tracked private draftError?: string;
  @tracked private receivedCardUpdateRevision = -1;
  @tracked private rawCardUpdateRevision = -1;
  @tracked private cardUpdateProtocolError?: string;
  @tracked private appliedCardUpdateRevision = -1;
  @tracked private persistedCardUpdateRevision = -1;
  @tracked private cardUpdateError?: string;
  private postToFrame?: (message: Record<string, unknown>) => void;
  private cardUpdateQueue = Promise.resolve();
  private loaderMetricToken = {};
  private connectionMetricToken = {};
  private readonly bootstrapID = globalThis.crypto.randomUUID();

  get format() {
    return this.args.format ?? 'isolated';
  }

  get displayContainer() {
    return this.args.displayContainer !== false;
  }

  get heightMode() {
    return this.args.sandbox.presentation.heightMode;
  }

  get isLoading() {
    return this.status === 'loading';
  }

  get canWrite() {
    return this.args.canWrite ?? this.permissions?.canWrite === true;
  }

  private async applyCardDocumentUpdate(document: LooseSingleCardDocument) {
    if (this.args.onCardDocumentUpdate) {
      await this.args.onCardDocumentUpdate(document);
      return;
    }
    if (!this.canWrite) {
      throw new Error('This realm is read-only');
    }
    let cardID = this.args.sandbox.cardID;
    if (!cardID || document.data.id !== cardID) {
      throw new Error('Iframe card update identity does not match');
    }
    let updated = await this.realmSandbox.updateOpaqueCardFromDocument(
      this.args.sandbox.card,
      document,
      { recomputeProjection: false },
    );
    if (!updated) {
      throw new Error('Iframe card update was rejected');
    }
    if (!this.cardContext) {
      throw new Error('Iframe card update has no Host Store context');
    }
    await this.cardContext.store.save(cardID);
    let saveError = this.cardContext.store.getSaveState(cardID)?.lastSaveError;
    if (saveError) {
      let message =
        typeof (saveError as { message?: unknown }).message === 'string'
          ? (saveError as { message: string }).message
          : 'The card update could not be persisted';
      throw new Error(message);
    }
  }

  get frameURL() {
    let url = new URL(this.args.sandbox.url);
    url.searchParams.set('bootstrapID', this.bootstrapID);
    return url.href;
  }

  connectFrame = untrackedIframeModifier((element: HTMLIFrameElement) => {
    // The target is required to be a distinct origin. credentialless prevents
    // accidental ambient-cookie authority from crossing into that origin.
    element.setAttribute('credentialless', '');
    this.realmSandbox.registerIframeConnection(this.connectionMetricToken);
    if (this.args.sandbox.codePreviewID) {
      this.realmSandbox.registerIframeCodePreviewLoader(this.loaderMetricToken);
    }

    let channel: MessageChannel | undefined;
    let connected = false;
    let post = (
      message: Record<string, unknown>,
      transfer: Transferable[] = [],
    ) =>
      channel?.port1.postMessage(
        {
          protocol: realmIframeSandboxProtocol,
          ...message,
        },
        transfer,
      );
    this.postToFrame = post;
    let receive = async (event: MessageEvent) => {
      let candidate = event.data as Record<string, unknown> | null;
      if (candidate?.type === 'card-update') {
        this.rawCardUpdateRevision =
          typeof candidate.revision === 'number' ? candidate.revision : -1;
      }
      if (!isRealmIframeSandboxOutbound(event.data)) {
        if (candidate?.type === 'card-update') {
          let document = candidate.document as
            | { data?: { type?: unknown; id?: unknown } }
            | undefined;
          this.cardUpdateProtocolError = `Rejected card-update envelope (data.type=${String(document?.data?.type)}, id=${String(document?.data?.id)})`;
        }
        return;
      }
      if (event.data.type === 'ready') {
        this.status = 'ready';
        if (event.data.typePresentation) {
          this.args.sandbox.onTypePresentation?.(event.data.typePresentation);
        }
        if (typeof event.data.revision === 'number') {
          this.appliedDraftRevision = event.data.revision;
          this.draftError = event.data.error;
          this.args.sandbox.onGenerationResult?.(
            event.data.revision,
            event.data.error,
          );
        }
      } else if (event.data.type === 'resize') {
        if (this.heightMode !== 'intrinsic') {
          return;
        }
        let height = Math.max(40, Math.min(2400, event.data.height));
        element.style.height = `${height}px`;
      } else if (event.data.type === 'card-update') {
        this.receivedCardUpdateRevision = event.data.revision;
        let update = event.data;
        this.cardUpdateQueue = this.cardUpdateQueue.then(async () => {
          let error: string | undefined;
          try {
            if (!this.canWrite) {
              throw new Error('This realm is read-only');
            }
            if (
              this.args.sandbox.cardID &&
              update.document.data.id !== this.args.sandbox.cardID
            ) {
              throw new Error('Iframe card update identity does not match');
            }
            await this.applyCardDocumentUpdate(update.document);
          } catch (updateError) {
            error =
              updateError instanceof Error
                ? updateError.message
                : String(updateError);
          }
          post({
            type: 'card-update-result',
            revision: update.revision,
            ...(error ? { error } : {}),
          });
          this.appliedCardUpdateRevision = update.revision;
          if (!error) {
            this.persistedCardUpdateRevision = update.revision;
          }
          this.cardUpdateError = error;
        });
        await this.cardUpdateQueue;
      } else if (event.data.type === 'fetch-request') {
        try {
          let response = await this.realmSandbox.fetchForIframe(
            this.args.sandbox,
            event.data.url,
            event.data.init,
            event.data.purpose,
          );
          post(
            {
              type: 'fetch-response',
              requestId: event.data.requestId,
              response,
            },
            response.body instanceof ArrayBuffer ? [response.body] : [],
          );
        } catch (error) {
          post({
            type: 'fetch-response',
            requestId: event.data.requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };
    let connect = () => {
      if (connected) {
        return;
      }
      connected = true;
      globalThis.removeEventListener('message', receiveBootstrap);
      channel?.port1.close();
      channel = new MessageChannel();
      channel.port1.addEventListener('message', receive);
      channel.port1.start();
      element.contentWindow?.postMessage(
        {
          protocol: realmIframeSandboxProtocol,
          type: 'connect',
          document: this.args.sandbox.document,
          rootModuleURL: this.args.sandbox.rootModuleURL,
          presentation: this.args.sandbox.presentation,
          canWrite: this.canWrite,
          draft: this.args.sandbox.draft
            ? {
                protocol: realmIframeSandboxProtocol,
                type: 'draft',
                ...this.args.sandbox.draft,
              }
            : undefined,
        },
        this.args.sandbox.targetOrigin,
        [channel.port2],
      );
    };
    let receiveBootstrap = (event: MessageEvent) => {
      if (
        event.origin === this.args.sandbox.targetOrigin &&
        isRealmIframeSandboxOutbound(event.data) &&
        event.data.type === 'listening' &&
        event.data.bootstrapID === this.bootstrapID
      ) {
        // A credentialless cross-origin frame's MessageEvent WindowProxy is
        // not guaranteed to compare equal to a later contentWindow lookup.
        // The source comparison is unnecessary: exact origin, protocol, and
        // the per-render bootstrap ID bind this announcement to the iframe
        // whose URL carried that unguessable ID. The capability port is then
        // sent only to this component's own iframe.
        connect();
      }
    };
    globalThis.addEventListener('message', receiveBootstrap);
    return () => {
      globalThis.removeEventListener('message', receiveBootstrap);
      channel?.port1.removeEventListener('message', receive);
      channel?.port1.close();
      this.postToFrame = undefined;
      this.realmSandbox.releaseIframeConnection(this.connectionMetricToken);
      this.realmSandbox.releaseIframeCodePreviewLoader(this.loaderMetricToken);
    };
  });

  syncPermissions = modifier(
    (_element: HTMLIFrameElement, [canWrite]: [boolean]) => {
      this.postToFrame?.({
        type: 'permissions',
        canWrite,
      });
    },
  );

  syncHeightMode = modifier(
    (
      element: HTMLIFrameElement,
      [heightMode]: [RealmIframeSandboxRender['presentation']['heightMode']],
    ) => {
      if (heightMode === 'allocated') {
        element.style.removeProperty('height');
      }
    },
  );

  syncDraft = modifier(
    (
      _element: HTMLIFrameElement,
      [sourceURL, source, revision]: [
        string | undefined,
        string | undefined,
        number | undefined,
      ],
    ) => {
      if (sourceURL && source != null && revision != null) {
        this.postToFrame?.({
          type: 'draft',
          sourceURL,
          source,
          revision,
        });
      }
    },
  );

  syncPresentation = modifier(
    (
      _element: HTMLIFrameElement,
      [
        format,
        heightMode,
        fieldName,
        componentModule,
        componentName,
        displayContainer,
      ]: [
        Format,
        RealmIframeSandboxRender['presentation']['heightMode'],
        string | undefined,
        string | undefined,
        string | undefined,
        boolean,
      ],
    ) => {
      this.postToFrame?.({
        type: 'render',
        presentation: {
          format,
          heightMode,
          displayContainer,
          ...(fieldName ? { fieldName } : {}),
          ...(componentModule && componentName
            ? {
                codeRef: {
                  module: componentModule,
                  name: componentName,
                },
              }
            : {}),
        },
      });
    },
  );

  <template>
    <CardContainer
      @displayBoundaries={{this.displayContainer}}
      class={{cn
        'realm-sandbox-iframe'
        (if (eq this.format 'isolated') 'isolated-format')
        (if (eq this.format 'embedded') 'embedded-format')
        (if (eq this.format 'edit') 'edit-format')
        (if (eq this.heightMode 'allocated') 'allocated-height')
        (if (eq this.heightMode 'intrinsic') 'intrinsic-height')
      }}
      data-card-sandbox-frame-status={{this.status}}
      data-card-sandbox-draft-revision={{@sandbox.draft.revision}}
      data-card-sandbox-applied-draft-revision={{this.appliedDraftRevision}}
      data-card-sandbox-draft-error={{this.draftError}}
      data-card-sandbox-can-write={{if this.canWrite 'true' 'false'}}
      data-card-sandbox-raw-update-revision={{this.rawCardUpdateRevision}}
      data-card-sandbox-received-update-revision={{this.receivedCardUpdateRevision}}
      data-card-sandbox-update-revision={{this.appliedCardUpdateRevision}}
      data-card-sandbox-persisted-update-revision={{this.persistedCardUpdateRevision}}
      data-card-sandbox-update-error={{this.cardUpdateError}}
      data-card-sandbox-update-protocol-error={{this.cardUpdateProtocolError}}
      data-card-sandbox-code-preview-id={{@sandbox.codePreviewID}}
      data-card-sandbox-code-preview-loader={{if
        @sandbox.codePreviewID
        'dedicated'
      }}
      data-boxel-card-id={{@sandbox.cardID}}
      data-boxel-card-format={{this.format}}
      data-card-sandbox-height-mode={{this.heightMode}}
      ...attributes
    >
      {{#if this.isLoading}}
        <div class='iframe-loading' data-card-sandbox-loading>
          <LoadingIndicator />
        </div>
      {{/if}}
      <iframe
        {{this.connectFrame}}
        {{this.syncPermissions this.canWrite}}
        {{this.syncHeightMode this.heightMode}}
        {{this.syncPresentation
          @sandbox.presentation.format
          @sandbox.presentation.heightMode
          @sandbox.presentation.fieldName
          @sandbox.presentation.codeRef.module
          @sandbox.presentation.codeRef.name
          @sandbox.presentation.displayContainer
        }}
        {{this.syncDraft
          @sandbox.draft.sourceURL
          @sandbox.draft.source
          @sandbox.draft.revision
        }}
        src={{this.frameURL}}
        title={{@sandbox.accessibleTitle}}
        sandbox='allow-scripts allow-same-origin'
        referrerpolicy='no-referrer'
      ></iframe>
    </CardContainer>

    <style scoped>
      .realm-sandbox-iframe {
        position: relative;
        display: block;
        width: 100%;
        min-height: 2.5rem;
        overflow: hidden;
      }
      .iframe-loading {
        position: absolute;
        z-index: 1;
        inset: 0;
        display: grid;
        place-items: center;
        min-height: 2.5rem;
        background-color: white;
      }
      iframe {
        display: block;
        width: 100%;
        min-height: 2.5rem;
        border: 0;
        color-scheme: light dark;
        background: transparent;
      }
      .allocated-height,
      .allocated-height iframe {
        height: 100%;
        min-height: 25rem;
      }
      .intrinsic-height,
      .intrinsic-height iframe {
        height: auto;
      }
    </style>
  </template>
}
