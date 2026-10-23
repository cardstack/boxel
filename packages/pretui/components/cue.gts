// Pretui — Cue: the signage primitive behind Field's label and message line.
import Component from '@glimmer/component';
import { guidFor } from '@ember/object/internals';
import { resolveTone } from '../pretui-primitives';
import type { PretuiToneArg } from '../pretui-primitives';

// ── Cue ──────────────────────────────────────────────────────────────────
// The signage primitive behind Field's label and message line, extracted so
// anything else that needs a caption beside a control can have the same one.
// Contracted as kind × position × tone, in LOGICAL properties throughout, so
// RTL is free and `inline-start` means the reading start rather than "left".
//
// Sketched from boxel-surface's orphaned `Accessory` (exported with three
// aliases and zero consumers anywhere in that package — mined as a design,
// not as proven code). Three things fixed on the way in:
//   · its colors lived in a separate global stylesheet the component did
//     not ship, so it rendered unstyled unless the host imported one. This
//     carries its own `<style scoped>` and reads only tokens.
//   · its four tones differed ONLY by hex — no glyph, no text prefix — which
//     is color-only signaling. Every non-neutral tone here also carries a
//     glyph, so it survives grayscale.
//   · its generated id silently collided when two accessories shared a
//     `labelFor` and a `kind`. Here the id is per-instance and unique, and
//     `@id` is how a caller pins a value it needs to reference.
//
// The governing rule, kept from the source: accessories do NOT register as
// surfaces. They are chrome — no card face, no elevation, no border of their
// own.
export type CueKind = 'label' | 'description' | 'status' | 'error';
export type CuePosition =
  | 'block-start'
  | 'block-end'
  | 'inline-start'
  | 'inline-end';
export type CueTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export const CUE_TONES: readonly CueTone[] = [
  'neutral',
  'info',
  'success',
  'warning',
  'danger',
];

const CUE_GLYPHS: Record<CueTone, string> = {
  neutral: '',
  info: 'i',
  success: '✓',
  warning: '!',
  danger: '✕',
};

export interface CueSignature {
  Args: {
    /** 'description' (default) captions; 'status' announces politely when it
     * changes; 'error' is a description in the danger tone; 'label' names. */
    kind?: CueKind;
    /** which logical edge of the control this cue sits on */
    position?: CuePosition;
    /** accepts the React tone spellings — `destructive`/`error` → danger,
     * `positive` → success, `notice` → warning */
    tone?: CueTone | PretuiToneArg;
    /** literal text; the block is the slot when a cue needs markup */
    text?: string;
    /** Pin the cue's id so an external control can `aria-describedby` it.
     * Otherwise the id is per-instance and unique. */
    id?: string;
    /** purely decorative — hidden from assistive tech entirely */
    decorative?: boolean;
    /** false drops the tone glyph, for a caller whose control already
     * shows the tone */
    glyph?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

export class Cue extends Component<CueSignature> {
  get kind(): CueKind {
    return this.args.kind ?? 'description';
  }
  get tone(): CueTone {
    return resolveTone(
      this.args.tone,
      CUE_TONES,
      this.kind === 'error' ? 'danger' : 'neutral',
    );
  }
  get cueId() {
    return this.args.id ?? `${guidFor(this)}-cue`;
  }
  get glyph() {
    return this.args.glyph === false ? undefined : CUE_GLYPHS[this.tone];
  }
  // Held in getters rather than written as `{{if}}` literals in the template:
  // ember-template-lint validates a literal `role` and would reject the
  // branch that renders no role at all.
  get role() {
    return this.kind === 'status' ? 'status' : undefined;
  }
  get live() {
    return this.kind === 'status' ? 'polite' : undefined;
  }
  <template>
    <span
      class='pretui-cue'
      id={{this.cueId}}
      data-kind={{this.kind}}
      data-position={{if @position @position 'block-end'}}
      data-tone={{this.tone}}
      role={{this.role}}
      aria-live={{this.live}}
      aria-hidden={{if @decorative 'true'}}
      data-test-pretui-cue
      ...attributes
    >
      {{#if this.glyph}}<span
          class='pretui-cue-glyph'
          aria-hidden='true'
        >{{this.glyph}}</span>{{/if}}
      {{#if @text}}{{@text}}{{else}}{{yield}}{{/if}}
    </span>
    <style scoped>
      @layer PretComponent {
        /* chrome, never a surface: no background, no elevation, no border */
        /* the message size matches Input's helper and error rows; the 1rem
           line-height is the row Field reserves for it */
        .pretui-cue {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          min-width: 0;
          font-size: var(--boxel-font-size-2xs);
          line-height: 1rem;
          color: var(--muted-foreground);
        }
        /* a tone's text is its -ink; its glyph is the fill with the paired
           -foreground */
        .pretui-cue[data-tone='info'] {
          color: var(--info-ink);
          --pretui-cue-fill: var(--info);
          --pretui-cue-on-fill: var(--info-foreground);
        }
        .pretui-cue[data-tone='success'] {
          color: var(--success-ink);
          --pretui-cue-fill: var(--success);
          --pretui-cue-on-fill: var(--success-foreground);
        }
        .pretui-cue[data-tone='warning'] {
          color: var(--warning-ink);
          --pretui-cue-fill: var(--warning);
          --pretui-cue-on-fill: var(--warning-foreground);
        }
        .pretui-cue[data-tone='danger'] {
          color: var(--destructive-ink);
          --pretui-cue-fill: var(--destructive);
          --pretui-cue-on-fill: var(--destructive-foreground);
        }
        .pretui-cue[data-kind='label'] {
          font-size: var(--boxel-ui-label-font-size);
          font-weight: var(--boxel-ui-label-font-weight);
          line-height: var(--boxel-ui-label-line-height);
          color: var(--foreground);
        }
        .pretui-cue[data-kind='error'],
        .pretui-cue[data-tone='danger']:not([data-kind='label']) {
          font-weight: 500;
        }
        /* the second, non-color channel the source lacked */
        .pretui-cue-glyph {
          display: inline-grid;
          place-items: center;
          inline-size: 1.1em;
          block-size: 1.1em;
          flex: none;
          border-radius: 50%;
          font-size: 0.75em;
          font-weight: 700;
          background-color: var(--pretui-cue-fill);
          color: var(--pretui-cue-on-fill);
        }
        /* logical edges: the inline pair sit on the control's reading start /
           end, the block pair above / below. RTL comes free. */
        .pretui-cue[data-position='inline-start'] {
          margin-inline-end: var(--boxel-sp-2xs);
        }
        .pretui-cue[data-position='inline-end'] {
          margin-inline-start: var(--boxel-sp-2xs);
        }
        .pretui-cue[data-position='block-start'] {
          margin-block-end: var(--boxel-sp-4xs);
        }
      }
    </style>
  </template>
}

