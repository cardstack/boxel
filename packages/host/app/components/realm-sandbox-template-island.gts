import { getOwner } from '@ember/application';
import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { schedule, scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';

import Modifier from 'ember-modifier';

import {
  hasSerializedComponent,
  rehydrateWithArgs,
  rehydrateReplacingActiveWithArgs,
  renderWithArgs,
  rerenderSerializedComponent,
  resumeSerializedComponent,
  serializeWithArgs,
  teardown,
  type IsolatedRenderArgs,
} from '@cardstack/host/lib/isolated-render';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';

import type {
  BaseDef,
  BaseDefComponent,
  CardContext,
  Format,
  ViewCardFn,
} from '@cardstack/base/card-api';

import type { ArgsFor } from 'ember-modifier';

interface IslandArgs extends IsolatedRenderArgs {
  cardOrField: unknown;
  model: unknown;
  fields: unknown;
  context: CardContext | undefined;
  format: Format;
  set: (...args: unknown[]) => unknown;
  viewCard: ViewCardFn;
  onError?: (error: unknown, component: BaseDefComponent) => void;
  onRendered?: (component: BaseDefComponent) => void;
  card: BaseDef;
  markerBacked: boolean;
}

interface ModifierSignature {
  Element: HTMLDivElement;
  Args: {
    Positional: [BaseDefComponent];
    Named: IslandArgs;
  };
}

// Glimmer's serialized boundary is useful beyond server startup. Code mode
// keeps this element and its marker-annotated children mounted, releases the
// previous SES component program, and asks the replacement program to adopt
// those nodes. Compatible text/template updates retain authored DOM identity;
// incompatible programs fall back to a complete serialized render inside the
// same stable island.
export default class RealmSandboxTemplateIsland extends Modifier<ModifierSignature> {
  @service declare private realmSandbox: RealmSandboxService;
  private element?: HTMLDivElement;
  private component?: BaseDefComponent;
  private args?: IslandArgs;
  private subscribedCard?: BaseDef;
  private unsubscribeFromData?: () => void;
  private requestRender = () => {
    if (this.element) {
      rerenderSerializedComponent(this.element as any);
    }
  };

  constructor(owner: Owner, args: ArgsFor<ModifierSignature>) {
    super(owner, args);
    registerDestructor(this, () => {
      this.unsubscribeFromData?.();
      if (this.element) {
        teardown(this.element as any);
      }
    });
  }

  modify(
    element: HTMLDivElement,
    [component]: [BaseDefComponent],
    args: IslandArgs,
  ) {
    if (this.subscribedCard !== args.card) {
      this.unsubscribeFromData?.();
      this.subscribedCard = args.card;
      this.unsubscribeFromData = this.realmSandbox.subscribeToOpaqueCardData(
        args.card,
        () => scheduleOnce('afterRender', this, this.requestRender),
      );
    }
    if (
      this.element === element &&
      this.component === component &&
      this.sameArgs(this.args, args)
    ) {
      return;
    }

    let owner = getOwner(this) as Owner;
    // `card` is a host-only subscription identity. Never pass the executable
    // opaque host object into the compartment component's argument surface.
    let { card: _card, ...publicArgs } = args;
    let nextArgs = { ...publicArgs, requestRender: this.requestRender };
    let resumedServerDOM = resumeSerializedComponent(element as any);
    let hasSerializedDOM =
      resumedServerDOM || hasSerializedComponent(element as any);
    let isLiveReplacement =
      this.element === element && this.component !== undefined;
    let isSameProgramArgumentUpdate =
      isLiveReplacement && this.component === component;

    try {
      if (isSameProgramArgumentUpdate) {
        // The isolated renderer can adopt existing DOM when the component
        // program changes, but an active instance owns the args with which it
        // was created. Reusing that same program with a new opaque data
        // snapshot would therefore rerender the old model. Keep the stable
        // host slot, but replace the authored instance for data-only updates.
        // Code HMR still follows the DOM-adopting branch below because it
        // supplies a different component program.
        teardown(element as any);
        serializeWithArgs(component as any, element as any, owner, nextArgs);
        element.dataset.realmSandboxIslandUpdate = 'args-replaced';
      } else if (hasSerializedDOM) {
        try {
          if (isLiveReplacement) {
            rehydrateReplacingActiveWithArgs(
              component as any,
              element as any,
              owner,
              nextArgs,
            );
            element.dataset.realmSandboxIslandUpdate = 'adopted';
          } else {
            // Host Mode's outer CardIsland has already adopted this element,
            // but this modifier has no previous client instance on first
            // attachment. The nested serialization markers are the explicit
            // handoff: activate them instead of clearing the authored SSR DOM.
            rehydrateWithArgs(
              component as any,
              element as any,
              owner,
              nextArgs,
            );
            element.dataset.realmSandboxIslandUpdate = 'rehydrated';
          }
        } catch {
          serializeWithArgs(component as any, element as any, owner, nextArgs);
          element.dataset.realmSandboxIslandUpdate = 'replaced';
        }
      } else {
        if (isLiveReplacement) {
          // Canonical cards use the ordinary live builder so delegated Base
          // components (notably relationship hydration) participate in the
          // host renderer's tracking transaction. The first source-program
          // replacement is the single allowed transition into marker-backed
          // volatile HMR; subsequent replacements adopt those markers above.
          serializeWithArgs(component as any, element as any, owner, nextArgs);
          element.dataset.realmSandboxIslandUpdate = 'volatile-initial';
        } else if (args.markerBacked) {
          // Code-preview modules are known to be volatile before their first
          // paint. Give them serialization markers immediately so the first
          // Monaco/assistant generation can adopt authored DOM instead of
          // paying a one-time remount. Canonical interact cards keep the
          // ordinary live builder below.
          serializeWithArgs(component as any, element as any, owner, nextArgs);
          element.dataset.realmSandboxIslandUpdate = 'initial-volatile';
        } else {
          renderWithArgs(component as any, element as any, owner, nextArgs);
          element.dataset.realmSandboxIslandUpdate = 'initial-live';
        }
      }
    } catch (error) {
      if (!args.onError) {
        throw error;
      }
      // A microtask can run before Glimmer closes the tracking transaction
      // that invoked this modifier. Error publication changes tracked preview
      // state, so keep that state transition on Ember's render boundary.
      schedule('afterRender', null, () => args.onError?.(error, component));
      return;
    }

    this.element = element;
    this.component = component;
    // Compare subsequent modifier invocations against only the public args.
    // `requestRender` is a stable, host-owned capability added solely to the
    // low-level render. Persisting it here would make every public invocation
    // appear different and remount the compartment component after each state
    // update.
    this.args = args;
    schedule('afterRender', null, () => args.onRendered?.(component));
  }

  private sameArgs(previous: IslandArgs | undefined, next: IslandArgs) {
    if (!previous) {
      return false;
    }
    let keys = Object.keys(next) as (keyof IslandArgs)[];
    return (
      keys.length === Object.keys(previous).length &&
      keys.every((key) => previous[key] === next[key])
    );
  }
}
