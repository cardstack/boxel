// Pretui — ImageCropper: an image crop on Cropper.js with ratio presets and a keyboard-movable box.
//
//   <ImageCropper @src={{url}} @alt='Kandy plate 04' @onChange={{this.take}} />
//
// Cropper.js 2.1.1 (MIT, vendored at ./cropper — see that folder's README for
// the licence, the provenance and the one adaptation the bundle needed) is a
// Web Component suite, so the crop surface below is plain tags in a Glimmer
// template. No `new Cropper(img)`, no imperative mount, no instance to hold.
//
// Four decisions worth stating:
//
//   1. **`keyboard` is deliberately OFF, and the keyboard support is better
//      for it.** Cropper's own `keyboard` attribute attaches a keydown
//      listener to the DOCUMENT: turn it on and every arrow key anywhere on
//      the page nudges the crop box, whether or not the cropper has focus.
//      That is not accessibility, it is a global hotkey with no owner. Pretui
//      leaves it off and supplies four real `role='slider'` controls instead —
//      native `<input type='range'>`, so arrows, Shift, PageUp/PageDown,
//      Home and End all work the way the platform already defines, and each
//      one announces a value a human can act on ("crop width 320 of 640
//      pixels") rather than a bare float.
//   2. **The crop box is one state, reachable two ways.** Pointer drag is
//      Cropper's; the sliders are ours; both go through `applyBox`, so they
//      cannot disagree and there is no "keyboard mode".
//   3. **Every boolean attribute is a literal in the template, never a
//      binding.** Glimmer binds a dynamic attribute through the PROPERTY, so
//      `movable={{''}}` sets `el.movable = ''` — falsy — and the box silently
//      refuses to move. Cropper has a dozen of these. Static attributes are
//      set with `setAttribute` and cannot fall into that hole; the two genuinely
//      dynamic ones (`src`, `aspect-ratio`) are hyphenated, which keeps them
//      on the attribute path too.
//   4. **Export is a canvas and a data URL, not an object URL.** `$toCanvas()`
//      then `toDataURL()` leaves nothing to revoke, which is one whole class
//      of leak that simply never arises.
//
// BETTER THAN THE INSPIRATION: Cropper's own demos are a crop box and a
// "get data" button that logs to the console. There is no announced state, no
// keyboard path that does not hijack the page, and no reserved space — the
// layout jumps when the image decodes.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { Token } from './token';
// Side-effect import: evaluating the bundle DEFINES cropper-canvas,
// cropper-image, cropper-selection and the rest. It is DOM-free under plain
// Node because of the one-line HTMLElement shim in the bundle's banner — see
// ./cropper/README.md, which explains exactly why one line is enough.
import '../cropper/index.js';

// ── The crop box ─────────────────────────────────────────────────────────

/** A crop rectangle in the canvas's own coordinate space. */
export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The named ratios the toolbar offers. `0` means "free". */
export const CROP_RATIOS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'Free', value: 0 },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 1.5 },
  { label: '16:9', value: 16 / 9 },
];

function round(n: number): number {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** The slice of `cropper-selection` this module uses. */
export interface CropperSelectionElement extends HTMLElement {
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: number;
  $change: (x: number, y: number, width: number, height: number) => void;
  $reset: () => void;
  $toCanvas: (options?: {
    width?: number;
    height?: number;
  }) => Promise<HTMLCanvasElement>;
}

/** The slice of `cropper-image` this module uses. */
export interface CropperImageElement extends HTMLElement {
  $rotate: (angle: string | number) => void;
  $scale: (x: number, y?: number) => void;
  $resetTransform: () => void;
  $center: (size?: string) => void;
}

interface CropperHost {
  setSelection: (el: CropperSelectionElement | null) => void;
  setImage: (el: CropperImageElement | null) => void;
  setBounds: (width: number, height: number) => void;
  readBox: (box: CropBox) => void;
}

/** Own the `cropper-selection` element: hold it, listen for its `change`, and
 * let go on teardown. No engine to destroy — the custom element's own
 * `disconnectedCallback` does that — but the listener is ours and is removed
 * here, which is the same ownership rule the rAF ruling states. */
const cropperSelection = modifier((el: Element, [host]: [CropperHost]) => {
  const selection = el as CropperSelectionElement;
  host.setSelection(selection);
  const onChange = (event: Event) => {
    const detail = (event as CustomEvent).detail as CropBox | undefined;
    if (detail) {
      host.readBox(detail);
    }
  };
  el.addEventListener('change', onChange);
  return () => {
    el.removeEventListener('change', onChange);
    host.setSelection(null);
  };
});

/** Own the `cropper-image` element, for rotate and flip. */
const cropperImage = modifier((el: Element, [host]: [CropperHost]) => {
  host.setImage(el as CropperImageElement);
  return () => host.setImage(null);
});

/** Watch the canvas box, because the crop box's coordinate space IS the
 * canvas box — the slider maxima are wrong the moment it resizes. The
 * observer is created here and disconnected in the destructor; nothing
 * outlives the element. */
const cropperBounds = modifier((el: Element, [host]: [CropperHost]) => {
  const read = () => {
    const box = el.getBoundingClientRect();
    host.setBounds(box.width, box.height);
  };
  read();
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(read);
    observer.observe(el);
  }
  return () => {
    observer?.disconnect();
    observer = null;
  };
});

// ── ImageCropper ─────────────────────────────────────────────────────────

export interface ImageCropperSignature {
  Args: {
    /** URL of the image to crop. Passed through untouched. */
    src: string;
    /** Alt text. An empty string marks the image decorative. */
    alt?: string;
    /** Accessible name of the crop controls. Default `'Crop'`. */
    label?: string;
    /** Locked aspect ratio, or 0/omitted for free. */
    aspectRatio?: number;
    /** Height of the crop surface in px. Default 320. Reserved before the
     * image decodes so nothing reflows. */
    height?: number;
    /** Offer rotate and flip. Default `true`. */
    transforms?: boolean;
    /** Fires on every crop-box change, from pointer or keyboard. */
    onChange?: (box: CropBox) => void;
    /** Fires when the caller presses Export, with a PNG data URL. */
    onExport?: (dataUrl: string, box: CropBox) => void;
  };
  Element: HTMLDivElement;
}

export class ImageCropper extends Component<ImageCropperSignature> implements CropperHost {
  @tracked box: CropBox = { x: 0, y: 0, width: 0, height: 0 };
  @tracked boundsWidth = 0;
  @tracked boundsHeight = 0;
  @tracked ratio = 0;
  @tracked exported = '';
  @tracked exportError = '';

  selection: CropperSelectionElement | null = null;
  image: CropperImageElement | null = null;

  ratios = CROP_RATIOS;

  /** Called as a helper from the template — a plain function, invoked as
   * `(this.isRatio option.value)`. */
  isRatio = (value: number): boolean => {
    return this.ratio === value;
  };

  constructor(owner: unknown, args: ImageCropperSignature['Args']) {
    super(owner as never, args);
    this.ratio = typeof args.aspectRatio === 'number' ? args.aspectRatio : 0;
  }

  // ── host wiring ────────────────────────────────────────────────────────

  setSelection = (el: CropperSelectionElement | null): void => {
    this.selection = el;
  };
  setImage = (el: CropperImageElement | null): void => {
    this.image = el;
  };
  setBounds = (width: number, height: number): void => {
    this.boundsWidth = round(width);
    this.boundsHeight = round(height);
  };
  readBox = (box: CropBox): void => {
    this.box = {
      x: round(box.x),
      y: round(box.y),
      width: round(box.width),
      height: round(box.height),
    };
    this.args.onChange?.(this.box);
  };

  // ── derived ────────────────────────────────────────────────────────────

  get label(): string {
    return this.args.label ?? 'Crop';
  }
  get height(): number {
    const raw = this.args.height;
    return typeof raw === 'number' && raw >= 120 ? Math.round(raw) : 320;
  }
  get surfaceStyle() {
    return cssStyleFrom([cssDeclaration('--pretui-crop-h', `${this.height}px`)]);
  }
  /** Bound as an ATTRIBUTE, not a property: the name is hyphenated, so
   * Glimmer cannot route it through `el.aspect-ratio`. `''` omits it. */
  get ratioAttr(): string | undefined {
    return this.ratio > 0 ? String(this.ratio) : undefined;
  }
  get maxX(): number {
    return Math.max(0, this.boundsWidth - this.box.width);
  }
  get maxY(): number {
    return Math.max(0, this.boundsHeight - this.box.height);
  }
  get maxWidth(): number {
    return Math.max(1, this.boundsWidth - this.box.x);
  }
  get maxHeight(): number {
    return Math.max(1, this.boundsHeight - this.box.y);
  }
  get summary(): string {
    return `${this.box.width} × ${this.box.height} at ${this.box.x}, ${this.box.y}`;
  }
  get hasBox(): boolean {
    return this.box.width > 0 && this.box.height > 0;
  }
  get exportDisabled(): true | undefined {
    return this.hasBox ? undefined : true;
  }
  get showTransforms(): boolean {
    return this.args.transforms ?? true;
  }
  /** "crop width 320 of 640 pixels" — a slider that announces `320` and
   * nothing else tells a screen-reader user nothing at all. */
  textFor = (which: 'x' | 'y' | 'width' | 'height'): string => {
    const nouns: Record<string, string> = {
      x: 'crop left edge',
      y: 'crop top edge',
      width: 'crop width',
      height: 'crop height',
    };
    const maxima: Record<string, number> = {
      x: this.maxX,
      y: this.maxY,
      width: this.maxWidth,
      height: this.maxHeight,
    };
    return `${nouns[which]} ${this.box[which]} of ${round(maxima[which])} pixels`;
  };
  get xText(): string {
    return this.textFor('x');
  }
  get yText(): string {
    return this.textFor('y');
  }
  get widthText(): string {
    return this.textFor('width');
  }
  get heightText(): string {
    return this.textFor('height');
  }

  // ── mutation ───────────────────────────────────────────────────────────

  /** The one path into the crop box. Pointer drags arrive through Cropper's
   * `change` event; sliders arrive here; both end in the same clamp. */
  applyBox = (next: Partial<CropBox>): void => {
    const merged = { ...this.box, ...next };
    const width = Math.max(1, Math.min(merged.width, this.boundsWidth));
    const height = Math.max(1, Math.min(merged.height, this.boundsHeight));
    const x = Math.max(0, Math.min(merged.x, this.boundsWidth - width));
    const y = Math.max(0, Math.min(merged.y, this.boundsHeight - height));
    if (this.selection) {
      // $change emits the selection's `change` event synchronously, and that
      // handler already reads the box, so reading it here would report twice
      this.selection.$change(x, y, width, height);
    } else {
      this.readBox({ x, y, width, height });
    }
  };

  setField = (which: 'x' | 'y' | 'width' | 'height', event: Event): void => {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) {
      return;
    }
    this.applyBox({ [which]: value } as Partial<CropBox>);
  };

  setRatio = (value: number): void => {
    this.ratio = value;
    if (!this.selection) {
      return;
    }
    this.selection.aspectRatio = value;
    if (value > 0 && this.hasBox) {
      // Re-square the existing box rather than waiting for the next drag, so
      // pressing 1:1 visibly does something.
      const width = this.box.width;
      this.applyBox({ width, height: Math.round(width / value) });
    }
  };

  rotate = (degrees: number): void => {
    this.image?.$rotate(`${degrees}deg`);
  };
  flip = (axis: 'x' | 'y'): void => {
    if (axis === 'x') {
      this.image?.$scale(-1, 1);
    } else {
      this.image?.$scale(1, -1);
    }
  };
  resetAll = (): void => {
    this.image?.$resetTransform();
    this.image?.$center('contain');
    this.selection?.$reset();
    this.exported = '';
    this.exportError = '';
  };

  exportCrop = (): void => {
    const selection = this.selection;
    if (!selection || !this.hasBox) {
      return;
    }
    this.exportError = '';
    selection
      .$toCanvas()
      .then((canvas) => {
        // A data URL, not an object URL: nothing to revoke, so nothing to
        // leak when the component is torn down mid-export.
        this.exported = canvas.toDataURL('image/png');
        this.args.onExport?.(this.exported, this.box);
      })
      .catch((err: unknown) => {
        // A cross-origin image taints the canvas and `toDataURL` throws. That
        // is a real, common outcome and it gets a message, not a stack trace.
        this.exportError =
          err instanceof Error
            ? err.message
            : 'This image could not be exported — it may be cross-origin.';
      });
  };

  <template>
    <div class='pretui-crop' data-test-pretui-image-cropper ...attributes>
      <div class='pretui-crop-surface' style={{this.surfaceStyle}}>
        <cropper-canvas background {{cropperBounds this}}>
          <cropper-image
            src={{@src}}
            alt={{@alt}}
            rotatable
            scalable
            translatable
            {{cropperImage this}}
          ></cropper-image>
          <cropper-shade hidden></cropper-shade>
          <cropper-handle action='select' plain></cropper-handle>
          <cropper-selection
            initial-coverage='0.6'
            aspect-ratio={{this.ratioAttr}}
            movable
            resizable
            outlined
            {{cropperSelection this}}
          >
            <cropper-grid role='grid' bordered covered></cropper-grid>
            <cropper-crosshair centered></cropper-crosshair>
            <cropper-handle action='move' theme-color='rgba(255,255,255,0.35)'></cropper-handle>
            <cropper-handle action='n-resize'></cropper-handle>
            <cropper-handle action='e-resize'></cropper-handle>
            <cropper-handle action='s-resize'></cropper-handle>
            <cropper-handle action='w-resize'></cropper-handle>
            <cropper-handle action='ne-resize'></cropper-handle>
            <cropper-handle action='nw-resize'></cropper-handle>
            <cropper-handle action='se-resize'></cropper-handle>
            <cropper-handle action='sw-resize'></cropper-handle>
          </cropper-selection>
        </cropper-canvas>
      </div>

      <div class='pretui-crop-row' role='group' aria-label='Crop ratio'>
        {{#each this.ratios key='label' as |option|}}
          <button
            type='button'
            class='pretui-crop-chip'
            aria-pressed={{if (this.isRatio option.value) 'true' 'false'}}
            {{on 'click' (fn this.setRatio option.value)}}
          >{{option.label}}</button>
        {{/each}}
        {{#if this.showTransforms}}
          <span class='pretui-crop-spacer'></span>
          <button
            type='button'
            class='pretui-crop-chip'
            {{on 'click' (fn this.rotate -90)}}
          >Rotate ⟲</button>
          <button
            type='button'
            class='pretui-crop-chip'
            {{on 'click' (fn this.rotate 90)}}
          >Rotate ⟳</button>
          <button
            type='button'
            class='pretui-crop-chip'
            {{on 'click' (fn this.flip 'x')}}
          >Flip ⇄</button>
          <button
            type='button'
            class='pretui-crop-chip'
            {{on 'click' (fn this.flip 'y')}}
          >Flip ⇅</button>
          <button
            type='button'
            class='pretui-crop-chip'
            {{on 'click' this.resetAll}}
          >Reset</button>
        {{/if}}
      </div>

      {{! Four native range inputs — role='slider' with arrows, Shift, Page,
          Home and End already correct, and an aria-valuetext that reads as a
          sentence. This is the keyboard path Cropper's own `keyboard` mode
          would have taken from the whole document. }}
      <div class='pretui-crop-fields' role='group' aria-label={{this.label}}>
        <label class='pretui-crop-field'>
          <span class='pretui-crop-name'>Left</span>
          <input
            type='range'
            min='0'
            max={{this.maxX}}
            step='1'
            value={{this.box.x}}
            aria-valuetext={{this.xText}}
            {{on 'input' (fn this.setField 'x')}}
          />
          <span class='pretui-crop-num'>{{this.box.x}}</span>
        </label>
        <label class='pretui-crop-field'>
          <span class='pretui-crop-name'>Top</span>
          <input
            type='range'
            min='0'
            max={{this.maxY}}
            step='1'
            value={{this.box.y}}
            aria-valuetext={{this.yText}}
            {{on 'input' (fn this.setField 'y')}}
          />
          <span class='pretui-crop-num'>{{this.box.y}}</span>
        </label>
        <label class='pretui-crop-field'>
          <span class='pretui-crop-name'>Width</span>
          <input
            type='range'
            min='1'
            max={{this.maxWidth}}
            step='1'
            value={{this.box.width}}
            aria-valuetext={{this.widthText}}
            {{on 'input' (fn this.setField 'width')}}
          />
          <span class='pretui-crop-num'>{{this.box.width}}</span>
        </label>
        <label class='pretui-crop-field'>
          <span class='pretui-crop-name'>Height</span>
          <input
            type='range'
            min='1'
            max={{this.maxHeight}}
            step='1'
            value={{this.box.height}}
            aria-valuetext={{this.heightText}}
            {{on 'input' (fn this.setField 'height')}}
          />
          <span class='pretui-crop-num'>{{this.box.height}}</span>
        </label>
      </div>

      <div class='pretui-crop-foot'>
        <Token @value={{this.summary}} />
        <button
          type='button'
          class='pretui-crop-export'
          disabled={{this.exportDisabled}}
          {{on 'click' this.exportCrop}}
        >Export crop</button>
      </div>

      {{#if this.exportError}}
        <p class='pretui-crop-bad'>
          <span aria-hidden='true'>⚠</span>
          {{this.exportError}}
        </p>
      {{/if}}
      {{#if this.exported}}
        <figure class='pretui-crop-out'>
          <img src={{this.exported}} alt='The exported crop' />
          <figcaption>Exported {{this.summary}}</figcaption>
        </figure>
      {{/if}}
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-crop {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
        }
        .pretui-crop-surface {
          /* Reserved BEFORE the image decodes, so the toolbar below does not
             jump down the page when it lands. */
          height: var(--pretui-crop-h, 320px);
          border-radius: var(--radius);
          overflow: hidden;
          background: color-mix(
            in oklch,
            var(--foreground) 8%,
            var(--card)
          );
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
        }
        .pretui-crop-surface cropper-canvas {
          display: block;
          width: 100%;
          height: 100%;
        }
        .pretui-crop-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
        }
        .pretui-crop-spacer {
          flex: 1 1 12px;
        }
        .pretui-crop-chip {
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
        .pretui-crop-chip[aria-pressed='true'] {
          color: var(--primary-foreground);
          background: var(--primary);
        }
        .pretui-crop-chip:focus-visible,
        .pretui-crop-export:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-crop-fields {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px 14px;
        }
        @container (max-width: 460px) {
          .pretui-crop-fields {
            grid-template-columns: minmax(0, 1fr);
          }
        }
        .pretui-crop-field {
          display: grid;
          grid-template-columns: 46px minmax(0, 1fr) 40px;
          align-items: center;
          gap: 8px;
          font-size: var(--text-ui-xs, 10.5px);
          color: var(--muted-foreground);
        }
        .pretui-crop-field input {
          width: 100%;
          accent-color: var(--primary);
        }
        .pretui-crop-field input:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 3px;
        }
        .pretui-crop-name {
          font-weight: 600;
        }
        .pretui-crop-num {
          font-variant-numeric: tabular-nums;
          text-align: end;
          color: var(--foreground);
        }
        .pretui-crop-foot {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .pretui-crop-export {
          margin-inline-start: auto;
          padding: 4px 12px;
          border: 0;
          border-radius: 999px;
          font: inherit;
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 600;
          color: var(--primary-foreground);
          background: var(--primary);
          cursor: pointer;
        }
        .pretui-crop-export:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .pretui-crop-bad {
          display: flex;
          gap: 6px;
          margin: 0;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--pretui-destructive-ink, var(--boxel-danger));
        }
        .pretui-crop-out {
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .pretui-crop-out img {
          display: block;
          max-width: 220px;
          height: auto;
          border-radius: calc(var(--radius) - 4px);
          box-shadow: 0 0 0 1px var(--border);
        }
        .pretui-crop-out figcaption {
          font-size: var(--text-ui-xs, 10.5px);
          color: var(--muted-foreground);
        }
        .dark .pretui-crop-num {
          color: var(--foreground);
        }
        .dark .pretui-crop-chip {
          color: var(--foreground);
          background: color-mix(
            in oklch,
            var(--foreground) 10%,
            var(--card)
          );
        }
      }
    </style>
  </template>
}
