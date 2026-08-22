/**
 * Reorder.Group for Glimmer — Motion's packages/framer-motion/src/components/Reorder/Group.tsx.
 * Renders a <ul> (or `@tag`) and yields the reorder context the items take as `@group`:
 *
 *   <ReorderGroup @values={{this.items}} @onReorder={{this.setItems}} @axis="x" as |group|>
 *     {{#each this.items as |item|}}<ReorderItem @group={{group}} @value={{item}}>…</ReorderItem>{{/each}}
 *   </ReorderGroup>
 */
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { Box, Point } from 'motion-utils';
import type { Transition } from 'motion-dom';
import { VOLATILE_TAG, consumeTag } from '@glimmer/validator';
import motion from '../motion';
import { snapshotOnRender } from '../layout-group';
import { postRender } from '../scheduler';
import { checkReorder } from './check-reorder';
import { detectAxis } from './detect-axis';
import type { ItemData, ReorderAxis, ReorderContextProps } from './types';
import { captureGroup } from './capture';

interface Signature<V> {
  Element: HTMLElement;
  Args: {
    values: V[];
    onReorder: (newOrder: V[]) => void;
    /** detected from the item layout by default; "xy" enables wrapped-layout reordering */
    axis?: ReorderAxis;
    style?: Record<string, unknown>;
    layout?: boolean | 'position' | 'size';
    transition?: Transition;
  };
  Blocks: { default: [group: ReorderContextProps<V>] };
}

export default class ReorderGroup<V> extends Component<Signature<V>> {
  itemLayouts = new Map<V, Box>();
  @tracked detectedAxis: ReorderAxis = 'y';
  isReordering = false;
  groupRef: { current: Element | null } = { current: null };

  get axis(): ReorderAxis { return this.args.axis || this.detectedAxis; }
  /** disable browser scroll anchoring: reordering would otherwise shift the scroll position mid-drag */
  get style() { return { overflowAnchor: 'none', ...this.args.style }; }

  /** React: every render prunes layouts of values no longer present */
  private prune() {
    const valuesSet = new Set(this.args.values);
    this.itemLayouts.forEach((_, value) => { if (!valuesSet.has(value)) this.itemLayouts.delete(value); });
  }

  registerItem = (value: V, layout: Box) => {
    this.prune();
    this.itemLayouts.set(value, layout);
    if (!this.args.axis) {
      const nextAxis = detectAxis(this.args.values.flatMap((v) => { const l = this.itemLayouts.get(v); return l ? [l] : []; }));
      if (nextAxis !== this.detectedAxis) this.detectedAxis = nextAxis;
    }
  };

  updateOrder = (item: V, offset: Point, velocity: Point) => {
    if (this.isReordering) return;
    this.prune();
    const values = this.args.values;
    const order: ItemData<V>[] = values.flatMap((value) => { const layout = this.itemLayouts.get(value); return layout ? [{ value, layout }] : []; });
    const el = this.groupRef.current;
    const direction = el?.ownerDocument.defaultView?.getComputedStyle(el).direction === 'rtl' ? 'rtl' : 'ltr';
    const newOrder = checkReorder(order, item, offset, velocity, this.axis, direction);
    if (order !== newOrder) {
      this.isReordering = true;
      const newValues = [...values];
      const measuredIndexes = order.map(({ value }) => values.indexOf(value));
      newOrder.forEach(({ value }, index) => { newValues[measuredIndexes[index]!] = value; });
      this.args.onReorder(newValues);
      // React: useEffect(() => { isReordering.current = false }) — after the re-render this reorder caused
      postRender(() => { this.isReordering = false; });
    }
  };

  get context(): ReorderContextProps<V> {
    return { axis: this.axis, registerItem: this.registerItem, updateOrder: this.updateOrder, groupRef: this.groupRef };
  }

  /** React's Reorder.Group re-renders every item on reorder, so each snapshots its layout before the
   *  DOM moves — that snapshot is what lets the projection keep the dragged item under the pointer */
  get renderDetector(): undefined {
    consumeTag(VOLATILE_TAG);
    snapshotOnRender();
    return undefined;
  }

  <template>
    {{this.renderDetector}}
    <ul ...attributes {{captureGroup this.groupRef}} {{motion style=this.style layout=@layout transition=@transition}}>
      {{yield this.context}}
    </ul>
  </template>
}
