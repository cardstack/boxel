/**
 * Reorder.Item for Glimmer — Motion's packages/framer-motion/src/components/Reorder/Item.tsx.
 * Renders an <li> that is a draggable, layout-animated motion element snapping back to origin;
 * while it is dragged it reports its offset to the group, which reorders the values.
 */
import Component from '@glimmer/component';
import { isMotionValue, motionValue, transformValue, type MotionValue, type Transition, type MotionNodeOptions } from 'motion-dom';
import motion from '../motion';
import type { PresenceHandle } from '../presence-types';
import { autoScrollIfNeeded, resetAutoScrollState } from './auto-scroll';
import type { ReorderContextProps } from './types';

type DragInfo = { point: { x: number; y: number }; velocity: { x: number; y: number }; offset: { x: number; y: number }; delta: { x: number; y: number } };

interface Signature<V> {
  Element: HTMLElement;
  Args: {
    group: ReorderContextProps<V>;
    value: V;
    style?: Record<string, unknown>;
    /** a subset of layout options, primarily to disable layout="size" */
    layout?: true | 'position';
    initial?: MotionNodeOptions['initial'];
    animate?: MotionNodeOptions['animate'];
    exit?: MotionNodeOptions['exit'];
    whileDrag?: MotionNodeOptions['whileDrag'];
    transition?: Transition;
    dragTransition?: MotionNodeOptions['dragTransition'];
    dragListener?: boolean;
    dragControls?: MotionNodeOptions['dragControls'];
    presence?: PresenceHandle;
    onDrag?: (event: PointerEvent, info: DragInfo) => void;
    onDragEnd?: (event: PointerEvent, info: DragInfo) => void;
  };
  Blocks: { default: [] };
}

export default class ReorderItem<V> extends Component<Signature<V>> {
  point = {
    x: (isMotionValue(this.args.style?.['x']) ? this.args.style!['x'] : motionValue(0)) as MotionValue<number>,
    y: (isMotionValue(this.args.style?.['y']) ? this.args.style!['y'] : motionValue(0)) as MotionValue<number>,
  };
  zIndex = transformValue(() => (this.point.x.get() || this.point.y.get() ? 1 : 'unset'));

  get style() { return { ...this.args.style, x: this.point.x, y: this.point.y, zIndex: this.zIndex }; }
  get layout(): true | 'position' { return this.args.layout ?? true; }
  get dragAxis(): true | 'x' | 'y' { const { axis } = this.args.group; return axis === 'xy' ? true : axis; }

  onDrag = (event: PointerEvent, info: DragInfo) => {
    const { axis, updateOrder, groupRef } = this.args.group;
    const { velocity, point: pointerPoint } = info;
    const offset = { x: this.point.x.get(), y: this.point.y.get() };
    updateOrder(this.args.value, offset, velocity);
    const scrollAxis = axis === 'xy' ? (Math.abs(velocity.x) > Math.abs(velocity.y) ? 'x' : 'y') : axis;
    autoScrollIfNeeded(groupRef.current, pointerPoint[scrollAxis], scrollAxis, velocity[scrollAxis]);
    this.args.onDrag?.(event, info);
  };
  onDragEnd = (event: PointerEvent, info: DragInfo) => {
    resetAutoScrollState();
    this.args.onDragEnd?.(event, info);
  };
  onLayoutMeasure = (measured: Parameters<ReorderContextProps<V>['registerItem']>[1]) => this.args.group.registerItem(this.args.value, measured);

  <template>
    <li ...attributes {{motion drag=this.dragAxis dragSnapToOrigin=true style=this.style layout=this.layout
      onDrag=this.onDrag onDragEnd=this.onDragEnd onLayoutMeasure=this.onLayoutMeasure
      initial=@initial animate=@animate exit=@exit whileDrag=@whileDrag transition=@transition dragTransition=@dragTransition
      dragListener=@dragListener dragControls=@dragControls presence=@presence}}>
      {{yield}}
    </li>
  </template>
}
