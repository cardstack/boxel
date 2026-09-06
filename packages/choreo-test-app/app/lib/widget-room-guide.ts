import { motionValue, styleEffect } from 'motion-dom';

export interface RoomAction {
  at: number;
  demo: string;
  index?: number;
  kind?: string;
  selector: string;
  value?: number;
}
/** One screen-space hand follows projected, moving DOM controls across the room. */
export function roomGuide(
  room: HTMLElement,
  actions: RoomAction[],
  clock: () => number,
  takeover: () => void,
  playing: () => boolean = () => true
) {
  const cursor = document.createElement('div');
  cursor.dataset.roomCursor = '';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.style.cssText =
    'position:fixed;inset:0 auto auto 0;width:32px;height:40px;pointer-events:none;z-index:2147483647;transform-origin:0 0;filter:drop-shadow(0 3px 4px #0008)';
  cursor.innerHTML =
    '<svg viewBox="0 0 38 46" width="32" height="40" style="overflow:visible"><circle data-room-ring cx="0" cy="0" r="14" fill="none" stroke="#ff6a3a" stroke-width="2" opacity="0"/><path d="M0 0 L3 32 L11 24 L19 40 L26 36 L18 21 L30 20 Z" fill="white" stroke="#191919" stroke-width="2" stroke-linejoin="round"/></svg>';
  document.body.append(cursor);
  const x = motionValue(innerWidth * 0.6),
    y = motionValue(innerHeight * 0.7),
    opacity = motionValue(0),
    scale = motionValue(1);
  const unbind = styleEffect(cursor, { x, y, opacity, scale });
  const ring = cursor.querySelector('[data-room-ring]') as SVGElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0,
    raf = 0,
    aiming = -1,
    began = 0,
    fromX = x.get(),
    fromY = y.get(),
    fired = -10;
  let lastTarget: HTMLElement | null = null;
  const input = (event: Event) => {
    if (event.isTrusted) {
      takeover();
    }
  };
  room.addEventListener('pointerdown', input, true);
  room.dataset.quickActions = '0';
  room.dataset.quickMissed = '';
  const tick = () => {
    if (!playing()) {
      raf = requestAnimationFrame(tick);
      return;
    }
    const time = clock(),
      action = actions[index];
    const since = time - fired;
    scale.jump(
      reduced
        ? 1
        : since < 0.08
          ? 1 - (Math.max(0, since) / 0.08) * 0.18
          : since < 0.24
            ? 0.82 + ((since - 0.08) / 0.16) * 0.18
            : 1
    );
    ring.style.opacity = String(
      since >= 0 && since < 0.32 ? 0.8 * (1 - since / 0.32) : 0
    );
    if (action && time >= action.at - 0.65) {
      const tile = room.querySelector(`[data-live-demo="${action.demo}"]`);
      const target = tile?.querySelectorAll<HTMLElement>(action.selector)[
        action.index ?? 0
      ];
      const rect = target?.getBoundingClientRect();
      if (target && rect && rect.width > 0 && rect.height > 0) {
        const endX =
          rect.left +
          rect.width * (action.kind === 'range' ? (action.value ?? 0.5) : 0.5);
        const endY = rect.top + rect.height / 2;
        if (aiming !== index) {
          aiming = index;
          began = time;
          fromX = x.get();
          fromY = y.get();
          cursor.dataset.demo = action.demo;
        }
        const progress = Math.min(
          1,
          Math.max(0, (time - began) / Math.max(0.12, action.at - began))
        );
        const eased = reduced ? 1 : 1 - (1 - progress) ** 3;
        x.jump(fromX + (endX - fromX) * eased);
        y.jump(
          fromY +
            (endY - fromY) * eased -
            (reduced ? 0 : Math.sin(progress * Math.PI) * 14)
        );
        opacity.jump(Math.min(1, 0.4 + progress));
        const onScreen =
          endX > 8 &&
          endX < innerWidth - 8 &&
          endY > 80 &&
          endY < innerHeight - 175;
        const frame = tile?.closest<HTMLElement>('[data-widget-id]');
        const ready = !frame || frame.dataset.widgetReady === 'true';
        if (time >= action.at && progress === 1 && onScreen && ready) {
          if (action.kind === 'range') {
            const input = target as HTMLInputElement;
            input.value = String(
              Number(input.min) +
                (Number(input.max) - Number(input.min)) * (action.value ?? 0)
            );
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (action.kind === 'shot') {
            (
              target as HTMLElement & { playDemoShot?: () => void }
            ).playDemoShot?.();
          } else {
            target.click();
          }
          fired = time;
          lastTarget = target;
          index++;
          room.dataset.quickActions = String(
            Number(room.dataset.quickActions) + 1
          );
          room.dataset.quickLastDemo = action.demo;
        }
      }
      if (action === actions[index] && time > action.at + 1.5) {
        room.dataset.quickMissed += `${action.demo}:${action.selector};`;
        index++;
      }
    } else if (lastTarget?.isConnected && since < 0.65) {
      const rect = lastTarget.getBoundingClientRect();
      x.jump(
        rect.left +
          rect.width / 2 +
          (reduced ? 0 : Math.min(1, since / 0.65) * 16)
      );
      y.jump(
        rect.top +
          rect.height / 2 +
          (reduced ? 0 : Math.min(1, since / 0.65) * 14)
      );
    } else {
      opacity.jump(Math.max(0, 0.8 - Math.max(0, since - 0.65) * 0.8));
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    room.removeEventListener('pointerdown', input, true);
    unbind();
    cursor.remove();
    for (const value of [x, y, opacity, scale]) {
      value.destroy();
    }
  };
}
