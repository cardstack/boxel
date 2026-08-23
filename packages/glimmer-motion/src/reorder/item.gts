/**
 * Reorder.Item for Glimmer — Motion's packages/framer-motion/src/components/Reorder/Item.tsx.
 * Renders an <li> that is a draggable, layout-animated motion element snapping back to origin;
 * while it is dragged it reports its offset to the group, which reorders the values.
 */
import Component from '@glimmer/component';
import {
  isMotionValue,
  type MotionNodeOptions,
  type MotionValue,
  motionValue,
  transformValue,
  type Transition,
} from 'motion-dom';

import motion from '../motion.ts';
import type { PresenceHandle } from '../presence-types.ts';
import { autoScrollIfNeeded, resetAutoScrollState } from './auto-scroll.ts';
import type { ReorderContextProps } from './types.ts';

type DragInfo = {
  delta: { x: number; y: number };
  offset: { x: number; y: number };
  point: { x: number; y: number };
  velocity: { x: number; y: number };
};

interface Signature<V> {
  Args: {
    animate?: MotionNodeOptions['animate'];
    dragControls?: MotionNodeOptions['dragControls'];
    dragListener?: boolean;
    dragTransition?: MotionNodeOptions['dragTransition'];
    exit?: MotionNodeOptions['exit'];
    group: ReorderContextProps<V>;
    initial?: MotionNodeOptions['initial'];
    /** a subset of layout options, primarily to disable layout="size" */
    layout?: true | 'position';
    onDrag?: (event: PointerEvent, info: DragInfo) => void;
    onDragEnd?: (event: PointerEvent, info: DragInfo) => void;
    presence?: PresenceHandle;
    style?: Record<string, unknown>;
    transition?: Transition;
    value: V;
    whileDrag?: MotionNodeOptions['whileDrag'];
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

export class ReorderItem<V> extends Component<Signature<V>> {
  point = {
    x: (isMotionValue(this.args.style?.['x'])
      ? this.args.style!['x']
      : motionValue(0)) as MotionValue<number>,
    y: (isMotionValue(this.args.style?.['y'])
      ? this.args.style!['y']
      : motionValue(0)) as MotionValue<number>,
  };
  zIndex = transformValue(() =>
    this.point.x.get() || this.point.y.get() ? 1 : 'unset',
  );

  get style() {
    return {
      ...this.args.style,
      x: this.point.x,
      y: this.point.y,
      zIndex: this.zIndex,
    };
  }
  get layout(): true | 'position' {
    return this.args.layout ?? true;
  }
  get dragAxis(): true | 'x' | 'y' {
    const { axis } = this.args.group;
    return axis === 'xy' ? true : axis;
  }

  onDrag = (event: PointerEvent, info: DragInfo) => {
    const { axis, updateOrder, groupRef } = this.args.group;
    const { velocity, point: pointerPoint } = info;
    const offset = { x: this.point.x.get(), y: this.point.y.get() };
    updateOrder(this.args.value, offset, velocity);
    const scrollAxis =
      axis === 'xy'
        ? Math.abs(velocity.x) > Math.abs(velocity.y)
          ? 'x'
          : 'y'
        : axis;
    autoScrollIfNeeded(
      groupRef.current,
      pointerPoint[scrollAxis],
      scrollAxis,
      velocity[scrollAxis],
    );
    this.args.onDrag?.(event, info);
  };
  onDragEnd = (event: PointerEvent, info: DragInfo) => {
    resetAutoScrollState();
    this.args.onDragEnd?.(event, info);
  };
  onLayoutMeasure = (
    measured: Parameters<ReorderContextProps<V>['registerItem']>[1],
  ) => this.args.group.registerItem(this.args.value, measured);

  <template>
    <li
      ...attributes
      {{motion
        drag=this.dragAxis
        dragSnapToOrigin=true
        style=this.style
        layout=this.layout
        onDrag=this.onDrag
        onDragEnd=this.onDragEnd
        onLayoutMeasure=this.onLayoutMeasure
        initial=@initial
        animate=@animate
        exit=@exit
        whileDrag=@whileDrag
        transition=@transition
        dragTransition=@dragTransition
        dragListener=@dragListener
        dragControls=@dragControls
        presence=@presence
      }}
    >
      {{yield}}
    </li>
  </template>
}

export default ReorderItem;
