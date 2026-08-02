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

export function isInIsolatedRenderTransaction(): boolean {
  return activeRenderMode !== undefined;
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
    inTransaction(activeRender.env, () => activeRender.rerender());
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

  try {
    let previousRenderMode = activeRenderMode;
    activeRenderMode = mode;
    try {
      inTransaction(_context.env, () => {
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
      });
    } finally {
      activeRenderMode = previousRenderMode;
    }
  } catch (err: any) {
    resetTracking();
    let error = new CardError(
      `Encountered error rendering HTML for card: ${err.message}`,
    );
    error.additionalErrors = [err];
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
