import type { TOC } from '@ember/component/template-only';

import { type MotionHold, wakeOnTouch } from '../lib/motion-hold';
import { restWhenOff } from '../lib/onstage';

interface Signature {
  Args: {
    /** the hold the stage waits under: see `lib/motion-hold.ts` */
    hold: MotionHold;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

/**
 * The box a live stage runs in, wherever the gallery shows one: a tile, an
 * embedded demo, a demo's page. It wears its hold, wakes it when the viewer
 * reaches in, and rests while it is off. The box's size, ground and the rest
 * of its behaviour are the caller's.
 */
export const HeldStage: TOC<Signature> = <template>
  <div
    class='held-stage'
    data-motion-hold={{@hold.state}}
    {{restWhenOff}}
    {{wakeOnTouch @hold}}
    ...attributes
  >
    {{yield}}
  </div>
  <style scoped>
    /* a stage nobody can see, or one waiting to be asked to move, holds its
       animations where they stand — paused, so coming back does not restart
       every loop */
    .held-stage.is-resting,
    .held-stage.is-resting :deep(*) {
      animation-play-state: paused !important;
    }
  </style>
</template>;
