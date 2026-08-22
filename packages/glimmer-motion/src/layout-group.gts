import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import type Owner from '@ember/owner';
import { VOLATILE_TAG, consumeTag } from '@glimmer/validator';
import { frame, nodeGroup, type NodeGroup } from 'motion-dom';
import { snapshotAll, requestSettle } from './layout';
import { postRender } from './scheduler';

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
  readonly id?: string;
  readonly group?: NodeGroup;
  readonly forceRender: () => void;
}

const groups = new WeakMap<Element, LayoutGroup>();

/** the nearest group context above an element, if any */
export function closestLayoutGroup(el: Element): LayoutGroupContext | undefined {
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

export default class LayoutGroup extends Component<Signature> {
  @tracked element?: HTMLElement;
  @tracked private version = 0;
  private ownGroup = nodeGroup();

  readonly context: LayoutGroupContext;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    const group = this;
    this.context = {
      get id() { return group.effectiveId; },
      get group() { return group.effectiveGroup; },
      forceRender: () => frame.postRender(() => { group.version++; }),
    };
  }

  get inherit(): Inherit { return this.args.inherit ?? true; }
  get parent(): LayoutGroupContext | undefined {
    return this.element ? closestLayoutGroup(this.element) : undefined;
  }
  /** id composition: upstream-id + "-" + own id, or the upstream id when we have none (only when inheriting) */
  get effectiveId(): string | undefined {
    const own = this.args.id;
    const upstream = this.inherit === true || this.inherit === 'id' ? this.parent?.id : undefined;
    if (upstream) return own ? `${upstream}-${own}` : upstream;
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
    <div data-layout-group style="display: contents" {{this.register}}>
      {{yield this.context}}
    </div>
  </template>
}

