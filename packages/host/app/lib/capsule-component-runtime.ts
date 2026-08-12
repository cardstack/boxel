import { tracked } from '@glimmer/tracking';

import type { JSONValue } from '@cardstack/runtime-common';

import type {
  CapsuleComponentActionResult,
  CapsuleComponentEffect,
  CapsuleComponentInstanceDescriptor,
  CapsuleTemplateDescriptor,
} from './capsule-module-evaluator';

import type CapsuleModuleEvaluator from './capsule-module-evaluator';

declare const capsuleComponentHandleBrand: unique symbol;
declare const capsuleComponentInstanceHandleBrand: unique symbol;

export type CapsuleComponentHandle = string & {
  readonly [capsuleComponentHandleBrand]: true;
};

export type CapsuleComponentInstanceHandle = string & {
  readonly [capsuleComponentInstanceHandleBrand]: true;
};

export interface CapsuleComponentDefinition {
  component: CapsuleComponentHandle;
  descriptor: CapsuleTemplateDescriptor;
  stylesheets: string[];
}

export interface CapsuleComponentUpdate {
  generation: number;
  componentRevision: number;
  changed: Record<string, JSONValue>;
  effects: CapsuleComponentEffect[];
  returnValue?: unknown;
}

export interface CapsuleComponentRuntime {
  createComponent(
    definition: CapsuleComponentDefinition,
    args: Record<string, unknown>,
  ): CapsuleComponentInstanceHandle;
  getContext(component: CapsuleComponentInstanceHandle): object;
  updateComponent(
    component: CapsuleComponentInstanceHandle,
    args: Record<string, unknown>,
  ): CapsuleComponentUpdate;
  invokeAction(
    component: CapsuleComponentInstanceHandle,
    action: string,
    args: unknown[],
  ): CapsuleComponentUpdate | Promise<CapsuleComponentUpdate>;
  destroyComponent(component: CapsuleComponentInstanceHandle): void;
  destroy(): void;
}

interface LiveCapsuleComponent {
  definition: CapsuleComponentDefinition;
  context: CapsuleComponentContext;
  evaluatorHandle: string;
  /**
   * The current Host args, read LIVE by the evaluator's args membrane
   * (`liveComponentArgs`): authored `this.args.x` reads project whatever
   * is in here at read time. `updateComponent` swaps the reference; the
   * authored instance persists across every arg change.
   */
  argsBox: { current: Record<string, unknown> };
  generation: number;
  revision: number;
}

/**
 * Stable Host-owned context read by Glimmer templates captured from a Capsule.
 * Executable authored state remains in SES.
 */
class CapsuleComponentContext {
  @tracked private revision = 0;
  private state: Record<string, unknown> = {};
  private revisionPending = false;

  constructor(
    private readonly runtime: DefaultCapsuleComponentRuntime,
    private readonly handle: CapsuleComponentInstanceHandle,
    descriptor: CapsuleComponentInstanceDescriptor,
  ) {
    this.installShape(descriptor);
    this.state = descriptor.state;
  }

  update(descriptor: CapsuleComponentInstanceDescriptor): void {
    this.installShape(descriptor);
    this.state = descriptor.state;
    // Action delivery can still be reached while Glimmer is evaluating a
    // getter (for example a component that synchronizes derived state during
    // render). The state swap is immediate, but invalidating a tag already
    // consumed in that render frame triggers Glimmer's backtracking assertion.
    // Coalesce the notification into the next microtask; readers then re-read
    // the already-current state without recreating the authored instance.
    if (!this.revisionPending) {
      this.revisionPending = true;
      queueMicrotask(() => {
        this.revisionPending = false;
        this.revision++;
      });
    }
  }

  readState(name: string, fallback?: unknown): unknown {
    this.revision;
    return this.state[name] ?? fallback;
  }

  readGetter(name: string): unknown {
    this.revision;
    return this.runtime.readProperty(this.handle, name);
  }

  private installShape(descriptor: CapsuleComponentInstanceDescriptor): void {
    for (let [name, fallback] of Object.entries(descriptor.state)) {
      if (Object.prototype.hasOwnProperty.call(this, name)) {
        continue;
      }
      Object.defineProperty(this, name, {
        configurable: false,
        enumerable: true,
        get: () => this.readState(name, fallback),
      });
    }
    for (let name of descriptor.getters) {
      if (Object.prototype.hasOwnProperty.call(this, name)) {
        continue;
      }
      Object.defineProperty(this, name, {
        configurable: false,
        enumerable: true,
        get: () => this.readGetter(name),
      });
    }
    for (let name of descriptor.actions) {
      if (Object.prototype.hasOwnProperty.call(this, name)) {
        continue;
      }
      Object.defineProperty(this, name, {
        configurable: false,
        enumerable: true,
        value: (...args: unknown[]) =>
          this.runtime.invokeAction(this.handle, name, args),
      });
    }
  }
}

/** Public-manager-facing adapter over a single principal's SES evaluator. */
export class DefaultCapsuleComponentRuntime implements CapsuleComponentRuntime {
  private nextInstance = 0;
  private instances = new Map<
    CapsuleComponentInstanceHandle,
    LiveCapsuleComponent
  >();

  constructor(private readonly evaluator: CapsuleModuleEvaluator) {}

  createComponent(
    definition: CapsuleComponentDefinition,
    args: Record<string, unknown>,
  ): CapsuleComponentInstanceHandle {
    let argsBox = { current: args };
    let descriptor = this.evaluator.instantiateComponent(
      definition.descriptor.instance.handle,
      () => argsBox.current,
    );
    let handle =
      `capsule-component-instance:${++this.nextInstance}` as CapsuleComponentInstanceHandle;
    let context = new CapsuleComponentContext(this, handle, descriptor);
    this.instances.set(handle, {
      definition,
      context,
      evaluatorHandle: descriptor.handle,
      argsBox,
      generation: 1,
      revision: 0,
    });
    return handle;
  }

  getContext(component: CapsuleComponentInstanceHandle): object {
    return this.get(component).context;
  }

  updateComponent(
    component: CapsuleComponentInstanceHandle,
    args: Record<string, unknown>,
  ): CapsuleComponentUpdate {
    // Args are PATHS: the authored instance reads them through the live
    // membrane, so an arg change is just a reference swap — no signature
    // diff, no re-instantiation, no state cloning. Authored component
    // state survives every data update, and template reads of context
    // getters re-run against current values through Host tracking.
    let live = this.get(component);
    live.argsBox.current = args;
    return unchangedUpdate(live);
  }

  invokeAction(
    component: CapsuleComponentInstanceHandle,
    action: string,
    args: unknown[],
  ): CapsuleComponentUpdate | Promise<CapsuleComponentUpdate> {
    let live = this.get(component);
    let result = this.evaluator.invokeComponentAction(
      live.evaluatorHandle,
      action,
      args,
    );
    let apply = (value: CapsuleComponentActionResult) =>
      this.applyActionResult(live, value);
    return result instanceof Promise ? result.then(apply) : apply(result);
  }

  destroyComponent(component: CapsuleComponentInstanceHandle): void {
    let live = this.instances.get(component);
    if (!live) {
      return;
    }
    this.evaluator.releaseComponentInstance(live.evaluatorHandle);
    this.instances.delete(component);
  }

  readProperty(
    component: CapsuleComponentInstanceHandle,
    property: string,
  ): unknown {
    let live = this.get(component);
    return this.evaluator.readComponentProperty(live.evaluatorHandle, property);
  }

  get activeComponentCount(): number {
    return this.instances.size;
  }

  destroy(): void {
    for (let handle of [...this.instances.keys()]) {
      this.destroyComponent(handle);
    }
  }

  private applyActionResult(
    live: LiveCapsuleComponent,
    result: CapsuleComponentActionResult,
  ): CapsuleComponentUpdate | Promise<CapsuleComponentUpdate> {
    live.revision++;
    live.context.update(result);
    for (let effect of result.effects) {
      dispatchEffect(live.argsBox.current, effect);
    }
    return {
      generation: live.generation,
      componentRevision: live.revision,
      changed: jsonState(result.state),
      effects: result.effects,
      ...(result.returnValue !== undefined
        ? { returnValue: result.returnValue }
        : {}),
    };
  }

  private get(handle: CapsuleComponentInstanceHandle): LiveCapsuleComponent {
    let live = this.instances.get(handle);
    if (!live) {
      throw new Error(`Unknown or released Capsule component '${handle}'`);
    }
    return live;
  }
}

function unchangedUpdate(live: LiveCapsuleComponent): CapsuleComponentUpdate {
  return {
    generation: live.generation,
    componentRevision: live.revision,
    changed: {},
    effects: [],
  };
}

function dispatchEffect(
  args: Record<string, unknown>,
  effect: CapsuleComponentEffect,
): void {
  if (effect.type === 'view-card') {
    let viewCard = args.viewCard;
    if (typeof viewCard === 'function') {
      viewCard(effect.target, effect.format, effect.options);
    }
  } else if (effect.type === 'set') {
    let set = args.set;
    if (typeof set === 'function') {
      set(effect.value);
    }
  }
}

function jsonState(value: Record<string, unknown>): Record<string, JSONValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JSONValue>;
}
