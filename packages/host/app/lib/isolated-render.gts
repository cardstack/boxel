import { destroy } from '@ember/destroyable';

import type Owner from '@ember/owner';
// @ts-ignore - no types for @glimmer/node
import { serializeBuilder } from '@glimmer/node';
// prettier-ignore
// @ts-ignore - no types for @glimmer/runtime
import { renderComponent as glimmerRenderComponent, inTransaction, rehydrationBuilder } from '@glimmer/runtime';
// @ts-ignore - no types for @glimmer/validator
import { resetTracking } from '@glimmer/validator';

import { CardError } from '@cardstack/runtime-common/error';

import type { Format } from '@cardstack/base/card-api';

import type { ComponentLike } from '@glint/template';

import type { SimpleElement } from '@simple-dom/interface';

interface Signature {
  Args: Record<string, unknown>;
}

type RenderableComponent = ComponentLike<Signature>;
export type IsolatedRenderArgs = Record<string, unknown>;

type ActiveRender = {
  drop: object;
  env: object;
  rerender(options?: { alwaysRevalidate?: boolean }): void;
};

type RenderMode = 'client' | 'serialize' | 'rehydrate';
let activeRenderMode: RenderMode | undefined;
type IsolatedRenderErrorCapture = { firstError?: unknown };
let activeErrorCapture: IsolatedRenderErrorCapture | undefined;
const deferredIsolatedRenderQueues: Array<Array<() => void>> = [];
const pendingDeferredIsolatedRenders = new Set<Promise<void>>();

export function isInIsolatedRenderTransaction(): boolean {
  return activeRenderMode !== undefined;
}

export async function captureIsolatedRenderErrors<T>(
  callback: () => Promise<T>,
): Promise<T> {
  // A nested capture belongs to the same render island. Keeping the original
  // collector means the first authored failure wins across delegated renders.
  if (activeErrorCapture) {
    return callback();
  }

  let capture: IsolatedRenderErrorCapture = {};
  let previousCapture = activeErrorCapture;
  let result: Promise<T>;
  try {
    // Keep the collector global only for the synchronous portion that creates
    // the isolated transaction. Holding it across an await lets unrelated
    // concurrent prerenders share the same first-error slot. Deferred nested
    // renders explicitly retain this collector when they are scheduled.
    activeErrorCapture = capture;
    result = callback();
  } finally {
    activeErrorCapture = previousCapture;
  }
  try {
    let value = await result;
    if (capture.firstError !== undefined) {
      throw capture.firstError;
    }
    return value;
  } catch (error) {
    throw capture.firstError ?? error;
  }
}

export function deferUntilIsolatedRenderCompletes(callback: () => void) {
  let queue =
    deferredIsolatedRenderQueues[deferredIsolatedRenderQueues.length - 1];
  if (!activeRenderMode || !queue) {
    return false;
  }
  queue.push(callback);
  return true;
}

export async function settleDeferredIsolatedRenders(): Promise<void> {
  let firstError: unknown;
  while (pendingDeferredIsolatedRenders.size > 0) {
    let batch = [...pendingDeferredIsolatedRenders];
    let results = await Promise.allSettled(batch);
    for (let result of results) {
      if (result.status === 'rejected' && firstError === undefined) {
        firstError = result.reason;
      }
    }
  }
  if (firstError !== undefined) {
    throw firstError;
  }
}

function scheduleDeferredIsolatedRenders(
  deferredRenders: Array<() => void>,
  errorCapture: IsolatedRenderErrorCapture | undefined,
) {
  let pending = new Promise<void>((resolve, reject) => {
    // Ember can finish the host renderer commit after the current microtask
    // checkpoint. A Promise callback is therefore not a sufficient boundary:
    // an SES render error can still reset Glimmer's process-global tracking
    // stack before the host closes its frame. A new task is the first point at
    // which the host commit is guaranteed to have returned.
    setTimeout(() => {
      let previousCapture = activeErrorCapture;
      activeErrorCapture = errorCapture;
      try {
        for (let deferredRender of deferredRenders) {
          deferredRender();
        }
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        activeErrorCapture = previousCapture;
      }
    }, 0);
  });
  pendingDeferredIsolatedRenders.add(pending);
  void pending.then(
    () => pendingDeferredIsolatedRenders.delete(pending),
    () => pendingDeferredIsolatedRenders.delete(pending),
  );
}

const activeRenders = new WeakMap<SimpleElement, ActiveRender>();
const serializedRenderRoots = new WeakSet<SimpleElement>();
type SimpleNode = NonNullable<SimpleElement['firstChild']>;
const suspendedSerializedChildren = new WeakMap<SimpleElement, SimpleNode[]>();

export function hasSerializedComponent(element: SimpleElement): boolean {
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 8 && child.nodeValue?.startsWith('%+b:')) {
      return true;
    }
  }
  return false;
}

export function isWithinSerializedIsolatedRender(
  element: SimpleElement,
): boolean {
  let current: SimpleElement | null = element;
  while (current) {
    if (serializedRenderRoots.has(current)) {
      return true;
    }
    current = current.parentNode as SimpleElement | null;
  }
  return false;
}

// Nested render owners need an explicit server-to-client handoff. The outer
// Glimmer program expects the modifier-owned element to have no template
// children and would otherwise clear the inner serialized program before its
// modifier gets a chance to attach. Park those exact nodes while the outer
// shell hydrates; the inner owner restores and adopts them synchronously.
export function suspendSerializedComponent(element: SimpleElement): boolean {
  if (!hasSerializedComponent(element)) {
    return false;
  }
  let children: SimpleNode[] = [];
  while (element.firstChild) {
    let child = element.firstChild as SimpleNode;
    children.push(child);
    element.removeChild(child);
  }
  suspendedSerializedChildren.set(element, children);
  return true;
}

export function resumeSerializedComponent(element: SimpleElement): boolean {
  let children = suspendedSerializedChildren.get(element);
  if (!children) {
    return false;
  }
  suspendedSerializedChildren.delete(element);
  for (let child of children) {
    element.appendChild(child);
  }
  return true;
}

export function discardSuspendedSerializedComponent(
  element: SimpleElement,
): void {
  suspendedSerializedChildren.delete(element);
}

export function render(
  C: RenderableComponent,
  element: SimpleElement,
  owner: Owner,
  format?: Format,
): void {
  renderWithMode('client', C, element, owner, { format });
}

export function renderWithArgs(
  C: RenderableComponent,
  element: SimpleElement,
  owner: Owner,
  args: IsolatedRenderArgs,
): void {
  renderWithMode('client', C, element, owner, args);
}

export function serialize(
  C: RenderableComponent,
  element: SimpleElement,
  owner: Owner,
  format?: Format,
): void {
  renderWithMode('serialize', C, element, owner, { format });
}

export function serializeWithArgs(
  C: RenderableComponent,
  element: SimpleElement,
  owner: Owner,
  args: IsolatedRenderArgs,
): void {
  renderWithMode('serialize', C, element, owner, args);
}

export function rerenderSerializedComponent(element: SimpleElement): void {
  let activeRender = activeRenders.get(element);
  if (activeRender) {
    // Opaque sandbox data deliberately crosses this low-level render boundary
    // as inert values instead of host-owned tracked objects. A data
    // acknowledgement therefore has no Glimmer tag inside the isolated
    // program to invalidate. The host explicitly requests this rerender after
    // updating the opaque snapshot, so revalidate the mounted program without
    // tearing it down or replacing its authored DOM.
    inTransaction(activeRender.env, () =>
      activeRender.rerender({ alwaysRevalidate: true }),
    );
  }
}

// Glimmer's serialization builder intentionally exposes a SimpleDOM tree.
// Trusted Base/catalog templates may use DOM-aware modifiers that require real
// HTMLElements (computed-style readers are a common example). Those cards are
// still valid prerenders, but they cannot participate in marker adoption. The
// caller must derive `allowLiveDOM` from the card definition's trust policy;
// realm-authored code must never reach the live fallback merely because its
// serialization failed.
export function prerenderWithArgs(
  C: RenderableComponent,
  element: SimpleElement,
  owner: Owner,
  args: IsolatedRenderArgs,
  allowLiveDOM: boolean,
): 'serialized' | 'rendered' {
  if (allowLiveDOM) {
    renderWithArgs(C, element, owner, args);
    return 'rendered';
  }
  serializeWithArgs(C, element, owner, args);
  return 'serialized';
}

export function rehydrate(
  C: RenderableComponent,
  element: SimpleElement,
  owner: Owner,
  format?: Format,
): void {
  renderWithMode('rehydrate', C, element, owner, { format });
}

export function rehydrateWithArgs(
  C: RenderableComponent,
  element: SimpleElement,
  owner: Owner,
  args: IsolatedRenderArgs,
): void {
  renderWithMode('rehydrate', C, element, owner, args);
}

// Replacing a live component program normally clears and recreates its DOM.
// Serialized boundaries let Glimmer release the old program, keep the marked
// nodes in place, and adopt them into the next compatible program. This is the
// shared identity primitive for server-to-client card hydration and Code mode
// template updates.
export function rehydrateReplacingActiveWithArgs(
  C: RenderableComponent,
  element: SimpleElement,
  owner: Owner,
  args: IsolatedRenderArgs,
): void {
  releaseActiveRender(element);
  renderWithMode('rehydrate', C, element, owner, args);
}

function renderWithMode(
  mode: RenderMode,
  C: RenderableComponent,
  element: SimpleElement,
  owner: Owner,
  args: IsolatedRenderArgs,
): void {
  // `renderComponent()` creates a live Glimmer tree. Dropping the DOM nodes
  // without destroying the previous render leaks that tree across rerenders.
  if (mode === 'rehydrate') {
    if (activeRenders.has(element)) {
      throw new Error('cannot rehydrate an element with an active render');
    }
  } else {
    teardown(element);
    removeChildren(element);
  }
  if (mode === 'serialize') {
    serializedRenderRoots.add(element);
  } else {
    serializedRenderRoots.delete(element);
  }

  let {
    state: { owner: _owner, builder: _builder, context: _context },
  } = owner.lookup('renderer:-dom') as any;

  let result: ActiveRender | undefined;
  let previousRenderMode = activeRenderMode;
  let renderErrorCapture = activeErrorCapture;
  let deferredRenders: Array<() => void> | undefined;

  try {
    if (previousRenderMode === undefined) {
      deferredRenders = [];
      deferredIsolatedRenderQueues.push(deferredRenders);
    }
    activeRenderMode = mode;
    let renderComponent = () => {
      let builder =
        mode === 'serialize'
          ? serializeBuilder
          : mode === 'rehydrate'
            ? rehydrationBuilder
            : _builder;
      let iterator = glimmerRenderComponent(
        _context,
        builder(_context.env, { element }),
        _owner,
        C,
        args,
      );
      result = iterator.sync();
    };
    // Glimmer resets its process-global tracking stack when component
    // evaluation throws. `inTransaction()` commits in a `finally`, and that
    // commit can then throw "attempted to close a tracking frame". A finally
    // exception replaces the authored exception in JavaScript. Capture the
    // block failure before commit, allow the environment to finish its
    // cleanup, and give the authored failure precedence afterward.
    let renderError: unknown;
    let transactionError: unknown;
    try {
      inTransaction(_context.env, () => {
        try {
          renderComponent();
        } catch (error) {
          renderError = error;
        }
      });
    } catch (error) {
      transactionError = error;
    }
    if (renderError !== undefined) {
      throw renderError;
    }
    if (transactionError !== undefined) {
      throw transactionError;
    }
    if (deferredRenders) {
      deferredIsolatedRenderQueues.pop();
      // The outer Glimmer transaction has closed before deferred nested
      // islands run. Restore the previous mode now so each deferred island is
      // treated as its own top-level transaction, including independent
      // tracking-stack recovery when authored rendering throws. Leaving the
      // outer mode active here made a failed nested render skip `resetTracking`
      // and replace the authored error with "attempted to close a tracking
      // frame" during the next renderer commit.
      activeRenderMode = previousRenderMode;
      scheduleDeferredIsolatedRenders(deferredRenders, renderErrorCapture);
    }
    activeRenderMode = previousRenderMode;
  } catch (err: any) {
    // Glimmer can replace an authored render exception with a tracking-stack
    // cleanup exception while an outer renderer unwinds. Preserve the first
    // exception at the render-island boundary before any cleanup runs.
    if (activeErrorCapture) {
      activeErrorCapture.firstError ??= err;
    }
    activeRenderMode = previousRenderMode;
    if (
      deferredRenders &&
      deferredIsolatedRenderQueues[deferredIsolatedRenderQueues.length - 1] ===
        deferredRenders
    ) {
      deferredIsolatedRenderQueues.pop();
    }
    let cleanupError: unknown;
    if (result) {
      try {
        destroy(result.drop);
      } catch (error) {
        // The render error itself can leave Glimmer midway through unwinding
        // a tracking frame. Destroying the partial outer tree is still the
        // right best-effort cleanup, but a second bookkeeping error must not
        // replace the authored exception that made the render fail.
        cleanupError = error;
      }
      result = undefined;
    }
    serializedRenderRoots.delete(element);
    removeChildren(element);
    // A nested SES island can fail while the outer Host Mode serialization
    // transaction still owns Glimmer's tracking frame. Resetting Glimmer's
    // process-global tracking stack here would erase that outer frame and
    // replace the authored card error with "attempted to close a tracking
    // frame, but one was not open". Let the outermost render perform the one
    // recovery reset after the complete nested transaction has unwound.
    if (previousRenderMode === undefined) {
      resetTracking();
    }
    let error = new CardError(
      `Encountered error rendering HTML for card: ${err.message}`,
    );
    error.additionalErrors = cleanupError ? [err, cleanupError] : [err];
    throw error;
  }

  if (!result) {
    throw new Error('isolated render did not produce a render result');
  }

  activeRenders.set(element, result);
}

export function teardown(element: SimpleElement): void {
  serializedRenderRoots.delete(element);
  releaseActiveRender(element);
  removeChildren(element);
}

function releaseActiveRender(element: SimpleElement): void {
  let activeRender = activeRenders.get(element);
  if (activeRender) {
    activeRenders.delete(element);
    destroy(activeRender.drop);
  }
}

function removeChildren(element: SimpleElement) {
  let child = element.firstChild;
  while (child) {
    element.removeChild(child);
    child = element.firstChild;
  }
}
