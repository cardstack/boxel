import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { Choreo, motion } from 'glimmer-motion';

/**
 * SPIKE — a phone as a plane in perspective, and one icon⇄app transition
 * inside it. Delete-able: this route is hidden and nothing imports it.
 *
 * The question: FLIP measures `getBoundingClientRect()`, which for an
 * element under a 3D-rotated ancestor is the PROJECTED axis-aligned box,
 * not the layout box. A `c.Move` inside a tilted plane therefore starts
 * from a pose that is wrong by however much the projection differs from
 * the layout. This page exists to find out how wrong, and whether the
 * region survives `preserve-3d` at all.
 */
/**
 * `generic-phone`, copied from mockup-studio's device catalog
 * (src/lib/device-catalog.ts) — real millimetres, so the silhouette,
 * bezel ratio and corner radius are the ones its 3D viewport uses.
 * mockup-studio ships GLB models too, but those are three.js meshes; the
 * numbers are the part a DOM plane can actually take.
 */
const DEVICE = {
  bezelBottom: 3.0,
  bezelSide: 2.0,
  bezelTop: 3.0,
  cornerRadius: 10,
  height: 150.0,
  screenHeight: 144.0,
  screenWidth: 68.0,
  thickness: 8.0,
  width: 72.0,
};
/** px per mm */
const MM = 3.6;
const PX = {
  depth: DEVICE.thickness * MM,
  h: DEVICE.height * MM,
  radius: DEVICE.cornerRadius * MM,
  screenH: DEVICE.screenHeight * MM,
  screenRadius: (DEVICE.cornerRadius - DEVICE.bezelSide) * MM,
  screenW: DEVICE.screenWidth * MM,
  side: ((DEVICE.width - DEVICE.screenWidth) / 2) * MM,
  top: DEVICE.bezelTop * MM,
  w: DEVICE.width * MM,
};
/** the extrusion: slices from the back face forward to the front */
const SLICES = Array.from({ length: 10 }, (_, i) => ({
  z: -PX.depth + (i * PX.depth) / 9,
}));

const APPS = [
  { hue: 8, id: 'mail', label: 'Mail' },
  { hue: 140, id: 'notes', label: 'Notes' },
  { hue: 210, id: 'maps', label: 'Maps' },
  { hue: 275, id: 'music', label: 'Music' },
  { hue: 32, id: 'photos', label: 'Photos' },
  { hue: 190, id: 'clock', label: 'Clock' },
];

type App = (typeof APPS)[number];

/** the device's real geometry, handed to CSS once */
const DEVICE_VARS = htmlSafe(
  `--w:${PX.w}px;--h:${PX.h}px;--r:${PX.radius}px;--d:${PX.depth}px;` +
    `--sw:${PX.screenW}px;--sh:${PX.screenH}px;--sr:${PX.screenRadius}px;` +
    `--sx:${PX.side}px;--sy:${PX.top}px`
);

const MAPS = APPS[2]!;
const PHOTOS = APPS[4]!;

const settle = { damping: 26, stiffness: 260 } as const;

interface SpikeWindow extends Window {
  __spike?: unknown;
}

export class MockupSpike extends Component {
  @tracked rx = 0;
  @tracked ry = 0;
  @tracked open: App | null = null;
  /** SPIKE 2 — mockup-studio's spotlight + blur layers, as DOM */
  @tracked focus: App | null = null;
  private root?: HTMLElement;

  get phoneStyle(): string {
    return `transform: rotateX(${this.rx}deg) rotateY(${this.ry}deg)`;
  }

  choose = (app: App) => {
    this.open = app;
  };

  close = () => {
    this.open = null;
  };

  spot = (app: App | null) => {
    this.focus = app;
  };

  /**
   * The scrim's hole, in the SCREEN's own percentage coordinates — read
   * from offset metrics, which is the whole point: layout space is
   * immune to the plane's rotation, so a spotlight aimed at an icon
   * stays on that icon at any tilt.
   */
  get focusStyle(): string {
    if (!this.focus) {
      return '--dim:0;--blur:0px;--r:200px';
    }
    const el = this.root?.querySelector(
      `[data-sprite="${this.focus.id}"]`
    ) as HTMLElement | null;
    const screen = this.root?.querySelector('.ms-screen') as HTMLElement | null;
    if (!el || !screen) {
      return '--dim:0;--blur:0px;--r:200px';
    }
    const cx =
      ((el.offsetLeft + el.offsetWidth / 2) / screen.offsetWidth) * 100;
    const cy =
      ((el.offsetTop + el.offsetHeight / 2) / screen.offsetHeight) * 100;
    return `--dim:0.72;--blur:7px;--r:52px;--fx:${cx.toFixed(2)}%;--fy:${cy.toFixed(2)}%`;
  }

  tilt = (axis: 'rx' | 'ry', event: Event) => {
    const value = Number((event.target as HTMLInputElement).value);
    if (axis === 'rx') {
      this.rx = value;
    } else {
      this.ry = value;
    }
  };

  register = modifier((el: HTMLElement) => {
    this.root = el;
    (window as SpikeWindow).__spike = {
      /** the box the engine WOULD measure for a sprite, right now */
      box: (id: string) =>
        this.root
          ?.querySelector(`[data-sprite="${id}"]`)
          ?.getBoundingClientRect()
          .toJSON(),
      /** every ancestor's flattening-relevant computed style */
      chain: () => {
        const out: Record<string, string>[] = [];
        let el: Element | null = this.root!.querySelector('[data-sprite]');
        while (el && el !== document.documentElement) {
          const cs = getComputedStyle(el);
          out.push({
            contain: cs.contain,
            filter: cs.filter,
            name: `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`,
            overflow: cs.overflow,
            perspective: cs.perspective,
            transform: cs.transform,
            transformStyle: cs.transformStyle,
          });
          el = el.parentElement;
        }
        return out;
      },
      close: () => {
        this.open = null;
      },
      open: (id: string) => {
        this.open = APPS.find((a) => a.id === id) ?? null;
      },
      tilt: (rx: number, ry: number) => {
        this.rx = rx;
        this.ry = ry;
      },
    };
    return () => {
      delete (window as SpikeWindow).__spike;
      this.root = undefined;
    };
  });

  <template>
    <div class="ms-page" {{this.register}}>
      <div class="ms-stage" style={{DEVICE_VARS}}>
        <div class="ms-phone" style={{this.phoneStyle}}>
          {{#each SLICES as |slice|}}
            <div
              class="ms-slice"
              style="transform: translateZ({{slice.z}}px)"
            ></div>
          {{/each}}
          <div class="ms-body">
            <Choreo class="ms-screen" as |c|>
              {{#if this.open}}
                <button
                  type="button"
                  class="ms-app"
                  data-sprite={{this.open.id}}
                  style="--hue:{{this.open.hue}}"
                  {{on "click" this.close}}
                  {{motion id=this.open.id role="tile"}}
                >
                  <span class="ms-app-name">{{this.open.label}}</span>
                </button>
              {{else}}
                <div class="ms-grid">
                  {{#each APPS as |app|}}
                    <button
                      type="button"
                      class="ms-icon"
                      data-sprite={{app.id}}
                      style="--hue:{{app.hue}}"
                      {{on "click" (fn this.choose app)}}
                      {{motion id=app.id role="tile"}}
                    >
                      <span class="ms-icon-name">{{app.label}}</span>
                    </button>
                  {{/each}}
                </div>
              {{/if}}
              <c.Move @of={{c.moved "tile"}} @spring={{settle}} />
            </Choreo>
            <div class="ms-scrim" style={{this.focusStyle}}></div>
          </div>
        </div>
      </div>

      <div class="ms-controls">
        <button type="button" {{on "click" (fn this.spot null)}}>no focus</button>
        <button type="button" {{on "click" (fn this.spot MAPS)}}>focus Maps</button>
        <button type="button" {{on "click" (fn this.spot PHOTOS)}}>focus Photos</button>
        <label>rotateX
          <input
            type="range"
            min="-40"
            max="40"
            value={{this.rx}}
            {{on "input" (fn this.tilt "rx")}}
          />
          <output>{{this.rx}}°</output>
        </label>
        <label>rotateY
          <input
            type="range"
            min="-40"
            max="40"
            value={{this.ry}}
            {{on "input" (fn this.tilt "ry")}}
          />
          <output>{{this.ry}}°</output>
        </label>
      </div>

      <style>
        .ms-page {
          display: grid;
          gap: 24px;
          justify-items: center;
          padding: 40px;
          font:
            13px/1.4 ui-sans-serif,
            system-ui;
        }
        .ms-stage {
          perspective: 1400px;
          perspective-origin: 50% 45%;
        }
        .ms-phone {
          position: relative;
          width: var(--w);
          height: var(--h);
          border-radius: var(--r);
          transform-style: preserve-3d;
        }
        .ms-slice {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: linear-gradient(
            100deg,
            #3a3d46,
            #16171b 42%,
            #2b2e36 78%,
            #4a4e59
          );
        }
        .ms-body {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: #0b0c10;
          box-shadow:
            0 0 0 1.5px #565b68 inset,
            0 40px 70px -20px #0009;
        }
        .ms-screen {
          position: absolute;
          overflow: hidden;
          left: var(--sx);
          top: var(--sy);
          width: var(--sw);
          height: var(--sh);
          border-radius: var(--sr);
          background: #0d1220;
        }
        .ms-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px 14px;
          padding: 34px 18px;
        }
        .ms-icon {
          all: unset;
          cursor: pointer;
          display: grid;
          justify-items: center;
          gap: 6px;
        }
        .ms-icon::before {
          content: "";
          width: 54px;
          height: 54px;
          border-radius: 14px;
          background: linear-gradient(
            150deg,
            hsl(var(--hue) 78% 62%),
            hsl(var(--hue) 70% 42%)
          );
        }
        .ms-icon-name {
          color: #dfe4f2;
          font-size: 10px;
        }
        .ms-app {
          all: unset;
          cursor: pointer;
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          background: linear-gradient(
            150deg,
            hsl(var(--hue) 78% 62%),
            hsl(var(--hue) 70% 42%)
          );
        }
        .ms-app-name {
          color: #fff;
          font-size: 22px;
          font-weight: 600;
        }
        .ms-scrim {
          position: absolute;
          left: var(--sx);
          top: var(--sy);
          width: var(--sw);
          height: var(--sh);
          border-radius: var(--sr);
          pointer-events: none;
          overflow: hidden;
          background: rgba(4, 6, 14, var(--dim, 0));
          backdrop-filter: blur(var(--blur, 0px));
          -webkit-backdrop-filter: blur(var(--blur, 0px));
          --mask: radial-gradient(
            circle var(--r, 200px) at var(--fx, 50%) var(--fy, 50%),
            transparent 0%,
            transparent 62%,
            #000 100%
          );
          -webkit-mask-image: var(--mask);
          mask-image: var(--mask);
          transition:
            background 240ms linear,
            backdrop-filter 240ms linear;
        }
        .ms-controls {
          display: flex;
          gap: 24px;
          color: #99a;
          align-items: center;
        }
        .ms-controls button {
          font: inherit;
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid #bbb;
          background: #fff;
          cursor: pointer;
        }
        .ms-controls label {
          display: flex;
          gap: 8px;
          align-items: center;
        }
      </style>
    </div>
  </template>
}

export default MockupSpike;
