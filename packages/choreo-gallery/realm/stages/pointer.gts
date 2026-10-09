import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { animate, motion, motionValue } from 'glimmer-motion';

import { GalleryDemo } from '../demo';
import { preventSelect } from '../lib/pointer';
import { tuneMotion } from '../lib/tuning';

const tight = { damping: 24, stiffness: 480, type: 'spring' } as const;
const mid = { damping: 22, stiffness: 240, type: 'spring' } as const;
const loose = { damping: 20, stiffness: 120, type: 'spring' } as const;
/**
 * Letting go.
 *
 * The three springs above are all CHASING — they are tuned to keep up with a
 * pointer that is still moving. Coming home is the opposite gesture: nothing
 * is leading it any more, so it wants a lower stiffness and enough bounce to
 * read as elastic rather than as a slide back to zero. Slightly under-damped
 * on purpose — the overshoot is what makes it feel like a band letting go
 * instead of an animation ending.
 */
const homing = { bounce: 0.34, type: 'spring', visualDuration: 0.62 } as const;

export class FollowPointer extends Component {
  x = motionValue(0);
  y = motionValue(0);
  rx = motionValue(0);
  ry = motionValue(0);
  hx = motionValue(0);
  hy = motionValue(0);

  get cursor() {
    return { x: this.x, y: this.y };
  }

  get ring() {
    return { x: this.rx, y: this.ry };
  }

  get halo() {
    return { x: this.hx, y: this.hy };
  }

  aim = (event: PointerEvent, stage: HTMLElement) => {
    const box = stage.getBoundingClientRect();
    const x = clamp(
      event.clientX - box.left - box.width / 2,
      box.width / -2,
      box.width / 2,
    );
    const y = clamp(
      event.clientY - box.top - box.height / 2,
      box.height / -2,
      box.height / 2,
    );
    void animate(this.x, x, tuneMotion('pointer', tight, 'Pointer spring'));
    void animate(this.y, y, tuneMotion('pointer', tight, 'Pointer spring'));
    void animate(this.rx, x, tuneMotion('pointer', mid, 'Ring spring'));
    void animate(this.ry, y, tuneMotion('pointer', mid, 'Ring spring'));
    void animate(this.hx, x, tuneMotion('pointer', loose, 'Halo spring'));
    void animate(this.hy, y, tuneMotion('pointer', loose, 'Halo spring'));
  };

  move = (untyped: Event) => {
    // the realm's `{{on}}` types every listener's argument as a plain Event
    const event = untyped as PointerEvent;
    this.aim(event, event.currentTarget as HTMLElement);
  };

  /**
   * Back to the middle, elastically.
   *
   * It used to aim one last time at wherever the pointer left, which parked
   * the whole rig against the edge it exited through and left the demo
   * looking stuck. Nothing is following anything once the pointer is gone,
   * so the honest resting state is the centre — and the trailing ring and
   * halo keep their own slower springs, so the three arrive in sequence the
   * same way they do when chasing.
   */
  private release = () => {
    void animate(this.x, 0, tuneMotion('pointer', homing, 'Return spring'));
    void animate(this.y, 0, tuneMotion('pointer', homing, 'Return spring'));
    void animate(
      this.rx,
      0,
      tuneMotion(
        'pointer',
        { ...homing, visualDuration: 0.72 },
        'Ring return spring',
      ),
    );
    void animate(
      this.ry,
      0,
      tuneMotion(
        'pointer',
        { ...homing, visualDuration: 0.72 },
        'Ring return spring',
      ),
    );
    void animate(
      this.hx,
      0,
      tuneMotion(
        'pointer',
        { ...homing, visualDuration: 0.84 },
        'Halo return spring',
      ),
    );
    void animate(
      this.hy,
      0,
      tuneMotion(
        'pointer',
        { ...homing, visualDuration: 0.84 },
        'Halo return spring',
      ),
    );
  };

  leave = (untyped: Event) => {
    const event = untyped as PointerEvent;
    const stage = event.currentTarget as HTMLElement;
    const next = event.relatedTarget;
    if (next instanceof Node && stage.contains(next)) {
      return;
    }
    this.release();
  };

  /** a finger has no "leave": lifting it is the same event as going away */
  lift = () => {
    this.release();
  };

  <template>
    <div
      class='ex follow-stage no-select'
      {{on 'pointermove' this.move}}
      {{on 'pointerleave' this.leave}}
      {{on 'pointerup' this.lift}}
      {{on 'pointercancel' this.lift}}
      {{on 'selectstart' preventSelect}}
    >
      <div
        class='follow-halo'
        {{motion
          style=this.halo
          transition=(tuneMotion 'pointer' loose 'Halo spring')
        }}
      ></div>
      <div
        class='follow-ring'
        {{motion
          style=this.ring
          transition=(tuneMotion 'pointer' mid 'Ring spring')
        }}
      ></div>
      <div
        class='follow-orb'
        {{motion
          style=this.cursor
          transition=(tuneMotion 'pointer' tight 'Pointer spring')
        }}
      ></div>
      <span class='follow-hint'>move</span>
    </div>
    <style scoped>
      /* The orb is white, which is the right answer on a near-black stage and no
         answer at all on a cream one — a white dot on a light ground is a hole.
         In light it takes the mark's own bead colour, so the thing the pointer
         leaves behind is the same solid dot the logo ends on. */
      .choreo-site[data-theme='light'] .follow-orb {
        background: var(--ember);
      }

      .ex {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        width: 100%;
        max-width: 100%;
        /* every stage keeps air on all four sides. A demo that runs edge to edge
           reads as a layout bug rather than as a stage, and the ones sized
           `min(Npx, 100%)` hit the frame exactly when the card is narrow.
           The block padding was missing for a long time and it showed on any stage
           tall enough to fill the platter: the content sat flush against the top and
           bottom of the recess while keeping its 16px at the sides, which reads as
           content that has overflowed rather than content that has been placed. */
        padding-block: 10px;
        padding-inline: 16px;
        overflow: hidden;
        container-type: size;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }

      /* The stage is mostly empty air around one quiet dot, so in light mode
         it takes a little more presence than the default platter tint. Dark
         mode's plain platter is already fine. */
      .choreo-site[data-theme='light'] .ex {
        background:
          radial-gradient(
            80% 70% at 50% 40%,
            rgba(255, 59, 31, 0.16),
            transparent 60%
          ),
          rgba(var(--surface-tint-rgb), 0.14);
      }

      .no-select,
      .no-select * {
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
      }

      .follow-stage {
        cursor: none;
        /* the finger is the input here, so the gesture belongs to this stage and
           not to the scroller: without it the page scrolls out from under the
           pointer mid-track and the orb is left reading a stale position */
        touch-action: none;
      }

      .follow-halo {
        position: absolute;
        width: 120px;
        height: 120px;
        border-radius: 50%;
        background: radial-gradient(
          circle,
          rgba(255, 59, 31, 0.32),
          transparent 68%
        );
        pointer-events: none;
      }

      .follow-ring {
        position: absolute;
        width: 46px;
        height: 46px;
        border-radius: 50%;
        border: 1.5px solid rgba(255, 179, 106, 0.7);
        pointer-events: none;
      }

      /* the trailing ring is a pale peach drawn for the dark stage; on cream it
         all but disappears, so light deepens it to a copper the eye can find */
      .choreo-site[data-theme='light'] .follow-ring {
        border-color: rgba(178, 96, 28, 0.75);
      }

      .follow-orb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #fff;
        box-shadow:
          0 0 0 6px rgba(255, 59, 31, 0.22),
          0 0 28px var(--glow);
        pointer-events: none;
      }

      .follow-hint {
        position: absolute;
        bottom: 16px;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-faint);
        pointer-events: none;
      }
    </style>
  </template>
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('pointer', loose, 'Halo spring');
tuneMotion('pointer', mid, 'Ring spring');
tuneMotion('pointer', tight, 'Pointer spring');

export class FollowPointerDemo extends GalleryDemo {
  static stage = FollowPointer;
}
