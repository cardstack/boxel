// Pretui — SignaturePad: capture a signature by drawing or typing.
//
// Built on signature_pad (MIT), vendored from the local checkout at commit
// fe82b51 — `git describe` v5.1.4-4-gfe82b51. See `../sigpad/README.md` for the
// provenance table, the licence, the build command and the library's own traps.
//
// WHAT MAKES SIGNATURE PADS BAD IN THE WILD, AND WHAT IS DONE ABOUT IT HERE.
// Every item below is a defect observed across shipped implementations; each
// is the reason for a specific piece of this file.
//
//   1. Soft strokes on every modern screen. The canvas backing store must be
//      scaled by devicePixelRatio, or a 2× display draws a 1× bitmap and
//      stretches it. `sizeCanvas` does the scaling; the ratio expression is
//      deliberately the SAME one the library's own toSVG uses, so the
//      exported viewBox can never disagree with the bitmap.
//   2. A signature lost to a reflow. Writing canvas.width/height — which
//      HiDPI scaling requires — wipes the bitmap. Every resize here reads
//      `toData()` first and replays it with `fromData()` after, so a
//      container reflow, a sidebar opening, an orientation change or an
//      option change costs nothing. A ResizeObserver drives it (observers are
//      legal; this one disconnects in the destructor).
//   3. Timers that outlive the element. The library's default `throttle: 16`
//      routes pointermove through a `window.setTimeout` we cannot reach. This
//      component passes `throttle: 0`, which wires the move handler directly
//      and makes the bundle schedule NO timer of any kind — strictly better
//      than owning the handle, because there is no handle. Browsers already
//      coalesce pointermove. Grep this file: it contains no setTimeout, no
//      setInterval, no requestAnimationFrame, no Date.now, no Math.random.
//   4. Touch drawing that scrolls the page. `touch-action: none` on the
//      canvas, so a finger draws instead of panning.
//   5. Output that cannot be re-rendered. `@onChange` emits the STROKE DATA —
//      the point arrays — not a picture. That is what makes the signature
//      resizable, re-themeable and losslessly restorable; images are produced
//      on demand from the yielded API, SVG first.
//   6. "Drag a mouse or you cannot sign." A signature pad is an input, and a
//      pointer-only input excludes anyone using a keyboard, a screen reader,
//      or a tremor-affected hand. The typed-name alternative here is a full
//      peer, not a courtesy: same @onChange contract, same isEmpty semantics,
//      same toSVG()/toPNG() output, rendered in a script face, and reachable
//      by Tab alone.
//   7. A canvas that eats Tab. This component binds NO key handler anywhere
//      and puts NO tabindex on the canvas, so Tab always moves on. The
//      keyboard path runs entirely through real controls: the method radios,
//      the typed-name input and the Clear button.
//
// Realm laws observed: no timers of our own and none from the engine; the
// ResizeObserver disconnects and the pointer listeners are removed with
// `pad.off()` in the modifier's destructor; no side-effect CSS; unnamed
// container query only; no `!important` / `:deep()` / `:global()`; no dark
// branch — every colour is a token with a light fallback.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import SignaturePadEngineRaw from '../sigpad/index.js';
import { Button } from './button';

// ── public types ─────────────────────────────────────────────────────────

/** One captured sample. `time` is a wall-clock ms stamp from the engine. */
export interface SignaturePoint {
  x: number;
  y: number;
  pressure: number;
  time: number;
}

/** One pen-down…pen-up stroke, with the pen settings it was drawn with. */
export interface SignatureStroke {
  points: SignaturePoint[];
  penColor: string;
  dotSize: number;
  minWidth: number;
  maxWidth: number;
  velocityFilterWeight: number;
  compositeOperation: GlobalCompositeOperation;
}

export type SignatureMode = 'draw' | 'type';

/**
 * What `@onChange` receives. Everything needed to re-render the signature
 * losslessly, and nothing that would need re-rasterising to do it.
 */
export interface SignatureValue {
  mode: SignatureMode;
  /** the point arrays — empty in 'type' mode */
  strokes: SignatureStroke[];
  /** the typed name — empty in 'draw' mode */
  typedName: string;
  isEmpty: boolean;
}

/** The handle yielded to the default block. */
export interface SignatureApi {
  mode: SignatureMode;
  isEmpty: boolean;
  value: SignatureValue;
  /** clears whichever mode is active */
  clear: () => void;
  /**
   * SVG markup with a `<title>` carrying the alt text. Preferred for storage
   * and print: it scales, stays crisp, and stays inspectable. Returns
   * undefined when the pad is empty.
   */
  toSVG: () => string | undefined;
  /**
   * A raster PNG data URL, for the callers that genuinely need one (a PDF
   * stamp, a legacy print pipeline). Returns undefined when the pad is empty.
   */
  toPNG: () => string | undefined;
  /** the alt text that the image carries, exposed so callers can reuse it */
  altText: string;
}

// The vendored bundle ships no types (it is a built artifact), so the untyped
// boundary is asserted once, here, rather than leaking `any` outward.
interface SigPadEngine {
  penColor: string;
  minWidth: number;
  maxWidth: number;
  dotSize: number;
  clear(): void;
  isEmpty(): boolean;
  toData(): SignatureStroke[];
  fromData(strokes: SignatureStroke[], options?: { clear?: boolean }): void;
  toDataURL(type?: string): string;
  toSVG(options?: {
    includeBackgroundColor?: boolean;
    includeDataUrl?: boolean;
  }): string;
  off(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

const SigPadEngineCtor = SignaturePadEngineRaw as unknown as new (
  canvas: HTMLCanvasElement,
  options?: Record<string, unknown>,
) => SigPadEngine;

// ── helpers ──────────────────────────────────────────────────────────────

/** XML-escape for the one place we assemble markup by hand: <title>. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clampNum(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

/**
 * The pen colour never reaches a style declaration — it goes to the canvas
 * 2D context — but a garbage value would still poison the exported SVG's
 * `stroke` attribute, so caller values are restricted to the forms whose
 * meaning is unambiguous: an opaque hex literal, or an rgb()/rgba() triple.
 * Anything else falls back to the resolved token ink.
 */
export function signatureInk(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(raw) || /^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.toLowerCase();
  }
  if (/^rgba?\(\s*[\d.\s,%/]+\)$/.test(raw)) return raw;
  return undefined;
}

/** The script face used for a typed signature. Overridable per instance. */
export const SIGNATURE_SCRIPT_STACK =
  "'Snell Roundhand', 'Segoe Script', 'Brush Script MT', 'Apple Chancery', cursive";

// ── the Glimmer↔engine binding ───────────────────────────────────────────
//
// The reusable artifact of this component. The modifier owns the engine, the
// observer and the listeners, and the destructor gives every one of them
// back. Its arguments are ONLY primitives plus three stable arrow class
// properties — never a tracked object — because a fresh object reference per
// render re-runs the modifier, which would tear down the engine mid-signature
// (the realm's documented modifier-tracking-loop trap).
//
// A re-run is nevertheless survivable: `restore()` hands back the strokes the
// component has been keeping all along, so changing the pen colour or the
// stroke width rebuilds the engine and replays the signature into it. That is
// the same mechanism that survives a resize, used twice.
const sigPadInto = modifier(
  (
    canvas: HTMLCanvasElement,
    [onReady, onStrokeEnd, restore, penColor, minWidth, maxWidth, dotSize]: [
      (pad: SigPadEngine | undefined) => void,
      () => void,
      () => SignatureStroke[],
      string | undefined,
      number,
      number,
      number,
    ],
  ) => {
    // A `var(--token)` string means nothing to a canvas context, so the ink
    // is resolved from the element's own computed `color` — which the scoped
    // CSS points at the theme token. The pen therefore re-tints with the
    // season without the component ever handling a token string.
    const resolved =
      penColor ?? getComputedStyle(canvas).color ?? 'rgb(20, 22, 26)';

    const pad = new SigPadEngineCtor(canvas, {
      // THE realm-law-critical option — see note 3 in the file header.
      throttle: 0,
      minDistance: 1,
      penColor: resolved,
      minWidth,
      maxWidth,
      dotSize,
      // Transparent, so an exported SVG carries strokes only and drops onto
      // any background. The visible paper is the element's CSS.
      backgroundColor: 'rgba(0,0,0,0)',
    });

    // A canvas with no CSS width falls back to its width/height ATTRIBUTES
    // for layout — which is exactly what this modifier writes. Relying on the
    // scoped stylesheet to pin the CSS size would therefore let the observer
    // feed itself (measure → write → shrink → measure) whenever that
    // stylesheet has not landed, and the pad would collapse to a pixel. Found
    // the hard way: `boxel test` never injects scoped component CSS, and the
    // pad shrank to 1×1 there. The element's own size is pinned here so the
    // loop is impossible regardless of what CSS arrives.
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    let lastWidth = 0;
    let lastHeight = 0;

    const sizeCanvas = (): void => {
      // offsetWidth/offsetHeight, not getBoundingClientRect: these are the
      // LAYOUT size in CSS pixels, unaffected by any ancestor transform, and
      // they are what the library's own toSVG assumes when it computes the
      // viewBox as `canvas.width / ratio`.
      const cssWidth = canvas.offsetWidth;
      const cssHeight = canvas.offsetHeight;
      if (cssWidth === 0 || cssHeight === 0) return;
      // Deliberately the same expression as the library's toSVG uses, so the
      // exported viewBox and the bitmap can never disagree.
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const width = Math.round(cssWidth * ratio);
      const height = Math.round(cssHeight * ratio);
      // Guard the no-op case: a repeated wipe/replay would be wasted work.
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;

      // The strokes must be read BEFORE the assignment that wipes them.
      const kept = pad.toData();
      canvas.width = width;
      canvas.height = height;
      // Assigning width/height also resets the context transform.
      canvas.getContext('2d')?.scale(ratio, ratio);
      pad.clear();
      const data = kept.length > 0 ? kept : restore();
      if (data.length > 0) pad.fromData(data);
    };

    const observer = new ResizeObserver(sizeCanvas);
    observer.observe(canvas);
    // ResizeObserver fires once on observe, but that is asynchronous; sizing
    // synchronously here means the first paint is already correct.
    sizeCanvas();

    pad.addEventListener('endStroke', onStrokeEnd);
    onReady(pad);

    return () => {
      observer.disconnect();
      pad.removeEventListener('endStroke', onStrokeEnd);
      pad.off();
      pad.clear();
      onReady(undefined);
    };
  },
);

// ── SignaturePad ─────────────────────────────────────────────────────────

export interface SignaturePadSignature {
  Args: {
    /** the visible label — required in spirit; defaults to 'Signature' */
    label?: string;
    /** helper text under the surface, wired via aria-describedby */
    description?: string;
    /** who is signing; used in the image alt text and as the typed default */
    signerName?: string;
    /** initial strokes, e.g. rehydrated from a previous @onChange payload */
    defaultStrokes?: SignatureStroke[];
    /** initial typed name */
    defaultTypedName?: string;
    /** which method is offered first — 'draw' by default */
    defaultMode?: SignatureMode;
    /**
     * hide the typed-name alternative. Strongly discouraged: it is the only
     * path for anyone who cannot draw with a pointer. Provided so a caller
     * with a genuinely different fallback can say so out loud.
     */
    hideTypedAlternative?: boolean;
    /** ink colour — opaque hex or rgb(); defaults to the resolved token ink */
    penColor?: string;
    /** thinnest stroke in px, clamped to [0.1, 10] */
    minWidth?: number;
    /** thickest stroke in px, clamped to [0.5, 30] */
    maxWidth?: number;
    /** radius of a single tap dot in px, clamped to [0, 20] */
    dotSize?: number;
    /** surface height in px, clamped to [80, 600] — default 180 */
    height?: number;
    /** marks the control required and says so in the label */
    required?: boolean;
    /** fires on every stroke, clear, typed keystroke and mode change */
    onChange?: (value: SignatureValue) => void;
  };
  Blocks: {
    /** receives the imperative handle: clear, toSVG, toPNG, isEmpty, value */
    default: [SignatureApi];
  };
  Element: HTMLElement;
}

export class SignaturePad extends Component<SignaturePadSignature> {
  private guid = guidFor(this);
  private pad: SigPadEngine | undefined;

  @tracked mode: SignatureMode =
    this.args.defaultMode === 'type' && !this.args.hideTypedAlternative
      ? 'type'
      : 'draw';
  @tracked strokes: SignatureStroke[] = this.args.defaultStrokes ?? [];
  @tracked typedName: string =
    this.args.defaultTypedName ?? this.args.signerName ?? '';

  get labelId(): string {
    return this.guid + '-label';
  }
  get descriptionId(): string {
    return this.guid + '-desc';
  }
  get typedInputId(): string {
    return this.guid + '-typed';
  }
  get modeGroupName(): string {
    return this.guid + '-mode';
  }

  get labelText(): string {
    return this.args.label ?? 'Signature';
  }

  get offersTyped(): boolean {
    return !this.args.hideTypedAlternative;
  }

  get isDrawMode(): boolean {
    return this.mode === 'draw' || !this.offersTyped;
  }

  get isEmpty(): boolean {
    return this.isDrawMode
      ? this.strokes.length === 0
      : this.typedName.trim().length === 0;
  }

  get surfaceHeight(): number {
    return Math.round(clampNum(this.args.height, 80, 600, 180));
  }

  get penColor(): string | undefined {
    return signatureInk(this.args.penColor);
  }
  get minWidth(): number {
    return clampNum(this.args.minWidth, 0.1, 10, 0.7);
  }
  get maxWidth(): number {
    return clampNum(this.args.maxWidth, 0.5, 30, 2.4);
  }
  get dotSize(): number {
    return clampNum(this.args.dotSize, 0, 20, 1.6);
  }

  /** Named for the reader of the exported image, not for the DOM. */
  get altText(): string {
    const who = (this.args.signerName ?? this.typedName).trim();
    const kind = this.isDrawMode ? 'Handwritten signature' : 'Typed signature';
    return who ? kind + ' of ' + who : kind;
  }

  /** Reflected into the canvas's accessible name, and into a live region. */
  get canvasLabel(): string {
    return this.isEmpty
      ? this.labelText + ' — drawing area, empty'
      : this.labelText + ' — drawing area, signature drawn';
  }

  get statusText(): string {
    if (this.isEmpty) return 'No signature yet.';
    return this.isDrawMode
      ? 'Signature captured, ' + this.strokes.length + ' strokes.'
      : 'Signature captured as typed name.';
  }

  get describedBy(): string | undefined {
    return this.args.description ? this.descriptionId : undefined;
  }

  get value(): SignatureValue {
    return {
      mode: this.isDrawMode ? 'draw' : 'type',
      strokes: this.isDrawMode ? this.strokes : [],
      typedName: this.isDrawMode ? '' : this.typedName.trim(),
      isEmpty: this.isEmpty,
    };
  }

  // ── arrow properties: stable references, safe as modifier args ─────────

  private registerPad = (pad: SigPadEngine | undefined): void => {
    this.pad = pad;
  };

  private restoreStrokes = (): SignatureStroke[] => this.strokes;

  private handleStrokeEnd = (): void => {
    this.strokes = this.pad ? this.pad.toData() : [];
    this.args.onChange?.(this.value);
  };

  // aria-disabled rather than native disabled while empty: clearing must not
  // drop the focus that pressed Clear onto the body
  clear = (): void => {
    if (this.isEmpty) {
      return;
    }
    if (this.isDrawMode) {
      this.pad?.clear();
      this.strokes = [];
    } else {
      this.typedName = '';
    }
    this.args.onChange?.(this.value);
  };

  selectMode = (mode: SignatureMode): void => {
    if (this.mode === mode) return;
    this.mode = mode;
    this.args.onChange?.(this.value);
  };

  handleModeChange = (mode: SignatureMode, event: Event): void => {
    if ((event.target as HTMLInputElement).checked) this.selectMode(mode);
  };

  handleTypedInput = (event: Event): void => {
    this.typedName = (event.target as HTMLInputElement).value;
    this.args.onChange?.(this.value);
  };

  /**
   * SVG first, per the output contract: it scales, prints, stays crisp and
   * carries its own alt text. The drawn branch asks the engine and injects a
   * `<title>` as the first child (which is what gives an inline SVG its
   * accessible name); the typed branch composes the same shape by hand, with
   * the name as REAL TEXT inside the SVG, so it stays selectable and
   * searchable rather than becoming a picture of a word.
   */
  toSVG = (): string | undefined => {
    if (this.isEmpty) return undefined;
    const title = '<title>' + xmlEscape(this.altText) + '</title>';
    if (this.isDrawMode) {
      if (!this.pad) return undefined;
      const svg = this.pad.toSVG({ includeBackgroundColor: false });
      const head = svg.indexOf('>');
      if (head < 0) return undefined;
      return svg.slice(0, head + 1) + title + svg.slice(head + 1);
    }
    const width = 480;
    const height = 160;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      width +
      ' ' +
      height +
      '" width="' +
      width +
      '" height="' +
      height +
      '" role="img">' +
      title +
      '<text x="24" y="104" font-family="' +
      xmlEscape(SIGNATURE_SCRIPT_STACK) +
      '" font-size="64" fill="' +
      (this.penColor ?? '#14161a') +
      '">' +
      xmlEscape(this.typedName.trim()) +
      '</text></svg>'
    );
  };

  /**
   * The raster escape hatch. Offered because PDF stamps and legacy print
   * pipelines genuinely need one — not as the default, and never as the
   * thing that gets persisted when SVG would do.
   */
  toPNG = (): string | undefined => {
    if (this.isEmpty) return undefined;
    if (this.isDrawMode) return this.pad?.toDataURL('image/png');
    const canvas = document.createElement('canvas');
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = Math.round(480 * ratio);
    canvas.height = Math.round(160 * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = this.penColor ?? '#14161a';
    ctx.font = '64px ' + SIGNATURE_SCRIPT_STACK;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(this.typedName.trim(), 24, 104);
    return canvas.toDataURL('image/png');
  };

  get api(): SignatureApi {
    return {
      mode: this.isDrawMode ? 'draw' : 'type',
      isEmpty: this.isEmpty,
      value: this.value,
      clear: this.clear,
      toSVG: this.toSVG,
      toPNG: this.toPNG,
      altText: this.altText,
    };
  }

  /** Clamped integer, so no caller string ever reaches a style declaration. */
  get surfaceStyle(): ReturnType<typeof htmlSafe> {
    return htmlSafe('height:' + this.surfaceHeight + 'px');
  }

  get isTypeMode(): boolean {
    return !this.isDrawMode;
  }

  <template>
    <div
      class='pretui-sigpad'
      data-mode={{if this.isDrawMode 'draw' 'type'}}
      data-empty={{if this.isEmpty 'true' 'false'}}
      data-test-pretui-signature-pad
      ...attributes
    >
      <div class='pretui-sigpad-head'>
        <span class='pretui-sigpad-label' id={{this.labelId}}>
          {{this.labelText}}
          {{#if @required}}
            <span aria-hidden='true'>*</span>
            <span class='pretui-sr'>(required)</span>
          {{/if}}
        </span>

        {{#if this.offersTyped}}
          <fieldset class='pretui-sigpad-modes' data-test-pretui-signature-modes>
            <legend class='pretui-sr'>Signing method</legend>
            <label class='pretui-sigpad-mode'>
              <input
                type='radio'
                name={{this.modeGroupName}}
                value='draw'
                checked={{this.isDrawMode}}
                data-test-pretui-signature-mode-draw
                {{on 'change' (fn this.handleModeChange 'draw')}}
              />
              <span>Draw</span>
            </label>
            <label class='pretui-sigpad-mode'>
              <input
                type='radio'
                name={{this.modeGroupName}}
                value='type'
                checked={{this.isTypeMode}}
                data-test-pretui-signature-mode-type
                {{on 'change' (fn this.handleModeChange 'type')}}
              />
              <span>Type</span>
            </label>
          </fieldset>
        {{/if}}
      </div>

      <div class='pretui-sigpad-surface' style={{this.surfaceStyle}}>
        {{#if this.isDrawMode}}
          {{! No tabindex and no key handler: Tab passes straight through, so
              the canvas can never become a keyboard trap. The keyboard path
              is the radios, the typed input and the Clear button. }}
          <canvas
            class='pretui-sigpad-canvas'
            role='img'
            aria-label={{this.canvasLabel}}
            aria-describedby={{this.describedBy}}
            data-test-pretui-signature-canvas
            {{sigPadInto
              this.registerPad
              this.handleStrokeEnd
              this.restoreStrokes
              this.penColor
              this.minWidth
              this.maxWidth
              this.dotSize
            }}
          ></canvas>
          {{#if this.isEmpty}}
            <span class='pretui-sigpad-hint' aria-hidden='true'>Sign here</span>
          {{/if}}
        {{else}}
          <label class='pretui-sr' for={{this.typedInputId}}>Type your full
            name to sign</label>
          <input
            id={{this.typedInputId}}
            class='pretui-sigpad-typed'
            type='text'
            autocomplete='name'
            spellcheck='false'
            placeholder='Your full name'
            aria-describedby={{this.describedBy}}
            value={{this.typedName}}
            data-test-pretui-signature-typed
            {{on 'input' this.handleTypedInput}}
          />
        {{/if}}
        <span class='pretui-sigpad-rule' aria-hidden='true'></span>
      </div>

      <div class='pretui-sigpad-foot'>
        {{#if @description}}
          <p class='pretui-sigpad-desc' id={{this.descriptionId}}>
            {{@description}}
          </p>
        {{/if}}
        <div class='pretui-sigpad-actions'>
          <Button
            @appearance="outlined"
            @size='s'
            aria-disabled={{if this.isEmpty 'true'}}
            data-test-pretui-signature-clear
            {{on 'click' this.clear}}
          >Clear</Button>
        </div>
      </div>

      <span
        class='pretui-sr'
        role='status'
        aria-live='polite'
        data-test-pretui-signature-status
      >{{this.statusText}}</span>

      {{yield this.api}}
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-sigpad {
          --pretui-sigpad-ink: var(--foreground);
          --pretui-sigpad-paper: var(--card);
          --pretui-sigpad-radius: var(--radius);
          --pretui-sigpad-script: 'Snell Roundhand', 'Segoe Script',
            'Brush Script MT', 'Apple Chancery', cursive;
          container-type: inline-size;
          display: flex;
          flex-direction: column;
          gap: var(--space-3, 8px);
        }
        .pretui-sigpad-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: var(--space-3, 8px);
          flex-wrap: wrap;
        }
        .pretui-sigpad-label {
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 600;
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--foreground);
        }
        .pretui-sigpad-modes {
          display: flex;
          gap: var(--space-2, 5px);
          margin: 0;
          padding: 0;
          border: 0;
        }
        .pretui-sigpad-mode {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          /* 44px hit target on coarse pointers — see the touch axis. */
          min-height: 28px;
          padding: 2px 6px;
          border-radius: var(--radius-sm, 5px);
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-sigpad-mode:has(input:checked) {
          color: var(--foreground);
          background: var(--hover, rgb(0 0 0 / 0.05));
        }
        .pretui-sigpad-mode:has(input:focus-visible) {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        @media (any-pointer: coarse) {
          .pretui-sigpad-mode {
            min-height: 44px;
            padding: 2px 10px;
          }
        }
        .pretui-sigpad-surface {
          position: relative;
          display: flex;
          align-items: stretch;
          border-radius: var(--pretui-sigpad-radius);
          background: var(--pretui-sigpad-paper);
          box-shadow: var(
            --pretui-shadow-control,
            0 0 0 1px var(--border)
          );
          overflow: hidden;
        }
        .pretui-sigpad-canvas {
          /* Without this a finger pans the page instead of drawing. The engine
             also sets it inline, so this is belt-and-braces — but the display
             and size below are NOT: they are re-applied inline by the modifier
             too, because a canvas that falls back to its attribute size makes
             the ResizeObserver feed itself. */
          touch-action: none;
          display: block;
          width: 100%;
          height: 100%;
          /* The engine reads the resolved value of this to pick its ink, so
             the pen re-tints with the season without ever handling a token. */
          color: var(--pretui-sigpad-ink);
          cursor: crosshair;
        }
        .pretui-sigpad-typed {
          width: 100%;
          border: 0;
          background: transparent;
          padding: 0 var(--space-4, 11px) 28px;
          font-family: var(--pretui-sigpad-script);
          font-size: clamp(28px, 12cqi, 56px);
          line-height: 1.1;
          color: var(--pretui-sigpad-ink);
          text-align: center;
        }
        .pretui-sigpad-typed:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
          border-radius: var(--pretui-sigpad-radius);
        }
        .pretui-sigpad-typed::placeholder {
          font-family: var(--font-sans);
          font-size: var(--text-ui, 13px);
          color: var(--muted-foreground);
        }
        .pretui-sigpad-hint {
          position: absolute;
          inset-inline: 0;
          bottom: 26px;
          text-align: center;
          font-size: var(--text-ui-sm, 11.5px);
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--muted-foreground);
          pointer-events: none;
        }
        .pretui-sigpad-rule {
          position: absolute;
          inset-inline: var(--space-4, 11px);
          bottom: 18px;
          height: 1px;
          background: var(--border);
          pointer-events: none;
        }
        .pretui-sigpad-foot {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-3, 8px);
          flex-wrap: wrap;
        }
        .pretui-sigpad-desc {
          margin: 0;
          flex: 1;
          min-width: 0;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        .pretui-sigpad-actions {
          display: flex;
          gap: var(--space-2, 5px);
          margin-inline-start: auto;
        }
        @container (max-width: 320px) {
          .pretui-sigpad-head {
            flex-direction: column;
            align-items: flex-start;
          }
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
      }
    </style>
  </template>
}

export default SignaturePad;
