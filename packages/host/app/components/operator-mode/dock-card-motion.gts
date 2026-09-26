import Component from '@glimmer/component';

import { StepComponent, type TimelineNode } from 'glimmer-motion';

import type { CardOpenOrigin } from '@cardstack/host/lib/card-open-origin';
import MotionTiming, { motionEase } from '@cardstack/host/lib/motion-timing';

import { liftIn } from '@cardstack/host/lib/motion-transform';

// Snapshot support is optional. The fallback reveals the already laid-out
// destination, never resizes a populated card from a tiny search tile.
class DockSteps extends StepComponent<{ id: string; duration: number }> {
  node(): TimelineNode {
    let { id, duration } = this.args;
    return {
      kind: 'parallel',
      children: [
        {
          kind: 'tween',
          of: { id, type: 'inserted' },
          props: { transform: liftIn, opacity: [0, 1] },
          ms: duration * 1000,
          ease: motionEase,
        },
        {
          kind: 'tween',
          of: { id, type: 'kept' },
          props: { opacity: 1 },
          ms: duration * 1000,
          ease: motionEase,
        },
      ],
    };
  }
}

interface Signature {
  Args: { id: string; origin: CardOpenOrigin; duration?: number };
}

export default class DockCardMotion extends Component<Signature> {
  private timing = new MotionTiming(this);
  private get duration() {
    return this.timing.duration(this.args.duration);
  }
  <template><DockSteps @id={{@id}} @duration={{this.duration}} /></template>
}
