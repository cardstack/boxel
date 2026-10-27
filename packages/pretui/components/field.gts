// Pretui — Field: label[for] + reserved message line so side-by-side fields
// never shift when an error appears (alignment law).
import Component from '@glimmer/component';
import { guidFor } from '@ember/object/internals';
import { firstDefined, resolveTone } from '../pretui-primitives';
import type { PretuiToneArg } from '../pretui-primitives';
import { Cue, CUE_TONES } from './cue';
import type { CueKind, CueTone } from './cue';

export interface FieldSignature {
  Args: {
    label?: string;
    hint?: string;
    error?: string;
    /** aliases for @hint — shadcn/Aria/Chakra `description`, MUI
     * `helperText`. Slots still win when the caption needs markup. */
    description?: string;
    helperText?: string;
    /** alias for @error — the React Aria / shadcn Field spelling */
    errorMessage?: string;
    /**
     * A polite, transient status for the field — "Checking availability…",
     * "Saved". Ranks between error and hint, rides the reserved message line
     * so nothing moves, and announces itself when it changes.
     */
    status?: string;
    /** tone for that status line (default 'info') */
    statusTone?: CueTone | PretuiToneArg;
  };
  Blocks: {
    /** the control. Second param is the id of the message line, for
     * `aria-describedby` on a control that does not take it automatically. */
    default: [controlId: string, describedBy: string];
    /** cue accessory at the reading start of the control row */
    inlineStart: [];
    /** cue accessory at the reading end of the control row */
    inlineEnd: [];
  };
  Element: HTMLDivElement;
}

// THE wrapper every input needs: label[for] + reserved message line so
// side-by-side fields never shift when an error appears (alignment law).
//
// The message line is a `Cue`, so its tone sets the color and a status
// announces itself. Its glyph keeps the tone from being color alone.
// `<:inlineStart>` / `<:inlineEnd>` hold accessories at the LOGICAL edges of
// the control row (a currency prefix, a unit suffix, a verified tick). The
// message line's id is the block's second param, so a control can point
// `aria-describedby` at it.
export class Field extends Component<FieldSignature> {
  get controlId() {
    return `${guidFor(this)}-ctl`;
  }
  get messageId() {
    return `${guidFor(this)}-msg`;
  }
  get error() {
    return firstDefined(this.args.error, this.args.errorMessage);
  }
  get hint() {
    return firstDefined(
      this.args.hint,
      this.args.description,
      this.args.helperText,
    );
  }
  get messageKind(): CueKind {
    if (this.error) return 'error';
    if (this.args.status) return 'status';
    return 'description';
  }
  get messageTone(): CueTone {
    if (this.error) return 'danger';
    if (this.args.status) return resolveTone(this.args.statusTone, CUE_TONES, 'info');
    return 'neutral';
  }
  get isStatus() {
    return this.messageKind === 'status';
  }
  get messageText() {
    return this.error ?? this.args.status ?? this.hint;
  }
  // the hint or error, which never announce on their own
  get quietText() {
    return this.isStatus ? undefined : this.messageText;
  }
  <template>
    <div class='pretui-fieldw' data-invalid={{if this.error 'true'}} data-test-pretui-field ...attributes>
      {{#if @label}}<label for={{this.controlId}}>{{@label}}</label>{{/if}}
      {{! The row wrapper appears ONLY when an accessory does. A Field with no
          accessories keeps the exact DOM it has always had — the control
          stays a direct grid child, so a caller yielding two elements still
          gets two grid rows, and every existing selector still matches. }}
      {{#if (has-block 'inlineStart')}}
        <div class='pretui-fieldrow'>
          <span class='pretui-fieldcue'>{{yield to='inlineStart'}}</span>
          <div class='pretui-fieldctl'>{{yield this.controlId this.messageId}}</div>
          {{#if (has-block 'inlineEnd')}}
            <span class='pretui-fieldcue'>{{yield to='inlineEnd'}}</span>
          {{/if}}
        </div>
      {{else if (has-block 'inlineEnd')}}
        <div class='pretui-fieldrow'>
          <div class='pretui-fieldctl'>{{yield this.controlId this.messageId}}</div>
          <span class='pretui-fieldcue'>{{yield to='inlineEnd'}}</span>
        </div>
      {{else}}
        {{yield this.controlId this.messageId}}
      {{/if}}
      <div class='pretui-fieldmsg' id={{this.messageId}}>
        {{! always rendered, so a status's first message is announced too;
            a live region added with its text can go unheard }}
        <span
          class='pretui-fieldlive'
          role='status'
          data-test-pretui-field-status
        >
          {{#if this.isStatus}}
            <Cue
              @tone={{this.messageTone}}
              @text={{this.messageText}}
            />
          {{/if}}
        </span>
        {{#if this.quietText}}
          <Cue
            @kind={{this.messageKind}}
            @tone={{this.messageTone}}
            @text={{this.quietText}}
          />
        {{/if}}
      </div>
    </div>
    <style scoped>
      /* above Input's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        .pretui-fieldw {
          display: grid;
          gap: var(--boxel-sp-3xs);
          grid-template-rows: auto auto auto;
          align-content: start;
          justify-items: start;
        }
        .pretui-fieldw > label {
          font-family: var(--boxel-ui-label-font-family);
          font-size: var(--boxel-ui-label-font-size);
          font-weight: var(--boxel-ui-label-font-weight);
          line-height: var(--boxel-ui-label-line-height);
          letter-spacing: var(--boxel-ui-label-letter-spacing);
          color: var(--foreground);
        }
        /* the control row: accessories sit at the LOGICAL edges, so an RTL
           reading order moves them without a second rule */
        .pretui-fieldrow {
          display: flex;
          align-items: center;
          justify-self: stretch;
          min-width: 0;
        }
        .pretui-fieldctl {
          flex: 1;
          min-width: 0;
        }
        .pretui-fieldcue {
          flex: none;
        }
        .pretui-fieldctl > :deep(.pretui-input),
        .pretui-fieldctl > :deep(.pretui-inputwrap),
        .pretui-fieldctl > :deep(.pretui-boxelwrap),
        .pretui-fieldctl > :deep(.pretui-selectwrap) {
          width: 100%;
        }
        .pretui-fieldw > :deep(.pretui-input),
        .pretui-fieldw > :deep(.pretui-inputwrap),
        .pretui-fieldw > :deep(.pretui-boxelwrap),
        .pretui-fieldw > :deep(.pretui-selectwrap) {
          justify-self: stretch;
        }
        /* a flex row, so the Cue sets the line and the inherited font can't
           grow it; reads the Cue's line height, so an ancestor sets both */
        .pretui-fieldmsg,
        .pretui-fieldlive {
          display: flex;
          min-width: 0;
        }
        /* the column's width, not the message's, so a long one wraps */
        .pretui-fieldmsg {
          justify-self: stretch;
          min-height: var(--pretui-cue-line-height, 1rem);
        }
        /* the invalid dress is Input's: a --destructive-ink edge (the fill
           hue misses a field boundary's 3:1) and no tint, through --input,
           which the select-type triggers draw their edge from. A disabled
           control can't be fixed, so it keeps the usual edge; a disabled
           option or tree row inside it doesn't count. */
        .pretui-fieldw[data-invalid]:not(
            :has(
              :is(input, textarea, select, button):disabled,
              [aria-disabled='true']:not([role='option'], [role='treeitem'])
            )
          ) {
          --input: var(--destructive-ink);
        }
        /* boxel-ui-wrapped controls: the invalid dress travels through the
           token channel — repoint the wrapper's --border/--background and the
           inner BoxelInput re-dresses itself; no CSS reaches boxel markup.
           A control sets --pretui-invalid-border/-background on its wrapper
           to choose its own dress. */
        .pretui-fieldw[data-invalid] :deep(.pretui-inputwrap),
        .pretui-fieldw[data-invalid] :deep(.pretui-boxelwrap) {
          --border: var(--pretui-invalid-border, var(--destructive-ink));
          --background: var(--pretui-invalid-background, var(--field));
        }
      }
    </style>
  </template>
}

