import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { provide } from 'ember-provide-consume-context';
import { resource, use } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';

import { CardContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import {
  DefaultFormatsContextName,
  type RealmResourceIdentifier,
  type SurfaceHandle,
} from '@cardstack/runtime-common';

import HeadFormatPreview from '@cardstack/host/components/head-format-preview';
import type {
  BoxelExecutionRenderSlot,
  BoxelExecutionSessionSnapshot,
} from '@cardstack/host/lib/boxel-execution-engine';
import type {
  CapsuleComponent,
  CapsuleRenderSlot,
} from '@cardstack/host/lib/capsule-component';
import type { DirectRenderSlot } from '@cardstack/host/lib/direct-boxel-runtime';
import type { HTMLComponent } from '@cardstack/host/lib/html-component';
import type { SandboxRenderSlot } from '@cardstack/host/lib/sandbox-runtime-process';
import boxelSandboxSlot from '@cardstack/host/modifiers/boxel-sandbox-slot';
import surfaceElement from '@cardstack/host/modifiers/surface-element';

import type BoxelExecutionService from '@cardstack/host/services/boxel-execution';

import type {
  BaseDef,
  BoxComponent,
  FieldFormats,
  Format,
  ViewCardFn,
} from '@cardstack/base/card-api';
import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    card: BaseDef;
    format?: Format;
    displayContainer?: boolean;
    viewCard?: ViewCardFn;
    relativeTo?: RealmResourceIdentifier;
  };
}

type ExecutionRendererState = {
  [key: string]: unknown;
  snapshot: BoxelExecutionSessionSnapshot;
  slot?: BoxelExecutionRenderSlot;
  model?: Record<string, unknown>;
  fields?: Record<string, BoxComponent>;
  placeholder?: HTMLComponent;
  surface?: SurfaceHandle;
  /**
   * RP-15.3: the Sandbox slot mounts (and its iframe starts booting) before
   * the child has painted anything — the iframe needs real, in-document
   * layout to boot and measure correctly, so it is never hidden. The
   * prerendered placeholder stays the visible content, overlaid on top of
   * the (still invisible-to-the-user) live iframe, until the child's own
   * first-render diagnostic confirms real output landed.
   */
  sandboxPainted?: boolean;
};

type HeadComponent = ComponentLike<{
  Args: {
    displayContainer?: boolean;
    model?: Record<string, unknown>;
  };
}>;

interface DefaultFormatsProviderSignature {
  Args: { value: FieldFormats };
  Blocks: { default: [] };
}

class DefaultFormatsProvider extends Component<DefaultFormatsProviderSignature> {
  @provide(DefaultFormatsContextName)
  // @ts-ignore "value is declared but consumed through context"
  private get value(): FieldFormats {
    return this.args.value;
  }

  <template>
    {{! template-lint-disable no-yield-only }}
    {{yield}}
  </template>
}

export default class BoxelExecutionRenderer extends Component<Signature> {
  @service declare private boxelExecution: BoxelExecutionService;

  private readonly surfaceId: string;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.surfaceId = this.boxelExecution.surfaceId();
  }

  /**
   * RP-1.5: the render entry seeds both default-format axes from the caller's
   * format, exactly as main's `CardRenderer` does. The root component reads
   * the `cardDef` axis; nested levels re-derive their own cascade (RP-2.6).
   */
  @provide(DefaultFormatsContextName)
  // @ts-ignore "defaultFormats is declared but consumed through context"
  private get defaultFormats(): FieldFormats {
    let format = this.args.format ?? 'isolated';
    return { cardDef: format, fieldDef: format };
  }

  /**
   * RP-2.6: on main, a card template's children resolve their formats from
   * the child-format cascade the Base card wrapper provides. The Capsule slot
   * mounts the authored format component without that wrapper, so the
   * renderer supplies the same cascade to the `@fields` portals the authored
   * template invokes.
   */
  private get capsuleChildFormats(): FieldFormats {
    let format = this.args.format ?? 'isolated';
    switch (format) {
      case 'edit':
        return { cardDef: 'edit', fieldDef: 'edit' };
      case 'atom':
      case 'head':
      case 'markdown':
        return { cardDef: format, fieldDef: format };
      default:
        return { cardDef: 'fitted', fieldDef: 'embedded' };
    }
  }

  @use private execution = resource(({ on }) => {
    let session = this.boxelExecution.createSession();
    let state = new TrackedObject<ExecutionRendererState>({
      snapshot: session.snapshot,
    });
    let unsubscribe = session.subscribe((snapshot) => {
      state.snapshot = snapshot;
      if (snapshot.current) {
        // RP-7.3: a relationship that settles after first paint republishes
        // a fresh generation through this same subscription
        // (`watchForSettle` in boxel-execution-engine.ts) — same component
        // definition, updated per-instance data. `@model` must track every
        // generation this way, not just the first one materialized below,
        // or a field that resolves later (a themed card's `cardInfo.theme`,
        // a `linksToMany` like `reviewers`) never reaches the rendered
        // component even though the render record itself settled.
        state.model = snapshot.current.renderRecord.instance.model;
      }
    });
    let card = this.args.card;
    let format = this.args.format;
    let active = true;
    void this.boxelExecution
      .prerenderedComponentFor(card, format)
      .then((placeholder) => {
        if (active && placeholder) {
          state.placeholder = placeholder;
        }
      });
    void (async () => {
      try {
        let request = await this.boxelExecution.requestFor(
          card,
          format,
          this.surfaceId,
          this.args.relativeTo,
        );
        let source = await this.boxelExecution.classifyForExecution(
          request.moduleIdentifier,
          request.source,
        );
        if (!active) {
          return;
        }
        let reservation = this.boxelExecution.reserveSandboxProcess(
          request.principal,
          request.surfaceId,
          request.trusted,
          request.format,
          source,
        );
        // RP-15.3: a Sandbox bootstrap failure must fail closed no matter
        // which of its two possible paths it takes — a connect (or later
        // render) failure the process itself observes and reports via
        // onMountFailed, or a rejection that surfaces through
        // materialize()'s own await of the SAME live client, inside
        // session.update() below, before onMountFailed's listener ever
        // gets a chance to fire. Both must converge on the identical
        // fail-closed behavior: clear the (now-invalid) reservation slot
        // so the template falls through past the stale sandbox branch to
        // whatever presentation the session's own error state calls for.
        // Registered once, immediately after the reservation exists —
        // onMountFailed never re-arms after firing, so this single
        // registration covers both the window while materialize() is
        // still in flight and any later failure once this generation is
        // fully live.
        let mountFailureWatched = false;
        if (reservation) {
          on.cleanup(reservation.release);
          let { process } = reservation;
          state.slot = {
            owner: 'sandbox',
            iframe: process.iframe,
            surface: process.surface,
            process,
          };
          let stopWatchingMountFailure = process.onMountFailed((error) => {
            if (!active) {
              return;
            }
            state.slot = undefined;
            state.snapshot = {
              ...session.snapshot,
              status: 'error',
              error,
            };
          });
          on.cleanup(stopWatchingMountFailure);
          mountFailureWatched = true;
          // Ember must actually paint the slot this assignment causes
          // before the presentation slot modifier can call mount() on it —
          // wait for that so materialize() (below) never asks for a client
          // before mount() has at least started connecting one.
          await process.whenMounted();
          if (!active) {
            return;
          }
        }
        let generation = await session.update(request);
        if (!generation) {
          // materialize() needed the reserved Sandbox process's live
          // client; if that connection failed, the rejection propagated
          // here — through update()'s own catch, which already updated
          // state.snapshot via session.subscribe's notify — rather than
          // through the onMountFailed listener above. state.slot was set
          // early (before materialize() ever ran) and update() has no way
          // to know that, so it is left stale here unless cleared
          // explicitly: without this, the template's sandbox branch would
          // keep outranking the error presentation the snapshot already
          // calls for.
          if (active) {
            state.slot = undefined;
          }
          return;
        }
        // `state.model` is kept in sync by the `session.subscribe` callback
        // above, which already ran synchronously for this generation as
        // part of `session.update()`'s own `notify()` — no separate
        // assignment needed here.
        let [fields, slot] = await Promise.all([
          this.boxelExecution.fieldPortalsFor(card),
          session.getRenderSlot(format ?? 'isolated'),
        ]);
        if (slot.owner === 'trusted-base') {
          slot = this.boxelExecution.trustedBaseRenderSlotFor(
            card,
            slot.componentCodeRef,
          );
        }
        state.fields = fields;
        state.slot = slot;
        if (slot.owner !== 'sandbox') {
          state.surface = this.boxelExecution.registerSurface(
            slot.owner,
            this.surfaceId,
          );
        } else {
          // Fires once — immediately if this process (retained across
          // format switches by surface identity) has already painted
          // before, otherwise the first time its child reports a render
          // with real visible output. Either way, that's the signal to
          // stop showing the prerendered placeholder over the iframe.
          let stopWatchingPaint = slot.process.onFirstPaint(() => {
            if (active) {
              state.sandboxPainted = true;
            }
          });
          // getRenderSlot() no longer awaits the full handshake first (it
          // can't: the iframe needs this slot's element to exist before it
          // can even start booting), so a failed connect (most commonly
          // the timeout) is no longer a thrown rejection this async
          // block's own try/catch would see — it surfaces through
          // onMountFailed instead. Normally that listener was ALREADY
          // registered right after the reservation above (it never
          // re-arms after firing, so one registration covers this
          // process's whole lifecycle) — this second registration exists
          // only for the rarer case where no reservation was made at all
          // (classification decided non-Sandbox, but materialize()'s own
          // prefersFullSandbox escalation chose Sandbox anyway), so this
          // is the first and only chance to watch it.
          let stopWatchingMountFailure = mountFailureWatched
            ? undefined
            : slot.process.onMountFailed((error) => {
                if (!active) {
                  return;
                }
                state.slot = undefined;
                state.snapshot = {
                  ...session.snapshot,
                  status: 'error',
                  error,
                };
              });
          // An explicit hard reload (session.reloadSandbox(), dossier step
          // 6) remints this process's child from scratch — unlike ordinary
          // HMR (session.pushDraft()), which never re-arms onFirstPaint by
          // design (RP-15.3's placeholder is retained, not re-entered, for
          // an in-place edit). A reload is exactly the case that DOES need
          // the placeholder back: the new child hasn't painted anything
          // yet, so this state must invalidate before its next paint.
          let stopWatchingReload = slot.process.onReload(() => {
            if (active) {
              state.sandboxPainted = false;
            }
          });
          on.cleanup(stopWatchingPaint);
          if (stopWatchingMountFailure) {
            on.cleanup(stopWatchingMountFailure);
          }
          on.cleanup(stopWatchingReload);
        }
      } catch (error) {
        state.snapshot = {
          ...session.snapshot,
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    })();
    on.cleanup(() => {
      active = false;
      unsubscribe();
      if (state.surface) {
        this.boxelExecution.releaseSurface(state.surface);
      }
      void session.destroy();
    });
    return state;
  });

  private get state() {
    return this.execution;
  }

  private get capsuleSlot(): CapsuleRenderSlot | undefined {
    let slot = this.state.slot;
    return slot?.owner === 'capsule' ? slot : undefined;
  }

  private get directSlot(): DirectRenderSlot | undefined {
    let slot = this.state.slot;
    return slot?.owner === 'direct' ? slot : undefined;
  }

  private get sandboxSlot(): SandboxRenderSlot | undefined {
    let slot = this.state.slot;
    return slot?.owner === 'sandbox' ? slot : undefined;
  }

  /**
   * RP-15.3: shown overlaid on top of the (mounted, booting-or-live, never
   * hidden) Sandbox iframe until its child reports a real painted render.
   * Only meaningful once the Sandbox slot itself exists — before that, the
   * ordinary placeholder branch further down already covers the wait.
   */
  private get showSandboxPlaceholderOverlay(): boolean {
    return Boolean(this.state.placeholder) && !this.state.sandboxPainted;
  }

  private get renderedComponent() {
    return this.capsuleSlot?.component ?? this.directSlot?.component;
  }

  private get headComponent(): HeadComponent | undefined {
    if (this.args.format !== 'head') {
      return undefined;
    }
    return this.renderedComponent as HeadComponent | undefined;
  }

  private get hasCapsuleRendering(): boolean {
    return Boolean(this.capsuleSlot && this.state.surface);
  }

  private get hasDirectRendering(): boolean {
    return Boolean(this.directSlot && this.state.surface);
  }

  private get capsuleComponent(): CapsuleComponent {
    let component = this.capsuleSlot?.component;
    if (!component) {
      throw new Error('Capsule component is not ready');
    }
    return component;
  }

  private get capsuleSurface(): SurfaceHandle {
    let surface = this.state.surface;
    if (!surface) {
      throw new Error('Capsule Surface is not ready');
    }
    return surface;
  }

  private get directComponent(): DirectRenderSlot['component'] {
    let component = this.directSlot?.component;
    if (!component) {
      throw new Error('Direct component is not ready');
    }
    return component;
  }

  private get directSurface(): SurfaceHandle {
    let surface = this.state.surface;
    if (!surface) {
      throw new Error('Direct Surface is not ready');
    }
    return surface;
  }

  private get cardURL(): string | undefined {
    return 'id' in this.args.card
      ? (this.args.card.id as string | undefined)
      : undefined;
  }

  private get errorMessage(): string {
    return this.state.snapshot.error?.message ?? 'Unknown execution error';
  }

  private get errorStack(): string | undefined {
    return this.state.snapshot.error?.stack;
  }

  private get executionReason(): string | undefined {
    return this.state.snapshot.current?.lease.decision.reason;
  }

  /**
   * On main, every card renders inside `field-component.gts`'s trusted
   * `CardContainer` invocation, which stamps `data-boxel-theme-scope`,
   * emits the theme's scoped stylesheet (`<style data-boxel-theme-style>`)
   * and its `@import`s, and carries the container's semantic-token
   * derivation (`--background` et al). The Capsule slot mounts the card's
   * template directly — no field-component chrome — so this Host-owned
   * wrapper makes the identical `CardContainer` invocation from the render
   * record's presentation (Host-computed, RP-5.4; plain cloneable strings
   * per RP-8.4's boundary rules), or a themed card silently loses its
   * theme.
   */
  private get themePresentation() {
    let presentation = this.state.snapshot.current?.renderRecord.presentation;
    return {
      themeScope: presentation?.themeScope ?? undefined,
      themeCss: presentation?.themeCss ?? undefined,
      cssImports: presentation?.cssImports ?? undefined,
    };
  }

  <template>
    {{#if this.headComponent}}
      <HeadFormatPreview
        @renderedCard={{this.headComponent}}
        @model={{this.state.model}}
        @fields={{this.state.fields}}
        @cardURL={{this.cardURL}}
      />
    {{else if this.hasCapsuleRendering}}
      <CardContainer
        @tag='div'
        @isThemed={{if this.themePresentation.themeCss true false}}
        @themeScope={{this.themePresentation.themeScope}}
        @themeCss={{this.themePresentation.themeCss}}
        @cssImports={{this.themePresentation.cssImports}}
        class='boxel-execution-capsule-slot'
        data-boxel-execution='capsule'
        data-boxel-execution-reason={{this.executionReason}}
        {{surfaceElement this.capsuleSurface}}
        ...attributes
      >
        <DefaultFormatsProvider @value={{this.capsuleChildFormats}}>
          <this.capsuleComponent
            @model={{this.state.model}}
            @fields={{this.state.fields}}
            @format={{@format}}
            @renderRecord={{this.state.snapshot.current.renderRecord}}
            @displayContainer={{@displayContainer}}
            @viewCard={{@viewCard}}
          />
        </DefaultFormatsProvider>
      </CardContainer>
    {{else if this.sandboxSlot}}
      <div
        class='boxel-execution-sandbox-slot'
        data-boxel-execution='sandbox'
        data-boxel-execution-reason={{this.executionReason}}
        {{boxelSandboxSlot this.sandboxSlot}}
        ...attributes
      >
        {{! RP-15.3: the iframe the modifier above mounts into this element
          is never display:none'd — it needs real layout to boot and paint
          correctly. This overlay sits ON TOP of it (never behind, never
          hiding it) until the child's own first-render diagnostic confirms
          real output landed; see showSandboxPlaceholderOverlay. }}
        {{#if this.showSandboxPlaceholderOverlay}}
          <div
            class='boxel-execution-placeholder boxel-execution-placeholder--overlay'
            aria-label='Loading interactive card'
            aria-busy='true'
            data-boxel-execution='prerender'
          >
            <this.state.placeholder />
          </div>
        {{/if}}
      </div>
    {{else if this.hasDirectRendering}}
      <div
        class='boxel-execution-direct-slot'
        data-boxel-execution='direct'
        data-boxel-execution-reason={{this.executionReason}}
        {{surfaceElement this.directSurface}}
        ...attributes
      >
        <this.directComponent @displayContainer={{@displayContainer}} />
      </div>
    {{else if (eq this.state.snapshot.status 'error')}}
      <section class='boxel-execution-error' role='alert' ...attributes>
        <strong>Unable to render this card</strong>
        <p>{{this.errorMessage}}</p>
        {{#if this.errorStack}}
          <details>
            <summary>Details</summary>
            <pre>{{this.errorStack}}</pre>
          </details>
        {{/if}}
      </section>
    {{else if this.state.placeholder}}
      <div
        class='boxel-execution-placeholder'
        aria-label='Loading interactive card'
        aria-busy='true'
        data-boxel-execution='prerender'
        ...attributes
      >
        <this.state.placeholder />
      </div>
    {{else}}
      <div
        class='boxel-execution-loading'
        aria-label='Loading card'
        ...attributes
      ></div>
    {{/if}}

    <style scoped>
      .boxel-execution-sandbox-slot {
        min-width: 0;
        width: 100%;
        /* Anchors .boxel-execution-placeholder--overlay, which sits ON TOP
          of the mounted iframe (a sibling in the DOM, appended by the
          boxelSandboxSlot modifier — never removed by this component's own
          rerenders) until the child's first paint. */
        position: relative;
      }

      .boxel-execution-capsule-slot {
        min-width: 0;
        width: 100%;
      }

      .boxel-execution-direct-slot {
        min-width: 0;
        width: 100%;
      }

      .boxel-execution-sandbox-slot > :global(iframe) {
        border: 0;
        display: block;
        min-height: inherit;
        width: 100%;
      }

      .boxel-execution-placeholder--overlay {
        position: absolute;
        inset: 0;
      }

      .boxel-execution-loading {
        min-height: 3rem;
      }

      .boxel-execution-placeholder {
        min-width: 0;
        pointer-events: none;
        width: 100%;
      }

      .boxel-execution-error {
        background: var(--boxel-light-100);
        color: var(--boxel-dark);
        padding: 1rem;
      }

      .boxel-execution-error p {
        margin: 0.5rem 0 0;
      }

      .boxel-execution-error pre {
        overflow: auto;
        white-space: pre-wrap;
      }
    </style>
  </template>
}
