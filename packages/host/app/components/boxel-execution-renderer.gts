import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

// @ts-ignore — @glimmer/validator is provided by Ember but has no own types
import { untrack } from '@glimmer/validator';

import Modifier, { modifier } from 'ember-modifier';
import { consume, provide } from 'ember-provide-consume-context';
import { resource, use } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';

import { CardContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import {
  CardContextName,
  childFieldFormatsFor,
  DefaultFormatsContextName,
  isCardInstance,
  PermissionsContextName,
  rri,
  type CodeRef,
  type Permissions,
  type RealmResourceIdentifier,
  type SurfaceHandle,
} from '@cardstack/runtime-common';

import HeadFormatPreview from '@cardstack/host/components/head-format-preview';
import ErrorDisplay from '@cardstack/host/components/operator-mode/error-display';
import type {
  BoxelExecutionRenderSlot,
  BoxelExecutionSession,
  BoxelExecutionSessionSnapshot,
} from '@cardstack/host/lib/boxel-execution-engine';
import type {
  CapsuleComponent,
  CapsuleRenderSlot,
} from '@cardstack/host/lib/capsule-component';
import { CapsuleContextProjector } from '@cardstack/host/lib/capsule-context-projection';
import type { DirectRenderSlot } from '@cardstack/host/lib/direct-boxel-runtime';
import type { HTMLComponent } from '@cardstack/host/lib/html-component';
import type { SandboxRenderSlot } from '@cardstack/host/lib/sandbox-runtime-process';
import boxelSandboxSlot from '@cardstack/host/modifiers/boxel-sandbox-slot';
import surfaceElement from '@cardstack/host/modifiers/surface-element';

import type BoxelExecutionService from '@cardstack/host/services/boxel-execution';

import type {
  BaseDef,
  BoxComponent,
  CardContext,
  FieldFormats,
  FieldType,
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
    /**
     * Main's `Box.set` for the field this render occupies, granted by the
     * field portal (RP-9.2: `@set` and direct assignment are the same
     * write). Crosses into a Capsule as a set CAPABILITY (the authored
     * component's `set` effect invokes this Host closure); never a Store
     * shortcut. The Sandbox tier's mutation lane is the pending
     * updateInstance push and does not consume this argument yet.
     */
    set?: (value: unknown) => void;
    /**
     * Field identity when this render occupies a field position (supplied
     * by the field portal), carried into the ElementTracker registration
     * below — overlays classify entries by it (linksTo vs linksToMany vs
     * contains). Absent for a root render, exactly as main registers a
     * root card with no field.
     */
    fieldType?: FieldType;
    fieldName?: string;
    /**
     * The standard-view override (always `baseCardRef` today): render the
     * trusted Base template for this card instead of its authored format.
     * Resolved per tier (RP-6.5) — host-side via
     * `trustedBaseRenderSlotFor` for Direct/Capsule (the same resolution a
     * Capsule's missing authored format takes), REFUSED for Sandbox, where
     * honoring it host-side would execute the sandboxed module's authored
     * FieldDef templates in the main document.
     */
    baseTemplateRef?: CodeRef;
    /**
     * RP-9.9: this render's slot lands in a Host box that already has a
     * definite height (a stack item, sized from the viewport), so the card
     * should FILL that box rather than dictate it — main's contract for a
     * full-page card, which is why authors write `height: 100%` roots.
     *
     * Only the Host knows this, and it is not a property of the format:
     * `isolated` renders into a stack item's definite box here and into
     * code mode's auto-height spec panel there. Omitted (the default) keeps
     * the format's own rule — intrinsic for everything but `fitted`.
     */
    hostOwnsBox?: boolean;
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
  /** The Sandbox format whose child render request has completed. */
  sandboxReadyFormat?: Format;
};

type HeadComponent = ComponentLike<{
  Args: {
    displayContainer?: boolean;
    model?: Record<string, unknown>;
  };
}>;

function isIsolatedEditToggle(from: Format, to: Format): boolean {
  return (
    (from === 'isolated' && to === 'edit') ||
    (from === 'edit' && to === 'isolated')
  );
}

/**
 * Matches `DEFAULT_CARD_CONTEXT`'s no-op in `@cardstack/base`: when no
 * operator-mode context provides a real `cardComponentModifier`, tracking
 * silently registers nothing. Its signature mirrors the real tracker
 * modifier's so the two are interchangeable at the invocation site.
 */
class NoOpModifier extends Modifier<{
  Args: {
    Named: {
      // BaseDef, not CardDef: the invocation site passes `@card` before the
      // isCardInstance narrowing — the getter below only hands out the REAL
      // tracker modifier for card instances, so the looser static type never
      // lets a non-card reach real tracking at runtime.
      card?: BaseDef;
      cardId?: string;
      format: Format | 'data';
      fieldType: FieldType | undefined;
      fieldName: string | undefined;
    };
  };
}> {
  modify() {}
}

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

  @consume(CardContextName)
  declare private hostCardContext: CardContext | undefined;

  /**
   * RP-10/RP-9.1 across the Sandbox boundary: the live permissions the
   * surrounding host chrome provides (operator mode's stack item derives it
   * from the realm service). Direct/Capsule renders consume it natively
   * through component-tree scope; the Sandbox child cannot, so
   * `syncSandboxContext` below pushes a cloneable snapshot over the render
   * transport — re-pushed whenever this consumed value settles or changes,
   * without ever entering the render resource's tracked set (RP-20.1).
   */
  @consume(PermissionsContextName)
  declare private hostPermissions: Permissions | undefined;

  /**
   * Pushes the current permissions snapshot to the mounted Sandbox child.
   * A function modifier so Glimmer's own template tracking re-runs it when
   * either the slot (a new process) or the consumed permissions change —
   * the exact reactivity main's in-tree provider gives host-side editors.
   * Fire-and-forget like every push lane: each push carries the full
   * current snapshot, so a missed one self-heals on the next.
   */
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

  /**
   * Installs the parent half of nested-card navigation for this live
   * Sandbox slot. The child sends an identifier plus Base's render metadata;
   * the Host invokes the same `viewCard` closure used by direct/capsule
   * rendering. No Store, router, or card instance enters the child.
   */
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
          // OperatorModeOverlays intentionally opens nested cards in the
          // containing stack item's format, not the tile's own fitted
          // format. Preserve that established UX across the boundary.
          viewCard(rri(url.href), containingFormat, options);
        },
      );
    },
  );

  private readonly surfaceId: string;
  private readonly session: BoxelExecutionSession;
  /**
   * A Sandbox card's isolated/edit toggle is one continuous presentation
   * surface even when the two formats use different component classes.
   * The execution resource still replaces its tracked view state when the
   * requested format changes, but the component-level session and the
   * previous Sandbox slot survive that replacement. Seeding the new state
   * keeps Glimmer on the same DOM branch and lets the slot modifier transfer
   * ownership of the already-live iframe in place. Without this handoff, the
   * resource's short async gap removes the slot, whose teardown necessarily
   * kills the iframe before the retained runtime can serve the return trip.
   */
  private previousExecution?: {
    card: BaseDef;
    format: Format;
    baseTemplateRef?: CodeRef;
    state: ExecutionRendererState;
  };

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.surfaceId = this.boxelExecution.surfaceId();
    this.session = this.boxelExecution.createSession();
    registerDestructor(this, () => void this.session.destroy());
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
    return childFieldFormatsFor(this.args.format ?? 'isolated') as FieldFormats;
  }

  @use private execution = resource(({ on }) => {
    let session = this.session;
    let card = this.args.card;
    let format = this.args.format;
    let relativeTo = this.args.relativeTo;
    let baseTemplateRef = this.args.baseTemplateRef;
    let hostOwnsBox = this.args.hostOwnsBox;
    let effectiveFormat = format ?? 'isolated';
    let previousExecution = this.previousExecution;
    let retainedSandboxState =
      previousExecution &&
      previousExecution.card === card &&
      previousExecution.baseTemplateRef === baseTemplateRef &&
      isIsolatedEditToggle(previousExecution.format, effectiveFormat) &&
      previousExecution.state.slot?.owner === 'sandbox'
        ? previousExecution.state
        : undefined;
    let state = new TrackedObject<ExecutionRendererState>({
      snapshot: retainedSandboxState?.snapshot ?? session.snapshot,
      slot: retainedSandboxState?.slot,
      model: retainedSandboxState?.model,
      fields: retainedSandboxState?.fields,
      placeholder: retainedSandboxState?.placeholder,
      sandboxPainted: retainedSandboxState?.sandboxPainted,
      sandboxReadyFormat: retainedSandboxState?.sandboxReadyFormat,
    });
    this.previousExecution = {
      card,
      format: effectiveFormat,
      baseTemplateRef,
      state,
    };
    let unsubscribe = session.subscribe((snapshot) => {
      state.snapshot = snapshot;
      if (snapshot.current) {
        // RP-20.2/RP-20.5: `@model` is a LIVE read-through projection of
        // the canonical instance (main's sync pattern: shared instance +
        // autotracked reads), seeded with this generation's record model as
        // fallback (instance id, RP-4.4 extensions, pending-relationship
        // values). Every mounted view of this instance re-renders in place
        // on any mutation with no delivery machinery at all. RP-7.3 settle
        // republishes still land here as fresh generations — same
        // subscription, fresh fallback — so late-resolving relationships
        // reach the render exactly as before.
        state.model = this.boxelExecution.liveModelFor(
          card,
          snapshot.current.renderRecord.instance.model,
        );
      }
    });
    let active = true;
    let activateSandboxSlot = (
      slot: SandboxRenderSlot,
      mountFailureWatched = false,
    ) => {
      // RP-20.5: the Sandbox tier's views cannot read the canonical
      // instance live, so parent-side mutations cross as explicit instance
      // pushes. Reconnect this subscription for every resource generation,
      // including the format-only fast path.
      on.cleanup(
        this.boxelExecution.connectSandboxInstanceSync(card, slot.process),
      );
      let stopWatchingPaint = slot.process.onFirstPaint(() => {
        if (active) {
          state.sandboxPainted = true;
          state.sandboxReadyFormat = effectiveFormat;
        }
      });
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
    };
    // Volatile promotion (docs/boxel-volatile-execution-plan.md): read
    // isVolatile() SYNCHRONOUSLY, here in this resource's own tracking
    // frame — reading it later, inside the async IIFE below, would not
    // register as a dependency ember-resources can react to. This is what
    // makes a promotion re-instantiate THIS card's resource (tearing down
    // its current — possibly Capsule — generation and re-materializing,
    // this time routed to Sandbox) without a page reload, scoped to
    // exactly this card's own module: promoting a DIFFERENT card never
    // touches this dependency, so this resource never re-runs for it.
    let moduleIdentifier = this.boxelExecution.moduleIdentifierFor(card);
    if (moduleIdentifier) {
      this.boxelExecution.isVolatile(moduleIdentifier);
    }
    // RP-20.1: this resource's tracked dependency set is EXACTLY the four
    // reads above — the card's identity (the `args.card` reference), the
    // requested format, the standard-view override (`baseTemplateRef`, so a
    // Toggle Standard View re-materializes like a format change), and the
    // module's volatility cell. Nothing below may
    // add to it: the synchronous prefix of the async pipeline (everything
    // up to its first await) otherwise still runs inside this tracking
    // frame, and `requestFor`/serialization read the instance's TRACKED
    // FIELDS — which a store save re-sets on the echo. Without this
    // untrack, every auto-save invalidated the whole resource: session
    // destroyed, slot torn down, focus lost mid-keystroke. Data updates
    // instead arrive in place through the session's own subscription
    // (RP-20.2: the engine's instance watch republishes the current
    // generation with a refreshed model; the subscribe callback above
    // already consumes it).
    untrack(
      () =>
        void (async () => {
          try {
            // The pencil toggle is a render-format change, not a new card
            // generation. When both ends route to the already-live Sandbox,
            // ask that child to render its retained card handle in the new
            // format. This skips Host serialization/source preparation,
            // classification, and child materialization entirely. The
            // session method repeats policy admission; a destination that
            // belongs host-side simply returns undefined and continues down
            // the ordinary full-update path below.
            if (retainedSandboxState) {
              let retainedSlot = await session.switchSandboxFormat(
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
            let request = await this.boxelExecution.requestFor(
              card,
              format,
              this.surfaceId,
              relativeTo,
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
              this.boxelExecution.isVolatile(request.moduleIdentifier),
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
              // The prerendered placeholder exists to cover a Sandbox's boot
              // time, and only for surfaces big enough to make a boot gap
              // visible — an isolated (or edit) stack card. It is fetched
              // exactly once per Sandbox render, here, after classification has
              // actually decided Sandbox: fetching it for every card render
              // (Capsule included) costs a network round-trip per card for a
              // placeholder that is never shown. The isolated prerender is used
              // even for edit-format renders — the index has no edit HTML, and
              // a recognizable snapshot of the card beats a blank box.
              let effectiveFormat = format ?? 'isolated';
              if (
                effectiveFormat === 'isolated' ||
                effectiveFormat === 'edit'
              ) {
                void this.boxelExecution
                  .prerenderedComponentFor(card, 'isolated')
                  .then((placeholder) => {
                    if (active && placeholder) {
                      state.placeholder = placeholder;
                    }
                  });
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
              await process.whenMounted(mountToken);
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
              session.getRenderSlot(format ?? 'isolated', hostOwnsBox),
            ]);
            if (slot.owner === 'trusted-base') {
              slot = this.boxelExecution.trustedBaseRenderSlotFor(
                card,
                slot.componentCodeRef,
              );
            }
            if (baseTemplateRef) {
              if (slot.owner === 'sandbox') {
                // RP-6.5: the override never crosses the Sandbox boundary —
                // the authored render stays confined and the standard view
                // is unavailable for this card.
                console.warn(
                  `Ignoring standard-view base-template override for a Sandbox-classified card — honoring it would execute the module's authored field templates outside the iframe boundary`,
                );
              } else {
                slot = this.boxelExecution.trustedBaseRenderSlotFor(
                  card,
                  baseTemplateRef,
                );
              }
            }
            state.fields = fields;
            state.slot = slot;
            if (slot.owner !== 'sandbox') {
              state.surface = this.boxelExecution.registerSurface(
                slot.owner,
                this.surfaceId,
              );
            } else {
              activateSandboxSlot(slot, mountFailureWatched);
            }
          } catch (error) {
            if (active) {
              // Same fail-closed convergence as onMountFailed and the
              // !generation branch above: an already-assigned slot outranks
              // the error presentation in the template, so a failure that
              // reaches this catch AFTER the slot was set (most concretely:
              // an already-mounted Sandbox render request timing out or
              // rejecting inside getRenderSlot) would otherwise record an
              // error nobody ever sees, behind a placeholder that spins
              // forever.
              state.slot = undefined;
            }
            state.snapshot = {
              ...session.snapshot,
              status: 'error',
              error: error instanceof Error ? error : new Error(String(error)),
            };
          }
        })(),
    );
    on.cleanup(() => {
      active = false;
      unsubscribe();
      if (state.surface) {
        this.boxelExecution.releaseSurface(state.surface);
      }
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
   * RP-15.3: while the Sandbox child is booting (mounted but not yet
   * painted), the slot's visible content is the in-flow placeholder (or a
   * plain loading box), which SIZES the slot; the iframe sits absolutely
   * behind it at opacity 0 — it keeps real layout geometry (the placeholder
   * sized box) so it can boot and measure correctly, it just isn't shown
   * until its child reports a real painted render. After a hard reload
   * (onReload) this state re-enters until the reminted child paints.
   */
  private get sandboxBooting(): boolean {
    return !this.state.sandboxPainted;
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
    // Boundary wrappers (e.g. the Capsule evaluator's "Unable to import…")
    // carry the underlying failure as `cause`; without walking the chain
    // the details pane shows only the wrapper and hides the actual reason
    // a card failed to render.
    let error: unknown = this.state.snapshot.error;
    let sections: string[] = [];
    let depth = 0;
    while (error instanceof Error && depth < 6) {
      sections.push(error.stack ?? `${error.name}: ${error.message}`);
      error = (error as Error & { cause?: unknown }).cause;
      depth++;
    }
    if (error !== undefined && error !== null) {
      sections.push(String(error));
    }
    return sections.length ? sections.join('\n\nCaused by: ') : undefined;
  }

  /**
   * A Sandbox can fail after the Host has already acquired an inert server
   * rendering. That rendering is the last-known-good generation: keep it
   * visible while the Host presents the failure, rather than replacing a
   * recognizable card with a blank error page. It stays inert because the
   * live child never completed the boundary handshake.
   */
  private get hasFailedPlaceholder(): boolean {
    return (
      this.state.snapshot.status === 'error' && Boolean(this.state.placeholder)
    );
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
  /**
   * The narrow presentation-capability projection handed to the Capsule as
   * `@context` (RP-11.5): operator mode's ElementTracker modifier — how
   * overlays/adorn discover rendered cards, including an authored app
   * card's own `format: 'data'` grid tiles — and the search rendering
   * surface. Never the live Host CardContext: no Store, loader, or service
   * authority crosses; the Capsule's `@consume` facade re-plucks exactly
   * these keys (capsule-module-evaluator.ts) so nothing else could ride
   * along even if this projection grew.
   */
  private capsuleContextProjector = new CapsuleContextProjector();

  private get capsuleContextProjection(): unknown {
    return this.capsuleContextProjector.project(this.hostCardContext);
  }

  private get effectiveFormat(): Format {
    return this.args.format ?? 'isolated';
  }

  /**
   * RP-11.5: on main, EVERY card render — root included — passes through
   * `field-component.gts`'s `CardContainer`, which registers the element
   * with operator mode's ElementTracker via the injected
   * `cardComponentModifier`. In this architecture that container IS the
   * Capsule/Sandbox slot root rendered here, so this is the one
   * registration site (the field portal supplies `@fieldType`/`@fieldName`
   * for a nested render; a root render registers with no field, exactly as
   * main does). Real tracking only for card instances — main never
   * registers FieldDef compounds either, and an entry without a card
   * identity breaks overlay consumers downstream.
   */
  private get cardComponentModifier(): typeof NoOpModifier {
    // The cast unifies the union for Glint: the real tracker modifier's
    // Named args match NoOpModifier's except for the (deliberately looser,
    // runtime-guarded) `card` type documented on NoOpModifier.
    return isCardInstance(this.args.card)
      ? ((this.hostCardContext?.cardComponentModifier ??
          NoOpModifier) as unknown as typeof NoOpModifier)
      : NoOpModifier;
  }

  private get themePresentation() {
    // A live read (RP-20.2's pattern applied to presentation): a themed
    // card's `cardInfo.theme` is a `linksTo` that routinely settles AFTER
    // first materialize. The record's presentation is that moment's captured
    // value; this read follows the path instead, so the theme applies the
    // instant the relationship settles — the same tracked-read mechanics
    // that keep `@model` fresh, with no settle republish needed.
    let presentation =
      this.boxelExecution.livePresentationFor(this.args.card) ??
      this.state.snapshot.current?.renderRecord.presentation;
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
        data-boxel-card-id={{this.cardURL}}
        data-boxel-card-format={{this.effectiveFormat}}
        data-test-card={{this.cardURL}}
        data-test-card-format={{this.effectiveFormat}}
        {{this.cardComponentModifier
          card=@card
          format=this.effectiveFormat
          fieldType=@fieldType
          fieldName=@fieldName
        }}
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
            @set={{@set}}
            @context={{this.capsuleContextProjection}}
          />
        </DefaultFormatsProvider>
      </CardContainer>
    {{else if this.sandboxSlot}}
      <div
        class='boxel-execution-sandbox-slot
          {{if this.sandboxBooting "is-booting"}}'
        data-boxel-execution='sandbox'
        data-boxel-execution-reason={{this.executionReason}}
        data-boxel-card-id={{this.cardURL}}
        data-boxel-card-format={{this.effectiveFormat}}
        data-boxel-ready-format={{this.state.sandboxReadyFormat}}
        data-test-card={{this.cardURL}}
        data-test-card-format={{this.effectiveFormat}}
        {{this.cardComponentModifier
          card=@card
          format=this.effectiveFormat
          fieldType=@fieldType
          fieldName=@fieldName
        }}
        {{boxelSandboxSlot this.sandboxSlot}}
        {{this.syncSandboxContext this.sandboxSlot this.hostPermissions}}
        {{this.syncSandboxViewCard
          this.sandboxSlot
          @viewCard
          this.effectiveFormat
        }}
        ...attributes
      >
        {{! RP-15.3: the iframe the modifier above mounts into this element
          is never display:none'd — it needs real layout geometry to boot
          and measure correctly. While booting it is absolutely positioned
          at opacity 0 BEHIND this in-flow placeholder, which is what sizes
          the slot (so the box appears instantly at the prerender's real
          height, with no white gap and no reflow when the live child takes
          over). The child's own first-render diagnostic confirms real
          output landed; see sandboxBooting. }}
        {{#if this.sandboxBooting}}
          {{#if this.state.placeholder}}
            <div
              class='boxel-execution-placeholder boxel-execution-placeholder--boot'
              aria-label='Loading interactive card'
              aria-busy='true'
              data-boxel-execution='prerender'
            >
              <this.state.placeholder />
            </div>
          {{else}}
            <div
              class='boxel-execution-sandbox-boot'
              aria-label='Loading interactive card'
              aria-busy='true'
            ></div>
          {{/if}}
        {{/if}}
      </div>
    {{else if this.hasDirectRendering}}
      <div
        class='boxel-execution-direct-slot'
        data-boxel-execution='direct'
        data-boxel-execution-reason={{this.executionReason}}
        {{surfaceElement this.directSurface}}
      >
        <this.directComponent
          @displayContainer={{@displayContainer}}
          ...attributes
        />
      </div>
    {{else if this.hasFailedPlaceholder}}
      <div
        class='boxel-execution-failed-placeholder'
        data-boxel-execution='last-known-good'
        ...attributes
      >
        <div class='boxel-execution-placeholder' aria-hidden='true' inert>
          <this.state.placeholder />
        </div>
        <div
          class='boxel-execution-error boxel-execution-error--overlay'
          role='alert'
        >
          <ErrorDisplay
            @type='runtime'
            @headerText='Unable to make this card interactive'
            @message={{this.errorMessage}}
            @stack={{this.errorStack}}
          />
        </div>
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
        min-height: 2.5rem;
        /* Anchors the absolutely-positioned booting iframe (a sibling in
          the DOM, appended by the boxelSandboxSlot modifier — never removed
          by this component's own rerenders). The slot's HEIGHT is owned by
          the surface-* API: SurfaceService.applyLayout sets an explicit
          clamped height from the child's intrinsic report (or `100%` in
          allocated mode); while booting it is auto — sized by the in-flow
          placeholder. */
        position: relative;
        overflow: hidden;
      }

      /* RP-9.9: main renders the card straight into the Host box with no
        wrapper at all, so a card root styled height: 100% resolves against
        whatever the Host established. These slots ARE that missing wrapper,
        and a wrapper with auto height silently breaks the percentage chain:
        the card collapses to its own content height (a full-page card lands
        at ~60px). height: 100% restores transparency and costs nothing
        where the Host box is auto, since a percentage height against an
        indefinite containing block computes back to auto, which is exactly
        the in-flow behavior these slots had before. */
      .boxel-execution-capsule-slot {
        min-width: 0;
        width: 100%;
        height: 100%;
      }

      .boxel-execution-direct-slot {
        min-width: 0;
        width: 100%;
        height: 100%;
      }

      /* The iframe is appended by the boxelSandboxSlot modifier, not this
        template, so it carries no scoped-css attribute — and the scoped-css
        compiler treats any selector containing `:global()` as fully global,
        silently DROPPING scoped compound parts before it (a bare
        `> :global(iframe)` here compiled to a global `iframe` rule that
        styled every iframe on the page). The whole selector must live
        inside `:global()`. */
      /* No opacity transition on the boot→live handoff: the placeholder is
        removed in the SAME render that un-hides the iframe, so a fade-in
        would leave a window with neither layer visible — a guaranteed flash
        on every Sandbox load at first-paint time. The child has already
        painted real content (that is what flips the class), so an instant
        swap is seamless. */
      :global(.boxel-execution-sandbox-slot > iframe) {
        border: 0;
        display: block;
        width: 100%;
        height: 100%;
        min-height: inherit;
      }

      :global(.boxel-execution-sandbox-slot.is-booting > iframe) {
        position: absolute;
        inset: 0;
        opacity: 0;
        pointer-events: none;
      }

      .boxel-execution-placeholder--boot {
        position: relative;
        z-index: 1;
        width: 100%;
        pointer-events: none;
      }

      .boxel-execution-sandbox-boot {
        min-height: 3rem;
      }

      .boxel-execution-loading {
        min-height: 3rem;
      }

      .boxel-execution-placeholder {
        min-width: 0;
        pointer-events: none;
        width: 100%;
      }

      .boxel-execution-failed-placeholder {
        min-width: 0;
        position: relative;
        width: 100%;
      }

      .boxel-execution-error {
        background: var(--boxel-light-100);
        color: var(--boxel-dark);
        padding: 1rem;
      }

      .boxel-execution-error--overlay {
        bottom: var(--boxel-sp);
        left: var(--boxel-sp);
        max-height: calc(100% - calc(var(--boxel-sp) * 2));
        padding: 0;
        position: absolute;
        right: var(--boxel-sp);
        z-index: 10;
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
