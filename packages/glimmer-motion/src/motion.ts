/**
 * {{motion}} — motion.div for Glimmer: the ember-modifier shell around MotionNode (node.ts), which holds
 * the whole lifecycle. This file is the Ember host adapter: it also installs the runloop as the engine
 * glue's post-render scheduler.
 */
import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { schedule } from '@ember/runloop';
import Modifier, { type ArgsFor } from 'ember-modifier';

import MotionNode, { type MotionEl, type MotionProps } from './node.ts';
import { setPostRender } from './scheduler.ts';

export type { MotionEl, MotionProps } from './node.ts';
export { flushPendingMounts } from './node.ts';

// React's useEffect slot is Ember's afterRender queue
// eslint-disable-next-line ember/no-runloop -- this IS the host adapter: the engine glue's postRender slot is Ember's afterRender queue
setPostRender((fn) => schedule('afterRender', null, fn));

interface Signature {
  Args: { Named: MotionProps; Positional: [] };
  Element: MotionEl;
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
