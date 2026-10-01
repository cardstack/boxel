// Pretui — SwatchChip: a small colour chip with its value.
import Component from '@glimmer/component';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { clamp, cssFor, parseColor, round } from '../color-engine';
import type { ColorValue } from '../color-engine';

// ── SwatchChip ───────────────────────────────────────────────────────────

/**
 * The chip face alone — a `<span>`, no semantics, no tab stop.
 *
 * Extracted because a colour chip appears in two structurally different
 * places: as the whole of an interactive `Swatch`, and as decoration INSIDE
 * someone else's button (the `ColorField` trigger, a gradient stop row).
 * Putting a `<button>` inside a `<button>` is invalid HTML and a real
 * keyboard trap — realm lint rejects it as `no-nested-interactive`, and
 * `tabindex='-1'` on the inner one is a workaround, not a fix. One
 * presentational primitive, used by both, is the fix.
 */
export interface SwatchChipSignature {
  Args: {
    /** Any CSS colour. Parsed and re-serialized before it reaches the style
     *  attribute — the caller's characters never survive. */
    color: string;
    shape?: 'round' | 'square';
    /** Chip size in px. Defaults to the `--pretui-swatch-size` token. */
    size?: number;
  };
  Element: HTMLSpanElement;
}

export class SwatchChip extends Component<SwatchChipSignature> {
  get parsed(): ColorValue | null {
    return parseColor(this.args.color);
  }
  get chipStyle() {
    // `@color` is caller text, so it goes through the STRONGER guard first:
    // `cssFor` parses it with the colour engine and re-serializes a string
    // built from numbers, so the caller's characters cannot survive. The
    // shared allowlist is the second line of defence.
    return cssStyleFrom([
      cssDeclaration('--pretui-swatch-color', cssFor(this.args.color)),
      this.args.size
        ? '--pretui-swatch-size: ' + round(clamp(this.args.size, 1, 512), 0) + 'px'
        : undefined,
    ]);
  }
  <template>
    <span
      class='pretui-swatch-chip'
      data-shape={{if @shape @shape 'round'}}
      data-empty={{unless this.parsed 'true'}}
      style={{this.chipStyle}}
      ...attributes
    ></span>
    <style scoped>
      .pretui-swatch-chip {
        display: inline-block;
        width: var(--pretui-swatch-size, 18px);
        height: var(--pretui-swatch-size, 18px);
        border-radius: 50%;
        /* the checker sits UNDER the colour so alpha is legible — a solid
           chip for a 40%-opaque colour is a lie the eye cannot catch */
        background:
          var(--pretui-swatch-color, transparent),
          var(
            --pretui-checker,
            repeating-conic-gradient(
              color-mix(in oklch, var(--foreground) 11%, transparent) 0 25%,
              transparent 0 50%
            )
          );
        background-size: cover, 8px 8px;
        box-shadow: inset 0 0 0 1px
          color-mix(in oklch, var(--foreground) 14%, transparent);
        flex: none;
        transition: transform 120ms ease;
      }
      .pretui-swatch-chip[data-shape='square'] {
        border-radius: calc(var(--radius) / 2.5);
      }
      .pretui-swatch-chip[data-empty='true'] {
        background:
          linear-gradient(
              to bottom right,
              transparent calc(50% - 1px),
              var(--destructive) calc(50% - 1px),
              var(--destructive) calc(50% + 1px),
              transparent calc(50% + 1px)
            ),
          var(--field, var(--boxel-light));
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-swatch-chip {
          transition: none;
        }
      }
    </style>
  </template>
}
