// Pretui — ModelViewer: an orbitable 3D model on @google/model-viewer, poster first.
//
//   <ModelViewer @src={{glbUrl}} @alt='Crate, exploded' @poster={{png}} />
//
// `<model-viewer>` 4.3.1+12 (Apache-2.0, vendored at ./model-viewer — read
// that folder's NOTICE, not only its README: Apache-2.0 requires a statement
// of changes and this bundle is a modified distribution) does GLTF/GLB
// loading, an orbit camera, environment lighting, animation and AR.
//
// Four decisions worth stating:
//
//   1. **Nothing loads until someone asks.** `reveal='manual'` holds the
//      element at its poster; `dismissPoster()` runs on the caller's click or
//      Enter/Space. A 3D model is megabytes and a render loop — starting both
//      because a component happened to scroll into view is the spatial version
//      of autoplay, and the kit never autoplays. It also makes the
//      poster the reserved space instead of a flash of empty canvas.
//   2. **The orbit camera is keyboard-complete, and that is Pretui's work.**
//      model-viewer's own keyboard support is arrow keys on a focused
//      element with no announced position at all. Here the stage is a
//      `role='slider'` over the camera's AZIMUTH — the axis a person actually
//      thinks in — with ←/→ by step, Shift for a coarse step, PageUp/PageDown,
//      Home to face front, End to face back, ↑/↓ for elevation and +/− for
//      zoom, and an `aria-valuetext` that says "turned 45° right, 20° above,
//      105% zoom" rather than emitting a quaternion.
//   3. **The engine's own lifecycle is enough, and the listeners still are
//      not.** `disconnectedCallback` cancels model-viewer's rAF loop, so
//      Glimmer tearing the element down satisfies the rAF ruling. The `load`
//      and `error` listeners are OURS, so a modifier owns them and removes
//      them in its destructor.
//   4. **Failure is a state with a message and a link.** A GLB that will not
//      load is the normal case offline, behind auth, or on a machine with no
//      WebGL — so `phase` is public, the error names itself, and the file is
//      still offered as a link rather than leaving a grey box.
//
// BETTER THAN THE INSPIRATION: every 3D embed surveyed autoloads, reflows when
// the model arrives, and cannot be turned by keyboard at all.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { Token } from './token';
// Side-effect import: evaluating the bundle DEFINES <model-viewer>. It is
// DOM-free under plain Node because the bundle installs a temporary
// server-safe globals shim and REMOVES it again in the same module body —
// see ./model-viewer/README.md for why removal is the load-bearing half.
import '../model-viewer/index.js';
import { safeHref } from '../internal/media-viewer';

// ── The lifecycle contract ───────────────────────────────────────────────

/** Where a model is. `poster` is the resting state, not a loading state:
 * nothing has been fetched and nothing will be until someone asks. */
export type ModelPhase = 'poster' | 'loading' | 'ready' | 'error';

/** The camera, in the two angles and one distance a person reasons about. */
export interface OrbitState {
  /** Degrees around the model. 0 is front; positive turns right. */
  azimuth: number;
  /** Degrees above the horizon, clamped to ±89 so the camera never gimbals. */
  elevation: number;
  /** Fraction of the auto-framed distance. 1 is the framing model-viewer
   * picked; smaller is closer. */
  zoom: number;
}

const DEFAULT_ORBIT: OrbitState = { azimuth: 0, elevation: 12, zoom: 1 };

/** The slice of `<model-viewer>` this module uses. */
export interface ModelViewerElementLike extends HTMLElement {
  dismissPoster: () => void;
  cameraOrbit: string;
  loaded?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Normalise an azimuth to (-180, 180], so "turned 190° right" reads as
 * "turned 170° left" — which is what it looks like. */
export function wrapAzimuth(degrees: number): number {
  let value = degrees % 360;
  if (value > 180) {
    value = value - 360;
  }
  if (value <= -180) {
    value = value + 360;
  }
  return value;
}

/** "turned 45° right, 20° above, 105% zoom". A slider whose value is a
 * quaternion, a radius or a bare float tells nobody anything. */
export function orbitValueText(orbit: OrbitState): string {
  const a = Math.round(wrapAzimuth(orbit.azimuth));
  const e = Math.round(orbit.elevation);
  const turn = a === 0 ? 'facing front' : `turned ${Math.abs(a)}° ${a > 0 ? 'right' : 'left'}`;
  const rise =
    e === 0 ? 'level' : `${Math.abs(e)}° ${e > 0 ? 'above' : 'below'}`;
  return `${turn}, ${rise}, ${Math.round(orbit.zoom * 100)}% zoom`;
}

/** The `camera-orbit` attribute model-viewer wants, built from our state.
 * `auto` for the radius means "whatever framed the model", scaled. */
export function orbitAttribute(orbit: OrbitState): string {
  const azimuth = Math.round(wrapAzimuth(orbit.azimuth) * 100) / 100;
  const elevation = Math.round(clamp(orbit.elevation, -89, 89) * 100) / 100;
  const zoom = Math.round(clamp(orbit.zoom, 0.35, 3) * 1000) / 1000;
  return `${azimuth}deg ${90 - elevation}deg ${zoom * 100}%`;
}

interface ModelHost {
  setElement: (el: ModelViewerElementLike | null) => void;
  onPhase: (phase: ModelPhase, message: string) => void;
}

/**
 * Own the `<model-viewer>` element's listeners.
 *
 * The element cancels its own render loop in `disconnectedCallback`, which is
 * what satisfies the rAF ruling — but `load` and `error` are subscriptions we
 * added, so they are removed here.
 */
const modelElement = modifier((el: Element, [host]: [ModelHost]) => {
  const viewer = el as ModelViewerElementLike;
  host.setElement(viewer);

  const onLoad = () => host.onPhase('ready', '');
  const onError = (event: Event) => {
    const detail = (event as CustomEvent).detail as
      | { type?: string; sourceError?: { message?: string } }
      | undefined;
    host.onPhase(
      'error',
      detail?.sourceError?.message ??
        (detail?.type === 'webglcontextlost'
          ? 'The WebGL context was lost — this machine may have no GPU available.'
          : 'This model could not be loaded.'),
    );
  };
  el.addEventListener('load', onLoad);
  el.addEventListener('error', onError);

  return () => {
    el.removeEventListener('load', onLoad);
    el.removeEventListener('error', onError);
    host.setElement(null);
  };
});

// ── ModelViewer ──────────────────────────────────────────────────────────

export interface ModelViewerSignature {
  Args: {
    /** URL of a `.glb` or `.gltf`. Passed through untouched. */
    src: string;
    /** Description of the model. Required in practice — this is the only
     * thing a screen reader can be told about a 3D object. */
    alt: string;
    /** Poster image shown before the model is asked for, and the reserved
     * space while it loads. */
    poster?: string;
    /** iOS Quick Look source, for AR on Safari. */
    iosSrc?: string;
    /** Offer the AR button where the device supports it. Default `false`. */
    ar?: boolean;
    /** Height of the stage in px. Default 320. */
    height?: number;
    /** Aspect ratio of the stage, e.g. `'4 / 3'`. Beats `@height` when both
     * are given. */
    ratio?: string;
    /** Degrees moved by one arrow press. Default 15. */
    step?: number;
    /** Start facing this way. */
    orbit?: Partial<OrbitState>;
    /** Fires when the model finishes loading. */
    onLoad?: () => void;
    /** Fires on every camera change from our controls. */
    onOrbit?: (orbit: OrbitState) => void;
  };
  Element: HTMLDivElement;
}

export class ModelViewer extends Component<ModelViewerSignature> implements ModelHost {
  @tracked phase: ModelPhase = 'poster';
  @tracked message = '';
  @tracked orbit: OrbitState = DEFAULT_ORBIT;

  element: ModelViewerElementLike | null = null;

  constructor(owner: unknown, args: ModelViewerSignature['Args']) {
    super(owner as never, args);
    this.orbit = { ...DEFAULT_ORBIT, ...(args.orbit ?? {}) };
  }

  setElement = (el: ModelViewerElementLike | null): void => {
    this.element = el;
  };
  onPhase = (phase: ModelPhase, message: string): void => {
    this.phase = phase;
    this.message = message;
    if (phase === 'ready') {
      this.args.onLoad?.();
    }
  };

  // ── derived ────────────────────────────────────────────────────────────

  get step(): number {
    const raw = this.args.step;
    return typeof raw === 'number' && raw > 0 ? raw : 15;
  }
  get coarse(): number {
    return this.step * 3;
  }
  get orbitAttr(): string {
    return orbitAttribute(this.orbit);
  }
  get valueText(): string {
    return orbitValueText(this.orbit);
  }
  get azimuth(): number {
    return Math.round(wrapAzimuth(this.orbit.azimuth));
  }
  get stageStyle() {
    return cssStyleFrom([
      cssDeclaration(
        '--pretui-model-h',
        typeof this.args.height === 'number' && this.args.height >= 120
          ? `${Math.round(this.args.height)}px`
          : undefined,
      ),
      cssDeclaration('--pretui-model-ratio', this.args.ratio),
    ]);
  }
  get isPoster(): boolean {
    return this.phase === 'poster';
  }
  get isLoading(): boolean {
    return this.phase === 'loading';
  }
  get openHref(): string | undefined {
    return safeHref(this.args.src);
  }
  get isFailed(): boolean {
    return this.phase === 'error';
  }
  get revealed(): boolean {
    return this.phase !== 'poster';
  }
  /** Boolean attributes bind as `true | undefined` — `false` and `''` both
   * land as a falsy PROPERTY assignment and do nothing at all. */
  get arFlag(): true | undefined {
    return this.args.ar ? true : undefined;
  }
  /** Enabled from the moment the model is REVEALED, not from the moment it
   * finishes loading — because that is what `aria-disabled` on the orbit
   * slider says, and a control that announces itself enabled while silently
   * ignoring every key press is the worst of both. The camera angles are our
   * state, so they move whether or not a GPU ever showed up. */
  get controlsDisabled(): true | undefined {
    return this.revealed ? undefined : true;
  }
  get statusLabel(): string {
    switch (this.phase) {
      case 'poster':
        return 'Not loaded';
      case 'loading':
        return 'Loading';
      case 'error':
        return 'Failed';
      default:
        return 'Ready';
    }
  }

  // ── movement ───────────────────────────────────────────────────────────

  applyOrbit = (next: Partial<OrbitState>): void => {
    const merged: OrbitState = {
      azimuth: wrapAzimuth(next.azimuth ?? this.orbit.azimuth),
      elevation: clamp(next.elevation ?? this.orbit.elevation, -89, 89),
      zoom: clamp(next.zoom ?? this.orbit.zoom, 0.35, 3),
    };
    this.orbit = merged;
    if (this.element) {
      // Setting the property reflects to the attribute and moves the camera.
      this.element.cameraOrbit = orbitAttribute(merged);
    }
    this.args.onOrbit?.(merged);
  };

  reveal = (): void => {
    if (this.phase !== 'poster') {
      return;
    }
    this.phase = 'loading';
    this.message = '';
    this.element?.dismissPoster();
  };

  handlePosterKey = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.reveal();
    }
  };

  handleStageKey = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    if (!this.revealed) {
      return;
    }
    const turn = event.shiftKey ? this.coarse : this.step;
    switch (event.key) {
      case 'ArrowRight':
        this.applyOrbit({ azimuth: this.orbit.azimuth + turn });
        break;
      case 'ArrowLeft':
        this.applyOrbit({ azimuth: this.orbit.azimuth - turn });
        break;
      case 'ArrowUp':
        this.applyOrbit({ elevation: this.orbit.elevation + turn });
        break;
      case 'ArrowDown':
        this.applyOrbit({ elevation: this.orbit.elevation - turn });
        break;
      case 'PageUp':
        this.applyOrbit({ azimuth: this.orbit.azimuth + 90 });
        break;
      case 'PageDown':
        this.applyOrbit({ azimuth: this.orbit.azimuth - 90 });
        break;
      case 'Home':
        this.applyOrbit({ azimuth: 0, elevation: DEFAULT_ORBIT.elevation });
        break;
      case 'End':
        this.applyOrbit({ azimuth: 180, elevation: DEFAULT_ORBIT.elevation });
        break;
      case '+':
      case '=':
        this.applyOrbit({ zoom: this.orbit.zoom - 0.1 });
        break;
      case '-':
      case '_':
        this.applyOrbit({ zoom: this.orbit.zoom + 0.1 });
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  faceFront = (): void => this.applyOrbit({ azimuth: 0, elevation: DEFAULT_ORBIT.elevation });
  turnLeft = (): void => this.applyOrbit({ azimuth: this.orbit.azimuth - this.coarse });
  turnRight = (): void => this.applyOrbit({ azimuth: this.orbit.azimuth + this.coarse });
  zoomIn = (): void => this.applyOrbit({ zoom: this.orbit.zoom - 0.15 });
  zoomOut = (): void => this.applyOrbit({ zoom: this.orbit.zoom + 0.15 });

  <template>
    <div
      class='pretui-model'
      data-phase={{this.phase}}
      data-test-pretui-model-viewer
      ...attributes
    >
      <div class='pretui-model-stage' style={{this.stageStyle}}>
        {{! An EMPTY overlay: `role='slider'` takes presentational children
            only, so neither the canvas nor the poster button may live inside
            it. Pointer-transparent, so model-viewer keeps its own drag-to-
            orbit and the poster button stays clickable; this element exists
            to be the tab stop and to announce where the camera is. }}
        <div
          class='pretui-model-orbit'
          role='slider'
          tabindex='0'
          aria-label={{@alt}}
          aria-valuemin='-180'
          aria-valuemax='180'
          aria-valuenow={{this.azimuth}}
          aria-valuetext={{this.valueText}}
          aria-disabled={{if this.revealed undefined 'true'}}
          {{on 'keydown' this.handleStageKey}}
        ></div>
        <model-viewer
          class='pretui-model-el'
          src={{@src}}
          alt={{@alt}}
          poster={{@poster}}
          ios-src={{@iosSrc}}
          camera-orbit={{this.orbitAttr}}
          reveal='manual'
          loading='lazy'
          camera-controls
          touch-action='pan-y'
          interaction-prompt='none'
          disable-zoom
          ar={{this.arFlag}}
          {{modelElement this}}
        ></model-viewer>

        {{#if this.isPoster}}
          {{! The poster is a real button, so "load this model" is one press
              of Enter and not a mouse-only affordance. }}
          <button
            type='button'
            class='pretui-model-gate'
            {{on 'click' this.reveal}}
            {{on 'keydown' this.handlePosterKey}}
          >
            <span class='pretui-model-gateInk'>
              <span class='pretui-model-gateGlyph' aria-hidden='true'>◈</span>
              Load 3D model
            </span>
            <span class='pretui-model-gateNote'>{{@alt}}</span>
          </button>
        {{else if this.isLoading}}
          <p class='pretui-model-veil'>Loading model…</p>
        {{else if this.isFailed}}
          <p class='pretui-model-veil pretui-model-veil--bad'>
            <span aria-hidden='true'>⚠</span>
            {{if this.message this.message 'This model could not be loaded.'}}
            {{#if this.openHref}}
              <a
                class='pretui-model-link'
                href={{this.openHref}}
                target='_blank'
                rel='noopener noreferrer'
              >Open the file</a>
            {{/if}}
          </p>
        {{/if}}
      </div>

      <div class='pretui-model-bar' role='group' aria-label='Camera'>
        <button
          type='button'
          class='pretui-model-chip'
          disabled={{this.controlsDisabled}}
          {{on 'click' this.turnLeft}}
        >⟲ Left</button>
        <button
          type='button'
          class='pretui-model-chip'
          disabled={{this.controlsDisabled}}
          {{on 'click' this.faceFront}}
        >Front</button>
        <button
          type='button'
          class='pretui-model-chip'
          disabled={{this.controlsDisabled}}
          {{on 'click' this.turnRight}}
        >Right ⟳</button>
        <button
          type='button'
          class='pretui-model-chip'
          disabled={{this.controlsDisabled}}
          {{on 'click' this.zoomIn}}
        >Zoom +</button>
        <button
          type='button'
          class='pretui-model-chip'
          disabled={{this.controlsDisabled}}
          {{on 'click' this.zoomOut}}
        >Zoom −</button>
        <span class='pretui-model-readout'>
          <Token @value={{this.valueText}} />
        </span>
        <span class='pretui-model-status' data-phase={{this.phase}}>
          {{this.statusLabel}}
        </span>
      </div>
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-model {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }
        .pretui-model-stage {
          position: relative;
          /* Reserved BEFORE anything is fetched, so revealing the model never
             moves the page. A ratio wins over a height when both are given. */
          height: var(--pretui-model-h, 320px);
          aspect-ratio: var(--pretui-model-ratio, auto);
          border-radius: var(--radius);
          overflow: hidden;
          background: color-mix(
            in oklch,
            var(--foreground) 6%,
            var(--card)
          );
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
        }
        .pretui-model-orbit {
          position: absolute;
          inset: 0;
          z-index: var(--pretui-z-raised, 1);
          border-radius: var(--radius);
          pointer-events: none;
        }
        .pretui-model-orbit:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        .pretui-model-el {
          display: block;
          width: 100%;
          height: 100%;
          --poster-color: transparent;
          --progress-bar-color: var(--primary);
        }
        .pretui-model-gate {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          border: 0;
          font: inherit;
          color: var(--foreground);
          background: color-mix(
            in oklch,
            var(--card) 72%,
            transparent
          );
          cursor: pointer;
        }
        .pretui-model-gate:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -4px;
        }
        .pretui-model-gateInk {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 600;
        }
        .pretui-model-gateGlyph {
          color: var(--pretui-primary-ink, var(--boxel-highlight-hover));
        }
        .pretui-model-gateNote {
          max-width: 32ch;
          text-align: center;
          font-size: var(--text-ui-xs, 10.5px);
          color: var(--muted-foreground);
        }
        .pretui-model-veil {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin: 0;
          padding: 0 16px;
          text-align: center;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
          background: color-mix(in oklch, var(--card) 84%, transparent);
        }
        .pretui-model-veil--bad {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
        }
        .pretui-model-link {
          font-weight: 600;
          color: var(--pretui-primary-ink, var(--boxel-highlight-hover));
          text-underline-offset: 3px;
        }
        .pretui-model-link:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 3px;
          border-radius: 3px;
        }
        .pretui-model-bar {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
        }
        .pretui-model-chip {
          padding: 3px 9px;
          border: 0;
          border-radius: 999px;
          font: inherit;
          font-size: var(--text-ui-xs, 10.5px);
          font-weight: 600;
          color: var(--foreground);
          background: color-mix(
            in oklch,
            var(--foreground) 7%,
            var(--card)
          );
          cursor: pointer;
        }
        .pretui-model-chip:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .pretui-model-chip:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-model-readout {
          margin-inline-start: auto;
        }
        .pretui-model-status {
          font-size: var(--text-ui-xs, 10.5px);
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .pretui-model-status[data-phase='error'] {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
        }
        .pretui-model-status[data-phase='ready'] {
          color: var(--pretui-primary-ink, var(--boxel-highlight-hover));
        }
        .dark .pretui-model-gate {
          color: var(--foreground);
          background: color-mix(in oklch, var(--card) 72%, transparent);
        }
        .dark .pretui-model-veil {
          background: color-mix(in oklch, var(--card) 84%, transparent);
        }
        .dark .pretui-model-chip {
          color: var(--foreground);
          background: color-mix(
            in oklch,
            var(--foreground) 10%,
            var(--card)
          );
        }
        @media (prefers-reduced-motion: reduce) {
          /* model-viewer's interaction prompt is already off; this pins the
             element's own transitions so a reveal lands on the end state. */
          .pretui-model-el {
            --progress-bar-height: 2px;
          }
        }
      }
    </style>
  </template>
}
