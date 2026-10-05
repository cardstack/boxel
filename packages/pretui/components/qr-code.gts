// Pretui — QrCode: a QR symbol rendered as one SVG path, with contrast and quiet-zone guards.
//
// Lineage. Two identical in-tree implementations already existed as a
// `FieldDef` — boxel-catalog's `fields/qr-code/qr-code.gts` and the
// `catalog-source` copy. What they got RIGHT and this component keeps:
//   * the config surface that actually gets used — foreground, background,
//     margin, and (implicitly) error-correction level;
//   * SVG output rather than canvas, so the symbol scales and prints;
//   * generation inside an ember-modifier rather than at module scope;
//   * a `data-test-qr-svg` hook, and a rendered fallback message when there
//     is no data instead of a silently empty box.
// What is fixed here:
//   * `import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm'`
//     is gone. A runtime fetch from a public CDN on every module load breaks
//     offline, hands a third party a code-execution seat inside the realm,
//     and pins us to their uptime. Same library, same version, vendored:
//     see `./qrcode/README.md`.
//   * No `innerHTML`, and no regex surgery on generated markup. The prior
//     version string-replaced `width=`/`height=` out of the library's SVG and
//     assigned the result to `innerHTML`; here the module matrix becomes one
//     `<path d=…>` bound as an ordinary Glimmer attribute, so no HTML is ever
//     assembled from a string.
//   * The quiet zone lives in the `viewBox`, not in CSS padding, so a caller
//     cannot style away the margin the symbol needs in order to scan (the
//     prior version accepted `margin: 0`, and stretched the symbol to 100 %
//     of whatever box it was in besides).
//   * The encoded value is available as selectable text or a real link. A QR
//     code that exists only as an image is unusable to anyone who is not
//     holding a second device.
//   * Error-correction level is settable, and rises to 'H' automatically when
//     an overlay occludes the centre.
//   * No modifier: the vendored encoder is pure and
//     DOM-free, so the matrix is a `@cached get` and the symbol is
//     declarative markup. Zero timers, zero observers, zero engine to dispose.
//
// THE THEMING TENSION, AND HOW IT IS RESOLVED. Pretui law says every colour
// flows through tokens so a season recompile re-dresses everything, with zero
// dark branches. Scanners require dark-on-light at high contrast, or the
// symbol does not decode. These cannot both win, so the boundary is drawn
// explicitly:
//
//   The SYMBOL is data, not chrome. Its two colours default to literal
//   #000000 on #ffffff — deliberately outside the token system — and a caller
//   override is accepted only as an opaque hex literal that passes a 3:1
//   contrast gate in the dark-on-light direction. `var(--foreground)` is
//   REFUSED, because its luminance is unknowable at render time and therefore
//   its scannability is unprovable. A rejected pair does not render: the
//   component falls back to black-on-white, stamps `data-contrast='rejected'`,
//   and says so in the caption. An unscannable themed QR code is worse than
//   an unthemed one.
//
//   Everything AROUND the symbol — plaque, hairline, caption, value, link,
//   error state — is fully tokenised and re-tints with the season. In a dark
//   theme the symbol therefore sits on a white plaque inside season-coloured
//   chrome, which is what every ticketing and banking app already does. There
//   are no dark branches in this file.
//
//   Bonus: because the only accepted colour form is `#rgb`/`#rrggbb`, no
//   caller string can ever reach a style declaration. The injection guard and
//   the scannability guard are the same guard.
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';

import { create as createQrRaw } from '../qrcode/index.js';

// ── public types ─────────────────────────────────────────────────────────

/** ISO/IEC 18004 error-correction levels: ~7 / 15 / 25 / 30 % recoverable. */
export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

/** How the encoded value is exposed as text beside the symbol. */
export type QrValueDisplay = 'auto' | 'link' | 'text' | 'none';

/** The minimum quiet zone the spec requires, in modules. Never goes lower. */
export const QR_MIN_QUIET_ZONE = 4;

/** Practical scanner floor. Below this, local binarisation is unreliable. */
export const QR_MIN_CONTRAST = 3;

export const QR_DEFAULT_FOREGROUND = '#000000';
export const QR_DEFAULT_BACKGROUND = '#ffffff';

interface QrModules {
  size: number;
  get(row: number, col: number): boolean;
}

/** The shape `qrcode`'s `create()` returns; see ./qrcode/README.md. */
export interface QrSymbol {
  modules: QrModules;
  version: number;
  maskPattern: number;
}

// The vendored bundle ships no types (it is a built artifact), so the single
// untyped boundary is asserted once, here, rather than leaking `any` outward.
const createQr = createQrRaw as (
  data: string,
  options?: { errorCorrectionLevel?: QrErrorCorrection },
) => QrSymbol;

/** Everything the component worked out, for callers and for tests. */
export interface QrRenderInfo {
  ok: boolean;
  error?: string;
  version?: number;
  moduleCount?: number;
  quietZone: number;
  errorCorrection: QrErrorCorrection;
  foreground: string;
  background: string;
  /** true when a caller colour pair was discarded for failing the gate */
  contrastRejected: boolean;
}

// ── validation helpers ───────────────────────────────────────────────────

/**
 * The ONLY accepted colour form for the symbol: an opaque hex literal.
 * Anything else — `var(…)`, `rgb(…)`, `color-mix(…)`, a named colour, an
 * 8-digit hex carrying alpha — returns undefined and the caller's value is
 * discarded. We must be able to compute a luminance, and a translucent module
 * does not binarise reliably.
 */
export function qrHexColor(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return '#' + raw[1] + raw[1] + raw[2] + raw[2] + raw[3] + raw[3];
  }
  return /^#[0-9a-f]{6}$/.test(raw) ? raw : undefined;
}

/** WCAG relative luminance of an `#rrggbb` literal. */
export function qrLuminance(hex: string): number {
  const channel = (start: number): number => {
    const v = parseInt(hex.slice(start, start + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio, 1…21. */
export function qrContrastRatio(a: string, b: string): number {
  const la = qrLuminance(a);
  const lb = qrLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function clampInt(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

/**
 * Only `http:` and `https:` become a real anchor. Everything else — including
 * `javascript:`, `data:`, and anything unparseable — renders as inert text.
 */
// a const, not an inline `!/…/` literal: content-tag misreads the negated
// form and drops the template
const HTTP_URL = /^https?:\/\//i;

export function qrSafeHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!HTTP_URL.test(trimmed)) return undefined;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The whole symbol as one path string, horizontal runs merged — two SVG
 * elements total whatever the version, and every module edge lands on an
 * integer so `shape-rendering: crispEdges` is honest. Exported because it is
 * the piece worth unit-testing against a known matrix.
 */
export function qrPathData(modules: QrModules, quietZone: number): string {
  const n = modules.size;
  const parts: string[] = [];
  for (let row = 0; row < n; row++) {
    let runStart = -1;
    for (let col = 0; col <= n; col++) {
      const dark = col < n && modules.get(row, col);
      if (dark && runStart < 0) {
        runStart = col;
      } else if (!dark && runStart >= 0) {
        const run = col - runStart;
        parts.push(
          'M' +
            (runStart + quietZone) +
            ' ' +
            (row + quietZone) +
            'h' +
            run +
            'v1h-' +
            run +
            'z',
        );
        runStart = -1;
      }
    }
  }
  return parts.join('');
}

// ── the @onRender channel ────────────────────────────────────────────────
//
// A getter with a side effect would re-report on every recompute and invite a
// backtracking assertion, so the callback is delivered from a modifier that
// takes ONLY primitives plus one stable arrow (the shape the realm's
// modifier-tracking-loop trap requires). The primitives are exactly the
// values that can change what was rendered, so the callback fires once per
// genuine change and never per render.
const reportQr = modifier(
  (
    _element: HTMLElement,
    [report]: [
      () => void,
      boolean,
      number,
      string,
      string,
      string,
      boolean,
      number,
    ],
  ) => {
    report();
  },
);

export interface QrCodeSignature {
  Args: {
    /** the payload to encode — a URL, an id, a vCard, anything under ~2 KB */
    value?: string;
    /**
     * accessible name for the symbol itself. Defaults to 'QR code'; the
     * encoded value is exposed separately as text or a link, so repeating it
     * here is usually noise.
     */
    label?: string;
    /**
     * ISO/IEC 18004 error-correction level — 'M' by default. Forced to 'H'
     * whenever @overlay is set, because an overlay occludes modules.
     */
    errorCorrection?: QrErrorCorrection;
    /**
     * quiet zone in modules. Clamped to [4, 16]: 4 is the spec minimum and
     * codes fail to scan below it, so this widens the margin, never removes
     * it.
     */
    margin?: number;
    /** rendered edge length in px. Clamped to [64, 1024], default 180. */
    size?: number;
    /** dark modules. Opaque hex only — see the theming note in the header. */
    foreground?: string;
    /** light modules. Opaque hex only — see the theming note in the header. */
    background?: string;
    /**
     * how the encoded value appears as text — 'auto' (default) renders an
     * anchor for http(s) values and selectable code text otherwise; 'link'
     * and 'text' force one; 'none' keeps it visually hidden but still in the
     * accessibility tree. It is never removed outright.
     */
    valueDisplay?: QrValueDisplay;
    /** caption text under the symbol; the <:caption> block wins over it */
    caption?: string;
    /**
     * declares that an <:overlay> mark is being supplied. Named blocks are
     * not visible from component JS, so this flag is what raises the
     * error-correction level to 'H' and reserves the centre — and the
     * <:overlay> block renders ONLY when it is set, so forgetting it makes
     * the overlay visibly vanish rather than silently producing an
     * unscannable code. The occluded area is capped at 20 % of the symbol's
     * edge (~4 % of its area), well inside level H's ~30 % budget.
     */
    overlay?: boolean;
    /** called with what was actually rendered, once per meaningful change */
    onRender?: (info: QrRenderInfo) => void;
  };
  Blocks: {
    /** replaces @caption */
    caption?: [];
    /** a mark centred over the symbol; requires @overlay={{true}} */
    overlay?: [];
  };
  Element: HTMLElement;
}

const ECL: QrErrorCorrection[] = ['L', 'M', 'Q', 'H'];

export class QrCode extends Component<QrCodeSignature> {
  get value(): string {
    return typeof this.args.value === 'string' ? this.args.value.trim() : '';
  }

  /** An overlay occludes modules, so it forces the strongest level. */
  get errorCorrection(): QrErrorCorrection {
    if (this.args.overlay) return 'H';
    const requested = this.args.errorCorrection;
    return requested && ECL.includes(requested) ? requested : 'M';
  }

  get quietZone(): number {
    return clampInt(this.args.margin, QR_MIN_QUIET_ZONE, 16, QR_MIN_QUIET_ZONE);
  }

  get pixelSize(): number {
    return clampInt(this.args.size, 64, 1024, 180);
  }

  /**
   * The colour decision, in one place: the pair actually used, plus whether a
   * caller pair was thrown away for failing the gate.
   */
  @cached
  get colors(): { foreground: string; background: string; rejected: boolean } {
    const askedFg = this.args.foreground;
    const askedBg = this.args.background;
    const safe = {
      foreground: QR_DEFAULT_FOREGROUND,
      background: QR_DEFAULT_BACKGROUND,
      rejected: false,
    };
    if (askedFg === undefined && askedBg === undefined) return safe;

    const fg = qrHexColor(askedFg);
    const bg = qrHexColor(askedBg);
    const unparseable =
      (askedFg !== undefined && fg === undefined) ||
      (askedBg !== undefined && bg === undefined);
    const wantFg = fg ?? QR_DEFAULT_FOREGROUND;
    const wantBg = bg ?? QR_DEFAULT_BACKGROUND;
    const darkOnLight = qrLuminance(wantFg) < qrLuminance(wantBg);
    const enough = qrContrastRatio(wantFg, wantBg) >= QR_MIN_CONTRAST;

    if (unparseable || !darkOnLight || !enough) {
      return { ...safe, rejected: true };
    }
    return { foreground: wantFg, background: wantBg, rejected: false };
  }

  /**
   * The encode. `create()` is pure and DOM-free (see ./qrcode/README.md), so
   * it is legal in a getter — no modifier, no timer, nothing to dispose. It
   * throws on overflow and on empty input, so both are caught here.
   */
  @cached
  get result(): { ok: true; symbol: QrSymbol } | { ok: false; error: string } {
    if (!this.value) return { ok: false, error: 'No value to encode.' };
    try {
      return {
        ok: true,
        symbol: createQr(this.value, {
          errorCorrectionLevel: this.errorCorrection,
        }),
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  get isOk(): boolean {
    return this.result.ok;
  }

  get errorMessage(): string {
    return this.result.ok ? '' : this.result.error;
  }

  get version(): number {
    return this.result.ok ? this.result.symbol.version : 0;
  }

  get moduleCount(): number {
    return this.result.ok ? this.result.symbol.modules.size : 0;
  }

  /** Symbol edge plus a quiet zone on both sides, in module units. */
  get viewBox(): string {
    const n = this.moduleCount + this.quietZone * 2;
    return '0 0 ' + n + ' ' + n;
  }

  @cached
  get path(): string {
    return this.result.ok
      ? qrPathData(this.result.symbol.modules, this.quietZone)
      : '';
  }

  get accessibleName(): string {
    return this.args.label ?? 'QR code';
  }

  get valueDisplay(): QrValueDisplay {
    const requested = this.args.valueDisplay;
    return requested === 'link' || requested === 'text' || requested === 'none'
      ? requested
      : 'auto';
  }

  get href(): string | undefined {
    if (this.valueDisplay === 'none' || this.valueDisplay === 'text') {
      return undefined;
    }
    return qrSafeHref(this.value);
  }

  /** Selectable text is the fallback whenever an anchor is not appropriate. */
  get showsText(): boolean {
    return Boolean(this.value) && this.valueDisplay !== 'none' && !this.href;
  }

  /** Never removed outright — hidden means visually hidden, not absent. */
  get showsHiddenValue(): boolean {
    return Boolean(this.value) && this.valueDisplay === 'none';
  }

  /** Clamped integer, so no caller string ever reaches a style declaration. */
  get sizeStyle(): ReturnType<typeof htmlSafe> {
    return htmlSafe('--pretui-qr-size:' + this.pixelSize + 'px');
  }

  get contrastState(): string | undefined {
    return this.colors.rejected ? 'rejected' : undefined;
  }

  get info(): QrRenderInfo {
    return {
      ok: this.isOk,
      error: this.isOk ? undefined : this.errorMessage,
      version: this.isOk ? this.version : undefined,
      moduleCount: this.isOk ? this.moduleCount : undefined,
      quietZone: this.quietZone,
      errorCorrection: this.errorCorrection,
      foreground: this.colors.foreground,
      background: this.colors.background,
      contrastRejected: this.colors.rejected,
    };
  }

  report = () => {
    this.args.onRender?.(this.info);
  };

  <template>
    <figure
      class='pretui-qr'
      style={{this.sizeStyle}}
      data-state={{if this.isOk 'ok' 'error'}}
      data-ecl={{this.errorCorrection}}
      data-quiet-zone={{this.quietZone}}
      data-contrast={{this.contrastState}}
      data-test-pretui-qr-code
      {{reportQr
        this.report
        this.isOk
        this.moduleCount
        this.errorCorrection
        this.colors.foreground
        this.colors.background
        this.colors.rejected
        this.quietZone
      }}
      ...attributes
    >
      <div class='pretui-qr-plaque' data-test-pretui-qr-plaque>
        {{#if this.isOk}}
          <svg
            class='pretui-qr-svg'
            viewBox={{this.viewBox}}
            role='img'
            aria-label={{this.accessibleName}}
            shape-rendering='crispEdges'
            data-test-pretui-qr-svg
          >
            <rect
              width='100%'
              height='100%'
              fill={{this.colors.background}}
              data-test-pretui-qr-quiet-zone
            />
            <path d={{this.path}} fill={{this.colors.foreground}} />
          </svg>
          {{#if @overlay}}
            <span
              class='pretui-qr-overlay'
              aria-hidden='true'
              data-test-pretui-qr-overlay
            >{{yield to='overlay'}}</span>
          {{/if}}
        {{else}}
          <p class='pretui-qr-error' data-test-pretui-qr-error>
            {{this.errorMessage}}
          </p>
        {{/if}}
      </div>

      <figcaption class='pretui-qr-caption'>
        {{#if this.href}}
          <a
            class='pretui-qr-value'
            href={{this.href}}
            data-test-pretui-qr-value
          >{{this.value}}</a>
        {{else if this.showsText}}
          <code
            class='pretui-qr-value'
            data-test-pretui-qr-value
          >{{this.value}}</code>
        {{else if this.showsHiddenValue}}
          <span
            class='pretui-sr'
            data-test-pretui-qr-value
          >{{this.value}}</span>
        {{/if}}

        {{#if (has-block 'caption')}}
          <span class='pretui-qr-note'>{{yield to='caption'}}</span>
        {{else if @caption}}
          <span class='pretui-qr-note'>{{@caption}}</span>
        {{/if}}

        {{#if this.colors.rejected}}
          <span
            class='pretui-qr-warning'
            role='status'
            data-test-pretui-qr-contrast-warning
          >Requested colours were rejected — a QR symbol must be dark on light
            at
            {{QR_MIN_CONTRAST}}:1 or better. Rendered black on white so it
            still scans.</span>
        {{/if}}
      </figcaption>
    </figure>

    <style scoped>
      @layer PretComponent {
        /* Chrome is fully tokenised and re-tints with the season. The symbol
           inside the plaque deliberately is not — see the file header. */
        .pretui-qr {
          --pretui-qr-size: 180px;
          --pretui-qr-gap: var(--space-3, 8px);
          --pretui-qr-plaque-padding: var(--space-3, 8px);
          --pretui-qr-radius: var(--radius);
          margin: 0;
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          gap: var(--pretui-qr-gap);
          max-width: 100%;
        }
        .pretui-qr-plaque {
          position: relative;
          width: var(--pretui-qr-size);
          max-width: 100%;
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--pretui-qr-plaque-padding);
          border-radius: var(--pretui-qr-radius);
          /* White because the symbol is: the light modules and the quiet zone
             must read as one continuous field to a scanner. */
          background: var(--pretui-qr-plaque, var(--boxel-light));
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
        }
        .pretui-qr-svg {
          display: block;
          width: 100%;
          height: 100%;
        }
        .pretui-qr-overlay {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          /* Capped well inside level H's ~30 % recovery budget. */
          width: min(20%, calc(var(--pretui-qr-size) * 0.2));
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          padding: 2px;
          border-radius: 3px;
          background: var(--pretui-qr-plaque, var(--boxel-light));
        }
        .pretui-qr-error {
          margin: 0;
          padding: var(--space-3, 8px);
          text-align: center;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--pretui-destructive-ink, var(--boxel-danger));
        }
        .pretui-qr-caption {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-2, 5px);
          max-width: var(--pretui-qr-size);
          text-align: center;
        }
        .pretui-qr-value {
          font-family: var(--font-mono);
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--foreground);
          overflow-wrap: anywhere;
          user-select: all;
        }
        a.pretui-qr-value {
          color: var(--pretui-primary-ink, var(--boxel-highlight-hover));
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        a.pretui-qr-value:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
          border-radius: 2px;
        }
        .pretui-qr-note {
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        .pretui-qr-warning {
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--pretui-destructive-ink, var(--boxel-danger));
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

export default QrCode;
