import { StepComponent, type TimelineNode } from 'glimmer-motion';

import { motionEase } from '@cardstack/host/lib/motion-timing';
import { centeredReflow } from '@cardstack/host/lib/motion-transform';

export default class StackReflow extends StepComponent<{
  duration: number;
  primaryId?: string;
}> {
  node(): TimelineNode {
    return {
      kind: 'tween',
      of: this.args.primaryId
        ? { type: 'kept', id: this.args.primaryId }
        : [
            { type: 'kept', role: 'opening-card' },
            { type: 'kept', role: 'stack-card' },
            { type: 'kept', role: 'dock-card' },
          ],
      props: { transform: centeredReflow },
      ms: this.args.duration * 1000,
      ease: motionEase,
    };
  }
}
