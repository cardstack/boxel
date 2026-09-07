import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { motion } from 'glimmer-motion';
import { animate } from 'motion';
import { motionValue } from 'motion-dom';
import { tuneMotion } from 'test-app/lib/demo-tuning';
import { preventSelect } from 'test-app/lib/pointer';

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
      box.width / 2
    );
    const y = clamp(
      event.clientY - box.top - box.height / 2,
      box.height / -2,
      box.height / 2
    );
    void animate(this.x, x, tuneMotion('pointer', tight, 'Pointer spring'));
    void animate(this.y, y, tuneMotion('pointer', tight, 'Pointer spring'));
    void animate(this.rx, x, tuneMotion('pointer', mid, 'Ring spring'));
    void animate(this.ry, y, tuneMotion('pointer', mid, 'Ring spring'));
    void animate(this.hx, x, tuneMotion('pointer', loose, 'Halo spring'));
    void animate(this.hy, y, tuneMotion('pointer', loose, 'Halo spring'));
  };

  move = (event: PointerEvent) => {
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
        'Ring return spring'
      )
    );
    void animate(
      this.ry,
      0,
      tuneMotion(
        'pointer',
        { ...homing, visualDuration: 0.72 },
        'Ring return spring'
      )
    );
    void animate(
      this.hx,
      0,
      tuneMotion(
        'pointer',
        { ...homing, visualDuration: 0.84 },
        'Halo return spring'
      )
    );
    void animate(
      this.hy,
      0,
      tuneMotion(
        'pointer',
        { ...homing, visualDuration: 0.84 },
        'Halo return spring'
      )
    );
  };

  leave = (event: PointerEvent) => {
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
      class="ex follow-stage no-select"
      {{on "pointermove" this.move}}
      {{on "pointerleave" this.leave}}
      {{on "pointerup" this.lift}}
      {{on "pointercancel" this.lift}}
      {{on "selectstart" preventSelect}}
    >
      <div
        class="follow-halo"
        {{motion
          style=this.halo
          transition=(tuneMotion "pointer" loose "Halo spring")
        }}
      ></div>
      <div
        class="follow-ring"
        {{motion
          style=this.ring
          transition=(tuneMotion "pointer" mid "Ring spring")
        }}
      ></div>
      <div
        class="follow-orb"
        {{motion
          style=this.cursor
          transition=(tuneMotion "pointer" tight "Pointer spring")
        }}
      ></div>
      <span class="follow-hint">move</span>
    </div>
  </template>
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Declare the demo variables before the first interactive Choreo pass.
tuneMotion('pointer', loose, 'Halo spring');
tuneMotion('pointer', mid, 'Ring spring');
tuneMotion('pointer', tight, 'Pointer spring');
