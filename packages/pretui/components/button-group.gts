// Pretui — ButtonGroup: related Buttons fused into one visual unit.
import Component from '@glimmer/component';
import type {
  PretuiAppearance,
  PretuiSize,
  PretuiTone,
} from '../pretui-primitives';

// Transcribed from wa-button-group: related Pretui Buttons fused into one
// visual unit — role='group' with a strongly-recommended label, horizontal
// or vertical orientation, inner corners squared and adjacent hairlines
// collapsed to one (the -1px overlap; hover/focus raise z-index so the
// full ring of the active button always draws on top, WA's stacking rule).
// Children are plain <Button>s and need NO args: the group's @tone rides
// the same custom-prop channel Button's recipes already read (each rule
// re-points --pretui-tone/--pretui-tone-on; the neutral-only vars reset to
// `initial` so recipe fallbacks re-engage), while @appearance restates the
// five recipe declarations at group specificity — appearance recipes are
// attribute-selected in Button, so they cannot travel as inherited props;
// the formulas are copied verbatim from controls.gts and read the same
// tone vars. Dropped (wave-0): WA's slotted radio-button support and its
// focus/hover class relay (CSS handles both here).

export interface ButtonGroupSignature {
  Args: {
    /** group label for assistive tech — strongly recommended (WA note) */
    label?: string;
    orientation?: 'horizontal' | 'vertical';
    /** tone inherited by every child Button via the custom-prop channel */
    tone?: PretuiTone;
    /** appearance recipe applied to every child Button */
    appearance?: PretuiAppearance;
    /** size (font-size scale) applied to every child Button */
    size?: PretuiSize;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export class ButtonGroup extends Component<ButtonGroupSignature> {
  get orientation() {
    return this.args.orientation ?? 'horizontal';
  }
  <template>
    {{! template-lint-disable no-unsupported-role-attributes }}
    <div
      class='pretui-btngroup'
      role='group'
      aria-label={{@label}}
      aria-orientation={{this.orientation}}
      data-orientation={{this.orientation}}
      data-tone={{@tone}}
      data-appearance={{@appearance}}
      data-size={{@size}}
      data-test-pretui-button-group
      ...attributes
    >
      {{yield}}
    </div>
    <style scoped>
      .pretui-btngroup {
        display: inline-flex;
        position: relative;
        isolation: isolate;
      }
      .pretui-btngroup[data-orientation='vertical'] {
        flex-direction: column;
        align-items: stretch;
      }
      .pretui-btngroup :deep(.pretui-btn) {
        position: relative;
      }
      /* hover / focus / active ring draws on top of the shared hairline */
      .pretui-btngroup :deep(.pretui-btn:hover) {
        z-index: 1;
      }
      .pretui-btngroup :deep(.pretui-btn:focus-visible) {
        z-index: 2;
      }
      /* attach: square the inner corners, overlap the hairlines by 1px so
         adjacent rings collapse into one shared line */
      .pretui-btngroup[data-orientation='horizontal'] :deep(.pretui-btn:not(:first-child)) {
        margin-left: -1px;
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
      }
      .pretui-btngroup[data-orientation='horizontal'] :deep(.pretui-btn:not(:last-child)) {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
      }
      .pretui-btngroup[data-orientation='vertical'] :deep(.pretui-btn:not(:first-child)) {
        margin-top: -1px;
        border-top-left-radius: 0;
        border-top-right-radius: 0;
      }
      .pretui-btngroup[data-orientation='vertical'] :deep(.pretui-btn:not(:last-child)) {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
      }
      /* ── tone inheritance: re-point the channel Button's recipes read.
         The neutral-only vars reset to `initial` (guaranteed-invalid) so
         var() fallbacks re-engage for hue tones. ── */
      .pretui-btngroup[data-tone] :deep(.pretui-btn[data-tone]) {
        --pretui-btn-hairline: initial;
        --pretui-btn-shadow: initial;
        --pretui-btn-ink: initial;
        --pretui-btn-ink-quiet: initial;
      }
      .pretui-btngroup[data-tone='neutral'] :deep(.pretui-btn[data-tone]) {
        --pretui-tone: var(--foreground);
        --pretui-tone-on: var(--pretui-on-neutral, var(--background));
        --pretui-btn-hairline: var(--border);
        --pretui-btn-shadow: var(--pretui-shadow-control, 0 0 0 1px var(--border));
        --pretui-btn-ink: var(--foreground);
        --pretui-btn-ink-quiet: var(--muted-foreground);
      }
      .pretui-btngroup[data-tone='primary'] :deep(.pretui-btn[data-tone]) {
        --pretui-tone: var(--primary);
        --pretui-tone-on: var(--primary-foreground);
      }
      .pretui-btngroup[data-tone='info'] :deep(.pretui-btn[data-tone]) {
        --pretui-tone: var(--pretui-info, var(--boxel-blue));
        --pretui-tone-on: var(--pretui-on-info, var(--background));
      }
      .pretui-btngroup[data-tone='success'] :deep(.pretui-btn[data-tone]) {
        --pretui-tone: var(--success, var(--boxel-success));
        --pretui-tone-on: var(--pretui-on-success, var(--background));
      }
      .pretui-btngroup[data-tone='warning'] :deep(.pretui-btn[data-tone]) {
        --pretui-tone: var(--warning, var(--boxel-warning));
        --pretui-tone-on: var(--pretui-on-warning, var(--background));
      }
      .pretui-btngroup[data-tone='danger'] :deep(.pretui-btn[data-tone]) {
        --pretui-tone: var(--destructive);
        --pretui-tone-on: var(--destructive-foreground);
      }
      .pretui-btngroup[data-tone='attention'] :deep(.pretui-btn[data-tone]) {
        --pretui-tone: var(--pretui-attention, var(--boxel-fuschia));
        --pretui-tone-on: var(--pretui-on-attention, var(--background));
      }
      /* ── appearance inheritance: recipes restated at group specificity,
         formulas verbatim from controls.gts (they read the tone vars) ── */
      .pretui-btngroup[data-appearance='accent'] :deep(.pretui-btn[data-appearance]) {
        background: var(--pretui-button-bg, var(--pretui-tone));
        color: var(--pretui-button-fg, var(--pretui-tone-on));
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--pretui-button-bg, var(--pretui-tone)) 70%, var(--border)),
          var(--pretui-edge-highlight, inset 0 1px 0 rgb(255 255 255 / 0.14)),
          0 1px 2px var(--shadow-ink-mid, rgb(0 0 0 / 0.08));
      }
      .pretui-btngroup[data-appearance='accent'] :deep(.pretui-btn[data-appearance]:hover:not(:disabled)) {
        background: color-mix(in oklch, var(--foreground) 10%, var(--pretui-button-bg, var(--pretui-tone)));
      }
      .pretui-btngroup[data-appearance='filled'] :deep(.pretui-btn[data-appearance]) {
        background: color-mix(in oklch, var(--pretui-tone) 15%, var(--card));
        color: var(--pretui-btn-ink, color-mix(in oklch, var(--pretui-tone) 60%, var(--foreground)));
        box-shadow: none;
      }
      .pretui-btngroup[data-appearance='filled'] :deep(.pretui-btn[data-appearance]:hover:not(:disabled)) {
        background: color-mix(in oklch, var(--pretui-tone) 22%, var(--card));
      }
      .pretui-btngroup[data-appearance='outlined'] :deep(.pretui-btn[data-appearance]) {
        background: var(--pretui-button-secondary-bg, var(--card));
        color: var(--pretui-btn-ink, color-mix(in oklch, var(--pretui-tone) 55%, var(--foreground)));
        box-shadow: var(--pretui-btn-shadow, 0 0 0 1px color-mix(in oklch, var(--pretui-tone) 45%, var(--border)));
      }
      .pretui-btngroup[data-appearance='outlined'] :deep(.pretui-btn[data-appearance]:hover:not(:disabled)) {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-btngroup[data-appearance='filled-outlined'] :deep(.pretui-btn[data-appearance]) {
        background: color-mix(in oklch, var(--pretui-tone) 12%, var(--card));
        color: var(--pretui-btn-ink, color-mix(in oklch, var(--pretui-tone) 60%, var(--foreground)));
        box-shadow: 0 0 0 1px var(--pretui-btn-hairline, color-mix(in oklch, var(--pretui-tone) 40%, var(--border)));
      }
      .pretui-btngroup[data-appearance='filled-outlined'] :deep(.pretui-btn[data-appearance]:hover:not(:disabled)) {
        background: color-mix(in oklch, var(--pretui-tone) 20%, var(--card));
      }
      .pretui-btngroup[data-appearance='plain'] :deep(.pretui-btn[data-appearance]) {
        background: transparent;
        color: var(--pretui-btn-ink-quiet, color-mix(in oklch, var(--pretui-tone) 40%, var(--muted-foreground)));
        box-shadow: none;
      }
      .pretui-btngroup[data-appearance='plain'] :deep(.pretui-btn[data-appearance]:hover:not(:disabled)) {
        background: var(--hover, var(--boxel-100));
        color: var(--pretui-btn-ink, color-mix(in oklch, var(--pretui-tone) 30%, var(--foreground)));
      }
      /* ── size inheritance: font-size only, Button's own em scale rides ── */
      .pretui-btngroup[data-size='xs'] :deep(.pretui-btn[data-size]) {
        font-size: var(--pretui-size-xs, var(--text-ui-xs, 0.66rem));
      }
      .pretui-btngroup[data-size='s'] :deep(.pretui-btn[data-size]) {
        font-size: var(--pretui-size-s, var(--text-ui-sm, 0.72rem));
      }
      .pretui-btngroup[data-size='m'] :deep(.pretui-btn[data-size]) {
        font-size: var(--pretui-size-m, var(--text-ui-md, 0.78rem));
      }
      .pretui-btngroup[data-size='l'] :deep(.pretui-btn[data-size]) {
        font-size: var(--pretui-size-l, var(--text-ui-lg, 0.875rem));
      }
      .pretui-btngroup[data-size='xl'] :deep(.pretui-btn[data-size]) {
        font-size: var(--pretui-size-xl, var(--text-ui-xl, 1rem));
      }
    </style>
  </template>
}
