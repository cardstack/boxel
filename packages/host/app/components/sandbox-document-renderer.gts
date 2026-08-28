import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

// @ts-ignore — @glimmer/validator is provided by Ember but has no own types
import { untrack } from '@glimmer/validator';

import { resource, use } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';

import { rri, type LooseSingleCardDocument } from '@cardstack/runtime-common';

import type { BoxelExecutionSession } from '@cardstack/host/lib/boxel-execution-engine';
import type { SandboxRenderSlot } from '@cardstack/host/lib/sandbox-runtime-process';
import boxelSandboxSlot from '@cardstack/host/modifiers/boxel-sandbox-slot';

import type BoxelExecutionService from '@cardstack/host/services/boxel-execution';

import type { Format } from '@cardstack/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    document: LooseSingleCardDocument;
    relativeTo?: string;
    format?: Format;
    hostOwnsBox?: boolean;
  };
}

interface SandboxDocumentRendererState {
  [key: PropertyKey]: unknown;
  slot?: SandboxRenderSlot;
  reason?: string;
  painted: boolean;
  error?: Error;
}

/**
 * Document-first proof of the secure Sandbox entry.
 *
 * This component deliberately accepts an inert JSON:API document rather than
 * a `BaseDef`. The Host classifies and denies its authored module graph to the
 * Host Loader, and asks the iframe runtime to perform the first Card API
 * materialization. It is intentionally narrow while the wider
 * workspace/card-renderer API still assumes a canonical Host instance.
 */
export default class SandboxDocumentRenderer extends Component<Signature> {
  @service declare private boxelExecution: BoxelExecutionService;

  private readonly surfaceId: string;
  private readonly session: BoxelExecutionSession;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.surfaceId = this.boxelExecution.surfaceId();
    this.session = this.boxelExecution.createSession();
    registerDestructor(this, () => void this.session.destroy());
  }

  @use private execution = resource(({ on }) => {
    let document = this.args.document;
    let relativeTo = this.args.relativeTo;
    let format = this.args.format;
    let hostOwnsBox = this.args.hostOwnsBox;
    let state = new TrackedObject<SandboxDocumentRendererState>({
      painted: false,
    });
    let active = true;

    untrack(
      () =>
        void (async () => {
          try {
            let prepared = await this.boxelExecution.prepareSandboxDocument(
              document,
              format,
              this.surfaceId,
              relativeTo ? rri(relativeTo) : undefined,
            );
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
              true,
            );
            if (!reservation) {
              throw new Error(
                `Document-first admission did not select Sandbox for ${this.cardId}`,
              );
            }
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
            let stopWatchingPaint = process.onFirstPaint(() => {
              if (active) {
                state.painted = true;
              }
            });
            on.cleanup(stopWatchingMountFailure);
            on.cleanup(stopWatchingPaint);

            // The modifier needs an in-document slot before the child can
            // establish its private MessageChannels.
            await process.whenMounted(mountToken);
            if (!active) {
              return;
            }
            let generation = await this.session.update(prepared.request);
            if (!generation) {
              throw this.session.snapshot.error ?? new Error('Sandbox failed');
            }
            state.reason = generation.lease.decision.reason;
            let slot = await this.session.getRenderSlot(
              format ?? 'isolated',
              hostOwnsBox,
            );
            if (slot.owner !== 'sandbox') {
              throw new Error(
                `Document-first admission unexpectedly routed to ${slot.owner}`,
              );
            }
            state.slot = slot;
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
    return this.state.error?.message ?? 'Unknown Sandbox error';
  }

  private get effectiveFormat(): Format {
    return this.args.format ?? 'isolated';
  }

  private get cardId(): string {
    return this.args.document.data?.id ?? this.args.relativeTo ?? 'unknown';
  }

  <template>
    {{#if this.state.slot}}
      <div
        class='boxel-secure-sandbox-slot
          {{unless this.state.painted "is-booting"}}'
        data-boxel-execution='sandbox'
        data-boxel-execution-reason={{this.state.reason}}
        data-boxel-card-id={{this.cardId}}
        data-boxel-card-format={{this.effectiveFormat}}
        data-boxel-sandbox-painted={{if this.state.painted 'true' 'false'}}
        {{boxelSandboxSlot this.state.slot}}
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
    </style>
  </template>
}
