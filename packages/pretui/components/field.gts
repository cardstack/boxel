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
// 2026-08-13 (boxel-catalog E11): the message line is now a `Cue`, so its
// tone carries a glyph as well as a colour and a status announces itself;
// the control row gained `<:inlineStart>` / `<:inlineEnd>` accessory slots at
// the LOGICAL edges (a currency prefix, a unit suffix, a verified tick); and
// the message line finally has an id, yielded as the block's second param so
// a control can point `aria-describedby` at it.
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
  get messageText() {
    return this.error ?? this.args.status ?? this.hint;
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
      <div class='pretui-fieldmsg'>
        {{#if this.messageText}}
          <Cue
            @kind={{this.messageKind}}
            @tone={{this.messageTone}}
            @text={{this.messageText}}
            @id={{this.messageId}}
          />
        {{/if}}
      </div>
    </div>
    <style scoped>
      .pretui-fieldw {
        display: grid;
        gap: 5px;
        grid-template-rows: auto auto auto;
        align-content: start;
        justify-items: start;
      }
      .pretui-fieldw > label {
        line-height: 16px;
        font-size: var(--text-ui, 12px);
        font-weight: 500;
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
      .pretui-fieldctl > :deep(.pretui-boxelwrap) {
        width: 100%;
      }
      .pretui-fieldw > :deep(.pretui-input),
      .pretui-fieldw > :deep(.pretui-inputwrap),
      .pretui-fieldw > :deep(.pretui-boxelwrap) {
        justify-self: stretch;
      }
      .pretui-fieldmsg {
        min-height: 16px;
        line-height: 16px;
      }
      /* the hint / error spans are gone: the message line is a <Cue>, which
         brings its own type scale, its own tone and its own glyph */
      .pretui-fieldw[data-invalid] :deep(.pretui-input) {
        box-shadow: 0 0 0 1px var(--destructive);
        background: color-mix(in oklch, var(--destructive) 4%, var(--field, var(--boxel-light)));
      }
      /* boxel-ui-wrapped controls: the invalid dress travels through the
         token channel — repoint the wrapper's --border/--background and the
         inner BoxelInput re-dresses itself; no CSS reaches boxel markup. */
      .pretui-fieldw[data-invalid] :deep(.pretui-inputwrap),
      .pretui-fieldw[data-invalid] :deep(.pretui-boxelwrap) {
        --border: var(--destructive);
        --background: color-mix(in oklch, var(--destructive) 4%, var(--field, var(--boxel-light)));
      }
    </style>
  </template>
}

