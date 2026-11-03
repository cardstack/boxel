import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { consumeTag, VOLATILE_TAG } from '@glimmer/validator';
import { modifier } from 'ember-modifier';
import { frame, type NodeGroup, nodeGroup } from 'motion-dom';

import { isDev, requestSettle, snapshotAll } from './layout.ts';
import { postRender } from './scheduler.ts';

/**
 * LayoutGroup for Glimmer — Motion's components/LayoutGroup:
 *   - `@id`: namespaces every `layoutId` beneath it (nested groups append: "a-b")
 *   - `@inherit`: true (default) shares the parent's projection group and id, "id" shares only the id,
 *     false starts a fresh group
 *   - yields the context { id, group, forceRender }, which is what React's LayoutGroupContext holds
 *
 * It also hosts boxel-motion's render detector: a getter that consumes the volatile tag is re-evaluated
 * on every render pass — BEFORE the DOM is patched. That is where React calls getSnapshotBeforeUpdate,
 * so projection nodes snapshot there and measure again once the render has landed.
 *
 * React's LayoutGroup renders no DOM; here a `display: contents` wrapper makes the group discoverable
 * from any motion element below it without threading arguments through the tree.
 */
type Inherit = boolean | 'id';

export interface LayoutGroupContext {
  readonly forceRender: () => void;
  readonly group?: NodeGroup;
  readonly id?: string;
}

const groups = new WeakMap<Element, LayoutGroup>();

/** the nearest group context above an element, if any */
export function closestLayoutGroup(
  el: Element,
): LayoutGroupContext | undefined {
  const host = el.parentElement?.closest('[data-layout-group]');
  return host ? groups.get(host)?.context : undefined;
}

let pending = false;
function settleOnce() {
  pending = false;
  requestSettle();
}

interface Signature {
  Args: { id?: string; inherit?: Inherit };
  Blocks: { default: [LayoutGroupContext] };
}

/** React: a motion element snapshots its layout (getSnapshotBeforeUpdate) whenever it re-renders; here
 *  a render pass snapshots every projection node, once, and settles after the pass (boxel-motion's trick) */
export function snapshotOnRender() {
  if (!pending) {
    pending = true;
    snapshotAll();
    postRender(settleOnce);
  }
}

/**
 * The attribute an element renders when a render detector stands above
 * everything inside it. <LayoutGroup>, <ReorderGroup> and a <Choreo> region
 * render it, and so does any component that calls `snapshotOnRender()` from
 * a render detector of its own. The development-mode check for an ungrouped
 * `layout` or `layoutId` element looks for it at or above the element.
 * <Presence> renders no element, so a node finds it through its presence
 * handle instead.
 */
export const RENDER_DETECTOR_ATTRIBUTE = 'data-motion-render-detector';
const RENDER_DETECTOR = `[${RENDER_DETECTOR_ATTRIBUTE}]`;

/**
 * A portalled subtree (`{{#in-element}}`, marked with Motion's portal
 * attribute) lands outside its template's DOM, so its DOM ancestors say
 * nothing about the detectors its template sits under.
 */
const PORTALLED = '[data-framer-portal-id]';

let warnedUngroupedLayout = false;

/**
 * Development only: warn, once per document, about a `layout` or `layoutId`
 * element that nothing will snapshot.
 *
 * A layout animation needs the element's box from BEFORE the DOM changed, and
 * a `layoutId` hand-off needs the outgoing element's box from before it left.
 * In Glimmer the only thing that measures either then is a render detector.
 * An element with none above it, and no <Presence> handle, moves to its new
 * place in a single frame: a keyed list it sits in reorders, filters or sorts
 * without animating, and a hand-off jumps instead of morphing.
 * A <Presence> measures only on a pass where its `@items` change, which is
 * the list change this warning is about, so an element under one is exempt;
 * one that grows inside it for another reason still needs a <LayoutGroup>.
 * `layoutChange()` is the one other way to snapshot, and this cannot see it:
 * an element animated only through `layoutChange()` is warned about too, and
 * a <LayoutGroup> around it quiets the warning.
 *
 * The check reads the element's DOM ancestors, so it can warn about an element
 * that is measured. One rendered through a plain `{{#in-element}}` inside a
 * <LayoutGroup> lands outside the group's DOM, and only Motion's marked
 * portals are exempt. A <LayoutGroup> inside the `{{#in-element}}` block
 * quiets it. A <Presence> renders no element, so an element counts as under
 * one only through the yielded handle, which reaches it through motion
 * elements: the handle on the element itself or on a motion element above it.
 * A `layout` element inside a row that doesn't carry `{{motion presence=p}}`
 * warns, although the Presence measures it on an `@items` change; the handle
 * on the row's element quiets it. `closest()` stops at a shadow root, so an
 * element inside a shadow tree whose host sits under a <LayoutGroup> warns as
 * well; a <LayoutGroup> inside the shadow tree quiets it.
 *
 * The check runs once, when the element's node is created. An element that is
 * not in the document then is never checked, so a list rendered into a
 * detached container and attached later can reorder in a single frame with no
 * warning.
 */
export function warnIfNothingSnapshots(el: Element, inPresence: boolean) {
  if (
    !isDev() ||
    warnedUngroupedLayout ||
    inPresence ||
    !el.isConnected ||
    el.closest(RENDER_DETECTOR) ||
    el.closest(PORTALLED)
  ) {
    return;
  }
  warnedUngroupedLayout = true;
  console.warn(
    'glimmer-motion: a {{motion layout}} or layoutId element has no ' +
      '<LayoutGroup>, <Presence>, <ReorderGroup> or <Choreo> above it. Those ' +
      'are what measure it before the DOM changes, so without one a list it ' +
      'sits in reorders, filters or sorts in a single frame, and a layoutId ' +
      'hand-off jumps instead of morphing. Wrap the {{#each}} (or the ' +
      'elements that hand off) in a <LayoutGroup>, or make the change inside ' +
      'layoutChange(() => …). The element:',
    el,
  );
}

/** let the next ungrouped `layout` element warn again (test support resets this between tests) */
export function resetUngroupedLayoutWarning() {
  warnedUngroupedLayout = false;
}

export class LayoutGroup extends Component<Signature> {
  @tracked element?: HTMLElement;
  @tracked private version = 0;
  private ownGroup = nodeGroup();

  readonly context: LayoutGroupContext;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    const group = this;
    this.context = {
      get id() {
        return group.effectiveId;
      },
      get group() {
        return group.effectiveGroup;
      },
      forceRender: () =>
        frame.postRender(() => {
          group.version++;
        }),
    };
  }

  get inherit(): Inherit {
    return this.args.inherit ?? true;
  }
  get parent(): LayoutGroupContext | undefined {
    return this.element ? closestLayoutGroup(this.element) : undefined;
  }
  /** id composition: upstream-id + "-" + own id, or the upstream id when we have none (only when inheriting) */
  get effectiveId(): string | undefined {
    const own = this.args.id;
    const upstream =
      this.inherit === true || this.inherit === 'id'
        ? this.parent?.id
        : undefined;
    if (upstream) {
      return own ? `${upstream}-${own}` : upstream;
    }
    return own;
  }
  get effectiveGroup(): NodeGroup {
    return (this.inherit === true && this.parent?.group) || this.ownGroup;
  }

  register = modifier((el: HTMLElement) => {
    groups.set(el, this);
    this.element = el;
    return () => groups.delete(el);
  });

  get renderDetector(): undefined {
    consumeTag(VOLATILE_TAG);
    void this.version; // forceRender re-renders this group: React's forceRender after exits complete
    snapshotOnRender();
    return undefined;
  }

  <template>
    {{this.renderDetector}}
    <div
      data-layout-group
      data-motion-render-detector
      style='display: contents'
      {{this.register}}
    >
      {{yield this.context}}
    </div>
  </template>
}

export default LayoutGroup;
