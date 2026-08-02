import { getOwner } from '@ember/application';
import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { schedule } from '@ember/runloop';

import Modifier from 'ember-modifier';

import {
  hasSerializedComponent,
  rehydrateWithArgs,
  rehydrateReplacingActiveWithArgs,
  rerenderSerializedComponent,
  resumeSerializedComponent,
  serializeWithArgs,
  teardown,
  type IsolatedRenderArgs,
} from '@cardstack/host/lib/isolated-render';

import type {
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
  private element?: HTMLDivElement;
  private component?: BaseDefComponent;
  private args?: IslandArgs;
  private requestRender = () => {
    if (this.element) {
      rerenderSerializedComponent(this.element as any);
    }
  };

  constructor(owner: Owner, args: ArgsFor<ModifierSignature>) {
    super(owner, args);
    registerDestructor(this, () => {
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
    if (
      this.element === element &&
      this.component === component &&
      this.sameArgs(this.args, args)
    ) {
      return;
    }

    let owner = getOwner(this) as Owner;
    let nextArgs = { ...args, requestRender: this.requestRender };
    let resumedServerDOM = resumeSerializedComponent(element as any);
    let hasSerializedDOM =
      resumedServerDOM || hasSerializedComponent(element as any);
    let isLiveReplacement =
      this.element === element && this.component !== undefined;

    try {
      if (hasSerializedDOM) {
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
        serializeWithArgs(component as any, element as any, owner, nextArgs);
        element.dataset.realmSandboxIslandUpdate = 'initial';
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
