import { modifier } from 'ember-modifier';

export type RoomControl = 'rotate' | 'pan' | 'zoom';
type Nudge = (kind: RoomControl, x: number, y: number, dt: number) => void;

/** Mockup's rate-based thumbsticks: progressive resistance and spring return. */
export const roomThumbstick = modifier(
  (el: HTMLElement, [kind, begin, nudge]: [RoomControl, () => void, Nudge]) => {
    let pointer: number | undefined;
    let raf = 0;
    let last = 0;
    let held = false;
    const want = { x: 0, y: 0 };
    const knob = { x: 0, y: 0, vx: 0, vy: 0 };
    const keys = new Set<string>();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const tick = (now: number) => {
      const dt = Math.min(0.032, last ? (now - last) / 1000 : 0.016);
      last = now;
      const k = held ? 340 : 150;
      const c = held ? 26 : 15;
      for (const axis of ['x', 'y'] as const) {
        const v = axis === 'x' ? 'vx' : 'vy';
        const target = held ? want[axis] : 0;
        if (reduced.matches) {
          knob[axis] = target;
          knob[v] = 0;
        } else {
          knob[v] += (k * (target - knob[axis]) - c * knob[v]) * dt;
          knob[axis] += knob[v] * dt;
        }
      }
      el.style.setProperty('--knob-x', String(knob.x));
      el.style.setProperty('--knob-y', String(knob.y));
      // Return animates the control only: releasing never drifts the viewer.
      if (held) {
        nudge(kind, knob.x, knob.y, dt);
      }
      if (held || Math.hypot(knob.x, knob.y, knob.vx, knob.vy) > 0.01) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
        last = 0;
      }
    };
    const spin = () => {
      if (!raf) {
        raf = requestAnimationFrame(tick);
      }
    };
    const read = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      const resist = (t: number) =>
        Math.sign(t) * Math.min(1, Math.abs(t)) ** 1.7;
      want.x = resist((e.clientX - b.left - b.width / 2) / (b.width / 2));
      want.y = resist((e.clientY - b.top - b.height / 2) / (b.height / 2));
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || pointer !== undefined) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      begin();
      el.focus({ preventScroll: true });
      pointer = e.pointerId;
      held = true;
      el.setPointerCapture(pointer);
      read(e);
      spin();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId === pointer) {
        read(e);
      }
    };
    const release = () => {
      held = false;
      keys.clear();
      if (pointer !== undefined && el.hasPointerCapture(pointer)) {
        el.releasePointerCapture(pointer);
      }
      pointer = undefined;
      want.x = want.y = 0;
    };
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    const key = (e: KeyboardEvent) => {
      if (!arrows.includes(e.key)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (!held) {
        begin();
      }
      keys.add(e.key);
      held = true;
      want.x = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
      want.y = Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'));
      spin();
    };
    const keyUp = (e: KeyboardEvent) => {
      if (!arrows.includes(e.key)) {
        return;
      }
      e.stopPropagation();
      keys.delete(e.key);
      want.x = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
      want.y = Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'));
      held = keys.size > 0;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    el.addEventListener('keydown', key);
    el.addEventListener('keyup', keyUp);
    el.addEventListener('blur', release);
    window.addEventListener('blur', release);
    return () => {
      release();
      cancelAnimationFrame(raf);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', release);
      el.removeEventListener('pointercancel', release);
      el.removeEventListener('lostpointercapture', release);
      el.removeEventListener('keydown', key);
      el.removeEventListener('keyup', keyUp);
      el.removeEventListener('blur', release);
      window.removeEventListener('blur', release);
    };
  }
);
