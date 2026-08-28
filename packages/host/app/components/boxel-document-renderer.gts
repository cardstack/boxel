import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

// @ts-ignore — @glimmer/validator is provided by Ember but has no own types
import { untrack } from '@glimmer/validator';

import { modifier } from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';
import { resource, use } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';

import {
  rri,
  surfaceHeightModeFor,
  PermissionsContextName,
  type BoxelDescription,
  type LooseSingleCardDocument,
  type Permissions,
} from '@cardstack/runtime-common';

import type { BoxelExecutionSession } from '@cardstack/host/lib/boxel-execution-engine';
import type { DirectRenderSlot } from '@cardstack/host/lib/direct-boxel-runtime';
import type { HTMLComponent } from '@cardstack/host/lib/html-component';
import type { SandboxRenderSlot } from '@cardstack/host/lib/sandbox-runtime-process';
import boxelSandboxSlot from '@cardstack/host/modifiers/boxel-sandbox-slot';

import type BoxelExecutionService from '@cardstack/host/services/boxel-execution';

import type { Format, ViewCardFn } from '@cardstack/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    document?: LooseSingleCardDocument;
    cardURL?: string;
    relativeTo?: string;
    format?: Format;
    hostOwnsBox?: boolean;
    viewCard?: ViewCardFn;
    /** Host-owned strengthening/selection; authored documents cannot request Direct. */
    execution?: 'auto' | 'direct' | 'sandbox';
    /**
     * Cloneable type metadata for Host UI such as Code mode. The executable
     * definition remains owned by Direct or the Sandbox child; this callback
     * receives only the Render Protocol description produced by that owner.
     */
    onDescription?: (description: BoxelDescription) => void;
  };
}

function canRetainPresentation(from: Format, to: Format): boolean {
  return (
    from === to ||
    (from === 'isolated' && to === 'edit') ||
    (from === 'edit' && to === 'isolated')
  );
}

interface BoxelDocumentRendererState {
  [key: PropertyKey]: unknown;
  slot?: DirectRenderSlot | SandboxRenderSlot;
  prerendered?: HTMLComponent;
  reason?: string;
  painted: boolean;
  error?: Error;
}

/**
 * Document-first Direct/Sandbox execution entry.
 *
 * This component deliberately accepts an inert JSON:API document rather than
 * a `BaseDef`. Trusted platform modules may materialize through Direct.
 * Authored modules are classified and denied to the Host Loader before the
 * iframe runtime performs the first Card API materialization.
 */
export default class BoxelDocumentRenderer extends Component<Signature> {
  @service declare private boxelExecution: BoxelExecutionService;

  @consume(PermissionsContextName)
  declare private hostPermissions: Permissions | undefined;

  private readonly surfaceId: string;
  private readonly session: BoxelExecutionSession;
  private previousExecution?: {
    cardId: string;
    format: Format;
    state: BoxelDocumentRendererState;
  };

  private syncSandboxContext = modifier(
    (
      _element: Element,
      [slot, permissions]: [
        SandboxRenderSlot | undefined,
        Permissions | undefined,
      ],
    ) => {
      if (!slot) {
        return;
      }
      void slot.process
        .pushContext(
          permissions
            ? { canRead: permissions.canRead, canWrite: permissions.canWrite }
            : null,
        )
        .then((result) => {
          if (!result.ok && result.error) {
            console.warn(
              '[sandbox-parent] context push failed',
              result.error.message,
            );
          }
        });
    },
  );

  private syncSandboxViewCard = modifier(
    (
      _element: Element,
      [slot, viewCard, containingFormat]: [
        SandboxRenderSlot | undefined,
        ViewCardFn | undefined,
        Format,
      ],
    ) => {
      if (!slot || !viewCard) {
        return;
      }
      return slot.process.setChildViewCardReceiver(
        (cardId, _requestedFormat, options) => {
          let url = new URL(cardId);
          if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            throw new Error(
              `Sandbox cannot navigate to unsupported URL protocol '${url.protocol}'`,
            );
          }
          viewCard(rri(url.href), containingFormat, options);
        },
      );
    },
  );

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.surfaceId = this.boxelExecution.surfaceId();
    this.session = this.boxelExecution.createSession();
    registerDestructor(this, () => void this.session.destroy());
  }

  @use private execution = resource(({ on }) => {
    let document = this.args.document;
    let cardURL = this.args.cardURL;
    let relativeTo = this.args.relativeTo;
    let format = this.args.format;
    let hostOwnsBox = this.args.hostOwnsBox;
    let execution = this.args.execution;
    let hostRequestedMode = execution === 'auto' ? undefined : execution;
    let effectiveFormat = format ?? 'isolated';
    let cardId = document?.data?.id ?? cardURL ?? relativeTo ?? 'unknown';
    let previousExecution = this.previousExecution;
    let retainedSandboxState =
      previousExecution &&
      previousExecution.cardId === cardId &&
      canRetainPresentation(previousExecution.format, effectiveFormat) &&
      previousExecution.state.slot?.owner === 'sandbox'
        ? previousExecution.state
        : undefined;
    let state = new TrackedObject<BoxelDocumentRendererState>({
      slot: retainedSandboxState?.slot,
      reason: retainedSandboxState?.reason,
      painted: retainedSandboxState?.painted ?? false,
    });
    this.previousExecution = {
      cardId,
      format: effectiveFormat,
      state,
    };
    let active = true;

    let activateSandboxSlot = (
      slot: SandboxRenderSlot,
      mountFailureWatched = false,
    ) => {
      if (document) {
        on.cleanup(
          this.boxelExecution.connectSandboxDocumentSync(
            document,
            slot.process,
          ),
        );
      }
      let stopWatchingPaint = slot.process.onFirstPaint(() => {
        if (active) {
          state.painted = true;
        }
      });
      let stopWatchingMountFailure = mountFailureWatched
        ? undefined
        : slot.process.onMountFailed((error) => {
            if (active) {
              state.slot = undefined;
              state.error = error;
            }
          });
      on.cleanup(stopWatchingPaint);
      if (stopWatchingMountFailure) {
        on.cleanup(stopWatchingMountFailure);
      }
    };

    untrack(
      () =>
        void (async () => {
          try {
            if (retainedSandboxState) {
              let retainedSlot = await this.session.switchSandboxFormat(
                effectiveFormat,
                hostOwnsBox,
              );
              if (!active) {
                return;
              }
              if (retainedSlot) {
                state.slot = retainedSlot;
                activateSandboxSlot(retainedSlot);
                return;
              }
            }
            if (format === 'fitted') {
              let cardId = document?.data?.id ?? cardURL ?? relativeTo;
              if (!cardId) {
                throw new Error(
                  'Fitted Boxel rendering requires a document id or cardURL',
                );
              }
              let prerendered =
                await this.boxelExecution.prerenderedComponentForURL(
                  cardId,
                  'fitted',
                );
              if (!active) {
                return;
              }
              if (!prerendered) {
                throw new Error(
                  `No prerendered fitted rendering is available for ${cardId}`,
                );
              }
              state.prerendered = prerendered;
              state.painted = true;
              return;
            }

            let prepared = document
              ? await this.boxelExecution.prepareDocument(
                  document,
                  format,
                  this.surfaceId,
                  relativeTo ? rri(relativeTo) : undefined,
                  hostRequestedMode,
                )
              : cardURL
                ? await this.boxelExecution.prepareDocumentURL(
                    cardURL,
                    format,
                    this.surfaceId,
                    hostRequestedMode,
                  )
                : undefined;
            if (!prepared) {
              throw new Error(
                'Boxel document rendering requires a document or cardURL',
              );
            }
            if (!active) {
              return;
            }
            let reservation = this.boxelExecution.reserveSandboxProcess(
              prepared.request.principal,
              prepared.request.surfaceId,
              prepared.request.trusted,
              prepared.request.format,
              prepared.classification,
              false,
              prepared.request.prefersFullSandbox ?? false,
            );
            if (reservation) {
              on.cleanup(reservation.release);
              let { process, mountToken } = reservation;
              state.slot = {
                owner: 'sandbox',
                iframe: process.iframe,
                surface: process.surface,
                mountToken,
                process,
              };
              let stopWatchingMountFailure = process.onMountFailed((error) => {
                if (active) {
                  state.slot = undefined;
                  state.error = error;
                }
              });
              on.cleanup(stopWatchingMountFailure);
              activateSandboxSlot(state.slot, true);

              // The modifier needs an in-document slot before the child can
              // establish its private MessageChannels.
              await process.whenMounted(mountToken);
              if (!active) {
                return;
              }
            }
            let generation = await this.session.update(prepared.request);
            if (!generation) {
              throw this.session.snapshot.error ?? new Error('Sandbox failed');
            }
            this.args.onDescription?.(
              structuredClone(generation.renderRecord.boxel),
            );
            state.reason = generation.lease.decision.reason;
            let slot = await this.session.getRenderSlot(
              format ?? 'isolated',
              hostOwnsBox,
            );
            if (slot.owner === 'capsule' || slot.owner === 'trusted-base') {
              throw new Error(
                `Document-first admission unexpectedly routed to ${slot.owner}`,
              );
            }
            state.slot = slot;
            if (slot.owner === 'direct') {
              state.painted = true;
            }
          } catch (error) {
            if (active) {
              state.slot = undefined;
              state.error =
                error instanceof Error ? error : new Error(String(error));
            }
          }
        })(),
    );

    on.cleanup(() => {
      active = false;
    });
    return state;
  });

  private get state() {
    return this.execution;
  }

  private get errorMessage(): string {
    return this.state.error?.message ?? 'Unknown execution error';
  }

  private get effectiveFormat(): Format {
    return this.args.format ?? 'isolated';
  }

  private get cardId(): string {
    return (
      this.args.document?.data?.id ??
      this.args.cardURL ??
      this.args.relativeTo ??
      'unknown'
    );
  }

  private get directSlot(): DirectRenderSlot | undefined {
    return this.state.slot?.owner === 'direct' ? this.state.slot : undefined;
  }

  private get formatClass(): string {
    let heightMode = surfaceHeightModeFor(
      this.effectiveFormat,
      this.args.hostOwnsBox,
    );
    return `boxel-document-format boxel-document-format--${this.effectiveFormat} boxel-document-height--${heightMode}`;
  }

  private get prerenderedComponent(): HTMLComponent {
    let component = this.state.prerendered;
    if (!component) {
      throw new Error('Prerendered fitted document component is not ready');
    }
    return component;
  }

  private get sandboxSlot(): SandboxRenderSlot | undefined {
    return this.state.slot?.owner === 'sandbox' ? this.state.slot : undefined;
  }

  private get directComponent(): DirectRenderSlot['component'] {
    let component = this.directSlot?.component;
    if (!component) {
      throw new Error('Direct document component is not ready');
    }
    return component;
  }

  <template>
    {{#if this.state.prerendered}}
      <div
        class={{this.formatClass}}
        data-boxel-execution='prerender'
        data-boxel-card-id={{this.cardId}}
        data-boxel-card-format={{this.effectiveFormat}}
        ...attributes
      >
        <this.prerenderedComponent />
      </div>
    {{else if this.directSlot}}
      <div
        class='boxel-document-direct-slot {{this.formatClass}}'
        data-boxel-execution='direct'
        data-boxel-execution-reason={{this.state.reason}}
        data-boxel-card-id={{this.cardId}}
        data-boxel-card-format={{this.effectiveFormat}}
        ...attributes
      >
        <this.directComponent />
      </div>
    {{else if this.sandboxSlot}}
      <div
        class='boxel-secure-sandbox-slot
          {{this.formatClass}}
          {{unless this.state.painted "is-booting"}}'
        data-boxel-execution='sandbox'
        data-boxel-execution-reason={{this.state.reason}}
        data-boxel-card-id={{this.cardId}}
        data-boxel-card-format={{this.effectiveFormat}}
        data-boxel-sandbox-painted={{if this.state.painted 'true' 'false'}}
        {{boxelSandboxSlot this.sandboxSlot}}
        {{this.syncSandboxContext this.sandboxSlot this.hostPermissions}}
        {{this.syncSandboxViewCard
          this.sandboxSlot
          @viewCard
          this.effectiveFormat
        }}
        ...attributes
      ></div>
    {{else if this.state.error}}
      <section class='boxel-execution-error' role='alert' ...attributes>
        <h3>Unable to render this card</h3>
        <p>{{this.errorMessage}}</p>
      </section>
    {{else}}
      <div
        class='boxel-secure-sandbox-loading'
        aria-label='Loading interactive card'
        aria-busy='true'
        ...attributes
      ></div>
    {{/if}}

    <style scoped>
      .boxel-secure-sandbox-slot {
        min-width: 0;
        width: 100%;
        min-height: 3rem;
        position: relative;
        overflow: hidden;
      }

      :global(.boxel-secure-sandbox-slot > iframe) {
        border: 0;
        display: block;
        width: 100%;
        height: 100%;
        min-height: inherit;
      }

      :global(.boxel-secure-sandbox-slot.is-booting > iframe) {
        opacity: 0;
        pointer-events: none;
      }

      .boxel-secure-sandbox-loading {
        min-height: 3rem;
      }

      .boxel-document-direct-slot {
        min-width: 0;
        width: 100%;
      }

      .boxel-document-format--isolated.boxel-document-height--allocated {
        height: 100%;
      }

      @layer baseComponent {
        .boxel-document-format--fitted {
          /*
           * Keep this boundary geometry identical to Base's
           * field-component fitted-format contract. The rendered card owns
           * everything inside the boundary; the Host must not add padding.
           */
          width: 100%;
          height: 100%;
          min-height: 40px;
          max-height: 600px;
          container-name: fitted-card;
          container-type: size;
          overflow: hidden;
        }
      }

      .boxel-document-format--embedded {
        container-name: embedded-card;
        container-type: inline-size;
        overflow: hidden;
      }

      .boxel-document-format--atom {
        display: contents;
      }

      .boxel-document-format--atom > :deep(*) {
        vertical-align: middle;
      }
    </style>
  </template>
}
