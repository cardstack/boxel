import { animate } from 'motion';

/** Real control actions, scheduled against the tour clock; no demo screenshots. */
export interface TourAction {
  at: number;
  index?: number;
  kind?:
    'click' | 'down' | 'up' | 'range' | 'scroll' | 'pointer' | 'move' | 'shot';
  selector: string;
  value?: number;
}
const click = (at: number, selector: string, index = 0): TourAction => ({
  at,
  selector,
  index,
});
const range = (at: number, value: number): TourAction => ({
  at,
  selector: 'input[type=range]',
  kind: 'range',
  value,
});
const scroll = (at: number, selector: string, value: number): TourAction => ({
  at,
  selector,
  kind: 'scroll',
  value,
});
export const tourActions: Record<string, TourAction[]> = {
  gestures: [
    { at: 1, selector: '.press', kind: 'down' },
    { at: 2.2, selector: '.press', kind: 'up' },
    { at: 3, selector: '.press', kind: 'down' },
    { at: 3.6, selector: '.press', kind: 'up' },
  ],
  enter: [click(0.8, '.replay')],
  presence: [click(1, '.replay'), click(3, '.replay')],
  keyframes: [],
  'circle-loop': [], // The complete cycle plays automatically on activation.
  path: [click(0.8, '.replay')],
  pointer: [
    { at: 1, selector: '.follow-stage', kind: 'pointer', value: 0.2 },
    { at: 2, selector: '.follow-stage', kind: 'pointer', value: 0.8 },
    { at: 3, selector: '.follow-stage', kind: 'pointer', value: 0.4 },
  ],
  stagger: [click(0.8, '.replay')],
  trail: [click(1, 'button'), click(2.5, 'button'), click(4, '.trail button')],
  tabs: [click(1, '.tab', 0), click(2.5, '.tab', 2), click(4, '.tab', 1)],
  layout: [click(1, '.replay'), click(3, '.replay')],
  lists: [
    click(1, '.list-name:not(.is-bench)'),
    click(3, '.list-name.is-bench'),
  ],
  reorder: [click(1, '[data-tour-reorder]'), click(3, '[data-tour-reorder]')],
  grid: [click(1, '[data-tour-reorder]'), click(3, '[data-tour-reorder]')],
  'inline-edit': [
    click(1, '[data-test-toggle]'),
    click(4, '[data-test-toggle]'),
  ],
  lightbox: [click(1, '.shot'), click(4, '[aria-label="Close"]')],
  split: [click(1, '.replay'), click(3.5, '.replay')],
  inbox: [
    click(1, '.inbox-compose'),
    click(3, '.mail-kill'),
    click(5, '.inbox-compose'),
  ],
  far: [click(1, '.replay'), click(4, '.replay')],
  crossing: [
    click(1, '.xstress-hud button', 1),
    click(3, '.xstress-hud button', 1),
  ],
  escort: [click(1, '[data-test-bay="2"]'), click(4, '[data-test-bay="0"]')],
  interrupt: [
    click(1, '.slot', 3),
    click(1.22, '.slot', 0),
    click(2, '.slot', 2),
    click(2.2, '.slot', 1),
    click(3, '.slot', 3),
  ],
  sequence: [
    click(1, '.study-card', 0),
    click(3, '.study-card', 1),
    click(5, '.study-card', 2),
  ],
  wires: [
    click(1, '[data-test-wires-v]', 1),
    click(4, '[data-test-wires-v]', 2),
  ],
  jump: [click(1, '.jump-go'), click(3, '.jump-go')],
  parallax: [scroll(1, '.scroll-well', 0.3), scroll(2.5, '.scroll-well', 0.7)],
  reveal: [click(1, '.replay'), scroll(2, '.pours', 0.7)],
  drift: [click(1, '.drift-race')],
  hang: [
    { at: 1, selector: '.hang-lane', kind: 'shot' },
    { at: 3, selector: '.hang-lane', kind: 'shot' },
  ],
  header: [scroll(1, '.chat-scroll', 0.7), scroll(3, '.chat-scroll', 0.2)],
  fold: [range(1, 0.2), range(3, 0.65), range(5, 0.35), range(6.5, 0.9)],
  sheet: [click(1, '.sheet-grab'), click(3, '.sheet-grab')],
  mockup: [
    click(1, '.mg-icon'),
    click(4, '[aria-label^="Close "]'),
    click(5.5, '.mg-icon', 1),
  ],
  camera: [
    click(1, '.cam-frame', 1),
    click(4, '[aria-label="Love this one"]'),
    click(5, '.cam-frame', 3),
  ],
  'long-take': [click(1, '.lt-seg button', 1)],
  sylva: [
    click(1, '[aria-label="Tour the living world"]'),
    click(4, '.sy-play'),
  ],
  subdivision: [
    click(1, '[data-test-tile]', 1),
    click(4, '[data-test-tile]', 3),
  ],
  rack: [
    click(1, '[data-notch="1"]'),
    click(3, '[data-notch="3"]'),
    click(5, '[data-notch="0"]'),
  ],
  grip: [
    click(1, '.tp-edit'),
    click(3, '.tp-pills button'),
    click(5, '.tp-edit'),
  ],
  drag: [click(1, 'button')],
  slides: [click(1, '.slides-next'), click(3, '.slides-next')],
  presentation: [
    click(1, '[data-test-pres-fwd]'),
    click(2.5, '[data-test-pres-fwd]'),
    click(4, '[data-test-pres-fwd]'),
    click(5.5, '[data-test-pres-fwd]'),
  ],
  towers: [click(0.8, '.ft-play'), click(2, '.cf-go.is-quiet')],
  sagrada: [click(0.8, '.ft-play'), click(2, '.cf-go.is-quiet')],
  playhead: [range(1, 0.15), range(3, 0.7), range(5, 0.35), range(7, 0.95)],
  'build-order': [range(1, 0), click(1.5, '[aria-label="Play"]'), range(7, 1)],
};
function find(doc: Document | HTMLElement, selector: string): HTMLElement[] {
  const own = [...doc.querySelectorAll<HTMLElement>(selector)];
  for (const frame of doc.querySelectorAll('iframe')) {
    try {
      if (frame.contentDocument) {
        own.push(...find(frame.contentDocument, selector));
      }
    } catch {
      /* Cross-origin content is not operated. */
    }
  }
  return own;
}
/** Returns cancellation. All synthetic actions cease on a real visitor gesture. */
export function guideDemo(
  id: string,
  getFrame: () => HTMLElement | null,
  clock: () => number,
  takeover: () => void
) {
  const pending = [...(tourActions[id] ?? [])];
  let raf = 0,
    stopped = false,
    doc: Document | HTMLElement | undefined,
    marker: HTMLDivElement | undefined,
    pressed: HTMLElement | undefined;
  let travel: ReturnType<typeof animate> | undefined;
  let fade: ReturnType<typeof animate> | undefined;
  let tap: ReturnType<typeof animate> | undefined;
  let aiming: TourAction | undefined;
  let arrived = false;
  const listened = new Set<Document | HTMLElement>();
  const onInput = (e: Event) => {
    if (e.isTrusted) {
      takeover();
    }
  };
  const clear = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    if (pressed) {
      const win = pressed.ownerDocument.defaultView as unknown as typeof window;
      pressed.dispatchEvent(
        new win.PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        })
      );
    }
    travel?.stop();
    fade?.stop();
    tap?.stop();
    marker?.remove();
    for (const root of listened) {
      root.removeEventListener('pointerdown', onInput, true);
    }
  };
  const tick = () => {
    if (stopped) {
      return;
    }
    const frame = getFrame();
    const current =
      frame?.tagName === 'IFRAME'
        ? (frame as HTMLIFrameElement).contentDocument
        : frame;
    if (
      current &&
      (doc ||
        ('body' in current
          ? current.querySelector('[data-test-widget-embed]')
          : current.hasAttribute('data-live-demo')))
    ) {
      if (doc !== current) {
        doc = current;
        doc.addEventListener('pointerdown', onInput, true);
        listened.add(doc);
      }
      const time = clock();
      for (const action of [...pending]) {
        if (action !== pending[0] || time < action.at - 0.55) {
          continue;
        }
        const target = find(current, action.selector).filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })[action.index ?? 0];
        if (!target) {
          continue;
        }
        const win = target.ownerDocument.defaultView!;
        let rect = target.getBoundingClientRect();
        // Short screens show a viewport onto the full-size demo canvas.
        // Bring the next real control into that viewport before approaching it.
        if (current instanceof HTMLElement && current.contains(target)) {
          const viewport = current.getBoundingClientRect();
          if (rect.bottom > viewport.bottom - 16) {
            current.scrollTop += rect.bottom - viewport.bottom + 16;
          } else if (rect.top < viewport.top + 16) {
            current.scrollTop -= viewport.top + 16 - rect.top;
          }
          rect = target.getBoundingClientRect();
        }
        if (!rect.width || !rect.height) {
          continue;
        }
        const reduced = win.matchMedia(
          '(prefers-reduced-motion: reduce)'
        ).matches;
        const fraction =
          action.kind === 'range' || action.kind === 'pointer'
            ? (action.value ?? 0.5)
            : 0.5;
        const x =
          rect.left +
          rect.width * fraction +
          (action.kind === 'move' ? (action.value ?? 0) : 0);
        const y = rect.top + rect.height * 0.5;
        if (!marker || marker.ownerDocument !== target.ownerDocument) {
          travel?.stop();
          fade?.stop();
          tap?.stop();
          marker?.remove();
          aiming = undefined;
          marker = target.ownerDocument.createElement('div');
          marker.setAttribute('aria-hidden', 'true');
          marker.dataset.tourCursor = '';
          marker.style.cssText =
            'position:fixed;left:0;top:0;width:38px;height:46px;opacity:0;pointer-events:none;z-index:2147483647;transform-origin:0 0;filter:drop-shadow(0 3px 4px #0008);';
          // The SVG tip is the hot spot, so presses stay anchored to the control.
          marker.innerHTML =
            '<svg viewBox="0 0 38 46" width="38" height="46" style="overflow:visible"><path d="M0 0 L3 32 L11 24 L19 40 L26 36 L18 21 L30 20 Z" fill="white" stroke="#191919" stroke-width="2" stroke-linejoin="round"/><circle data-click-ring cx="0" cy="0" r="15" fill="none" stroke="#ff6a3a" stroke-width="2" opacity="0"/></svg>';
          target.ownerDocument.body.append(marker);
          if (!listened.has(target.ownerDocument)) {
            target.ownerDocument.addEventListener('pointerdown', onInput, true);
            listened.add(target.ownerDocument);
          }
          marker.style.transform = `translateX(${reduced ? x : x + 34}px) translateY(${reduced ? y : y + 65}px)`;
        }
        if (aiming !== action) {
          aiming = action;
          arrived = false;
          fade?.stop();
          travel?.stop();
          marker.dataset.phase = 'moving';
          travel = animate(
            marker,
            { x, y, opacity: 1 },
            {
              duration: reduced
                ? 0
                : Math.min(0.5, Math.max(0.14, action.at - time)),
              ease: [0.22, 0.7, 0.2, 1],
              onComplete: () => {
                arrived = true;
              },
            }
          );
        }
        if (!arrived || time < action.at) {
          continue;
        }
        marker.dataset.phase = 'press';
        tap?.stop();
        tap = animate(
          marker,
          {
            scale:
              reduced ||
              ['pointer', 'move', 'scroll'].includes(action.kind ?? '')
                ? 1
                : action.kind === 'down'
                  ? 0.84
                  : action.kind === 'up'
                    ? [0.84, 1]
                    : [1, 0.84, 1],
          },
          {
            duration: reduced ? 0 : action.kind === 'down' ? 0.09 : 0.28,
            times: action.kind === 'up' ? [0, 1] : [0, 0.3, 1],
          }
        );
        const ring = marker.querySelector('[data-click-ring]')!;
        if (!['pointer', 'move', 'scroll'].includes(action.kind ?? 'click')) {
          animate(
            ring,
            { opacity: [0, 0.8, 0], scale: reduced ? 1 : [0.6, 1.4] },
            { duration: 0.38 }
          );
        }
        const pointer = (type: string) =>
          target.dispatchEvent(
            new (win as unknown as typeof window).PointerEvent(type, {
              bubbles: true,
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true,
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
              clientX: x,
              clientY: y,
            })
          );
        if (action.kind === 'shot') {
          (
            target as HTMLElement & { playDemoShot?: () => void }
          ).playDemoShot?.();
        } else if (action.kind === 'range') {
          const input = target as HTMLInputElement;
          pointer('pointerdown');
          input.value = String(
            Number(input.min) +
              (Number(input.max) - Number(input.min)) * (action.value ?? 0)
          );
          input.dispatchEvent(
            new (win as unknown as typeof window).Event('input', {
              bubbles: true,
            })
          );
          pointer('pointerup');
        } else if (action.kind === 'scroll') {
          target.scrollTop =
            (target.scrollHeight - target.clientHeight) * (action.value ?? 0);
        } else if (action.kind === 'down') {
          pressed = target;
          pointer('pointerdown');
        } else if (action.kind === 'up') {
          pointer('pointerup');
          pressed = undefined;
        } else if (action.kind === 'pointer' || action.kind === 'move') {
          pointer('pointermove');
        } else {
          target.click();
        }
        pending.splice(pending.indexOf(action), 1);
        aiming = undefined;
        // Retire out of the way during explanation; the next approach cancels this fade.
        if (!pressed && (!pending[0] || pending[0].at - time > 0.8)) {
          fade = animate(
            marker,
            { opacity: 0, x: reduced ? x : x + 18, y: reduced ? y : y + 22 },
            {
              delay: 0.4,
              duration: 0.45,
              ease: 'easeInOut',
              onComplete: () => {
                if (marker) {
                  marker.dataset.phase = 'rest';
                }
              },
            }
          );
        }
        frame!.dataset.tourActions = String(
          Number(frame!.dataset.tourActions ?? 0) + 1
        );
        frame!.dataset.tourLastAction = action.selector;
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return clear;
}
