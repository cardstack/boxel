import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { motion } from 'glimmer-motion';
import { animate } from 'motion';
import { motionValue } from 'motion-dom';
import { preventSelect } from 'test-app/lib/pointer';

const tight = { damping: 24, stiffness: 480, type: 'spring' } as const;
const mid = { damping: 22, stiffness: 240, type: 'spring' } as const;
const loose = { damping: 20, stiffness: 120, type: 'spring' } as const;

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
    void animate(this.x, x, tight);
    void animate(this.y, y, tight);
    void animate(this.rx, x, mid);
    void animate(this.ry, y, mid);
    void animate(this.hx, x, loose);
    void animate(this.hy, y, loose);
  };

  move = (event: PointerEvent) => {
    this.aim(event, event.currentTarget as HTMLElement);
  };

  leave = (event: PointerEvent) => {
    const stage = event.currentTarget as HTMLElement;
    const next = event.relatedTarget;
    if (next instanceof Node && stage.contains(next)) {
      return;
    }
    this.aim(event, stage);
  };

  <template>
    <div
      class="ex follow-stage no-select"
      {{on "pointermove" this.move}}
      {{on "pointerleave" this.leave}}
      {{on "selectstart" preventSelect}}
    >
      <div class="follow-halo" {{motion style=this.halo}}></div>
      <div class="follow-ring" {{motion style=this.ring}}></div>
      <div class="follow-orb" {{motion style=this.cursor}}></div>
      <span class="follow-hint">move</span>
    </div>
  </template>
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
