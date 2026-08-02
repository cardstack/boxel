import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import {
  CardContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import {
  isRealmIframeSandboxOutbound,
  realmIframeSandboxProtocol,
} from '@cardstack/host/lib/realm-iframe-sandbox-protocol';

import type { RealmIframeSandboxRender } from '@cardstack/host/services/realm-sandbox';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';

import type { Format } from '@cardstack/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    format?: Format;
    sandbox: RealmIframeSandboxRender;
    displayContainer?: boolean;
  };
}

// This is deliberately a renderer transport, not a card-specific adapter.
// Authored cards and FieldDefs run through the ordinary CardRenderer in the
// child document and never observe the iframe or its lifecycle protocol.
export default class RealmSandboxIframe extends Component<Signature> {
  @service declare private realmSandbox: RealmSandboxService;
  @tracked private status = 'loading';
  @tracked private appliedDraftRevision = -1;
  @tracked private draftError?: string;
  private postToFrame?: (message: Record<string, unknown>) => void;
  private loaderMetricToken = {};

  get format() {
    return this.args.format ?? 'isolated';
  }

  get displayContainer() {
    return this.args.displayContainer !== false;
  }

  get isLoading() {
    return this.status === 'loading';
  }

  connectFrame = modifier((element: HTMLIFrameElement) => {
    // The target is required to be a distinct origin. credentialless prevents
    // accidental ambient-cookie authority from crossing into that origin.
    element.setAttribute('credentialless', '');
    if (this.args.sandbox.codePreviewID) {
      this.realmSandbox.registerIframeCodePreviewLoader(this.loaderMetricToken);
    }

    let channel: MessageChannel | undefined;
    let connected = false;
    let post = (message: Record<string, unknown>) =>
      channel?.port1.postMessage({
        protocol: realmIframeSandboxProtocol,
        ...message,
      });
    this.postToFrame = post;
    let receive = async (event: MessageEvent) => {
      if (!isRealmIframeSandboxOutbound(event.data)) {
        return;
      }
      if (event.data.type === 'ready') {
        this.status = 'ready';
        if (typeof event.data.revision === 'number') {
          this.appliedDraftRevision = event.data.revision;
          this.draftError = event.data.error;
          this.args.sandbox.onGenerationResult?.(
            event.data.revision,
            event.data.error,
          );
        }
      } else if (event.data.type === 'resize') {
        let height = Math.max(40, Math.min(2400, event.data.height));
        element.style.height = `${height}px`;
      } else if (event.data.type === 'fetch-request') {
        try {
          let response = await this.realmSandbox.fetchForIframe(
            this.args.sandbox,
            event.data.url,
            event.data.init,
          );
          post({
            type: 'fetch-response',
            requestId: event.data.requestId,
            response,
          });
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
          presentation: this.args.sandbox.presentation,
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
        event.source === element.contentWindow &&
        event.origin === this.args.sandbox.targetOrigin &&
        isRealmIframeSandboxOutbound(event.data) &&
        event.data.type === 'listening'
      ) {
        connect();
      }
    };
    element.addEventListener('load', connect);
    globalThis.addEventListener('message', receiveBootstrap);
    return () => {
      element.removeEventListener('load', connect);
      globalThis.removeEventListener('message', receiveBootstrap);
      channel?.port1.removeEventListener('message', receive);
      channel?.port1.close();
      this.postToFrame = undefined;
      this.realmSandbox.releaseIframeCodePreviewLoader(this.loaderMetricToken);
    };
  });

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
      [format, fieldName, componentModule, componentName, displayContainer]: [
        Format,
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
      }}
      data-card-sandbox-frame-status={{this.status}}
      data-card-sandbox-draft-revision={{@sandbox.draft.revision}}
      data-card-sandbox-applied-draft-revision={{this.appliedDraftRevision}}
      data-card-sandbox-draft-error={{this.draftError}}
      data-card-sandbox-code-preview-id={{@sandbox.codePreviewID}}
      data-card-sandbox-code-preview-loader={{if
        @sandbox.codePreviewID
        'dedicated'
      }}
      data-boxel-card-id={{@sandbox.cardID}}
      data-boxel-card-format={{this.format}}
      ...attributes
    >
      {{#if this.isLoading}}
        <div class='iframe-loading' data-card-sandbox-loading>
          <LoadingIndicator />
        </div>
      {{/if}}
      <iframe
        {{this.connectFrame}}
        {{this.syncPresentation
          @sandbox.presentation.format
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
        src={{@sandbox.url}}
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
      .isolated-format,
      .isolated-format iframe {
        height: 100%;
        min-height: 25rem;
      }
      .embedded-format,
      .embedded-format iframe {
        height: auto;
      }
    </style>
  </template>
}
