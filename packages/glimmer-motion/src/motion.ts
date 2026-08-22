/**
 * {{motion}} — motion.div for Glimmer: the ember-modifier shell around MotionNode (node.ts), which holds
 * the whole lifecycle. This file is the Ember host adapter: it also installs the runloop as the engine
 * glue's post-render scheduler.
 */
import Modifier, { type ArgsFor } from 'ember-modifier';
import { schedule } from '@ember/runloop';
import type Owner from '@ember/owner';
import { registerDestructor } from '@ember/destroyable';
import MotionNode, { type MotionEl, type MotionProps } from './node';
import { setPostRender } from './scheduler';

export type { MotionProps, MotionEl } from './node';
export { flushPendingMounts } from './node';

// React's useEffect slot is Ember's afterRender queue
setPostRender((fn) => schedule('afterRender', null, fn));

interface Signature {
  Element: MotionEl;
  Args: { Positional: []; Named: MotionProps };
}

export default class MotionModifier extends Modifier<Signature> {
  private readonly node = new MotionNode();

  constructor(owner: Owner, args: ArgsFor<Signature>) {
    super(owner, args);
    registerDestructor(this, () => this.node.destroy());
  }

  modify(element: MotionEl, _pos: [], named: MotionProps) {
    this.node.update(element, named);
  }
}
