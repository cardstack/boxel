// Pretui — Field: label[for] + reserved message line so side-by-side fields
// never shift when an error appears (alignment law).
import Component from '@glimmer/component';
import { guidFor } from '@ember/object/internals';
import type { ComponentLike } from '@glint/template';
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
    /**
     * `vertical` (default) puts the label above the control; `horizontal`
     * puts it in a column of its own beside the control and its message line,
     * as a record's edit form lays out its rows.
     */
    orientation?: FieldOrientation;
    /** an icon drawn before the label, hidden from assistive technology */
    icon?: FieldIcon;
    /**
     * `label` (default) is a `<label for>` pointing at the control the block
     * gives `id={{controlId}}`. `span` is for a field whose content is no
     * single labelable element — a radio group, a fieldset, several controls,
     * or a value shown rather than edited: the label then points at nothing,
     * and a group names itself with `aria-labelledby={{labelId}}`, the
     * block's third param.
     */
    labelTag?: 'label' | 'span';
    /**
     * `false` keeps no line under the control for a message, for a control
     * that shows its own errors: the message line is drawn only while there
     * is something to say. The status region then arrives with its first
     * status, which a screen reader can miss.
     */
    reserveMessage?: boolean;
    /**
     * marks the field as one that must be filled in, with an asterisk after
     * the label. The control still says so to assistive technology itself
     * (its own `required` or `aria-required`), as the field can't reach it.
     */
    required?: boolean;
  };
  Blocks: {
    /** the control. Second param is the id of the message line, for
     * `aria-describedby` on a control that does not take it automatically. */
    default: [
      controlId: string,
      describedBy: string,
      /** the label's id, undefined when there is no label */
      labelId: string | undefined,
    ];
    /** cue accessory at the reading start of the control row */
    inlineStart: [];
    /** cue accessory at the reading end of the control row */
    inlineEnd: [];
  };
  Element: HTMLDivElement;
}

export type FieldOrientation = 'vertical' | 'horizontal';
export type FieldIcon = ComponentLike<{ Element: SVGSVGElement }>;

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
  get labelId() {
    return `${guidFor(this)}-lbl`;
  }
  // undefined without a label, so no control points at an id nothing has
  get yieldedLabelId() {
    return this.args.label ? this.labelId : undefined;
  }
  get showsMessageLine() {
    return this.args.reserveMessage !== false || Boolean(this.messageText);
  }
  get labelIsSpan() {
    return this.args.labelTag === 'span';
  }
  get orientation(): FieldOrientation {
    return this.args.orientation === 'horizontal' ? 'horizontal' : 'vertical';
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
    <div
      class='pretui-fieldw'
      data-orientation={{this.orientation}}
      data-invalid={{if this.error 'true'}}
      data-test-pretui-field
      ...attributes
    >
      {{#if @label}}
        <div class='pretui-fieldhead' data-test-pretui-field-head>
          {{#if @icon}}
            <@icon class='pretui-fieldicon' aria-hidden='true' />
          {{/if}}
          {{#if this.labelIsSpan}}
            <span
              class='pretui-fieldlabel'
              id={{this.labelId}}
              data-test-pretui-field-label
            >{{@label}}</span>
          {{else}}
            <label
              class='pretui-fieldlabel'
              id={{this.labelId}}
              for={{this.controlId}}
              data-test-pretui-field-label
            >{{@label}}</label>
          {{/if}}
          {{#if @required}}
            <span
              class='pretui-fieldrequired'
              title='Required'
              aria-hidden='true'
              data-test-pretui-field-required
            >*</span>
          {{/if}}
        </div>
      {{/if}}
      {{! Vertical, the body takes no box of its own (display: contents), so
          the control stays a grid child of the field: a caller yielding two
          elements still gets two grid rows. Horizontal, it is the column
          beside the label. The row wrapper appears ONLY when an accessory
          does. }}
      <div class='pretui-fieldbody' data-test-pretui-field-body>
        {{#if (has-block 'inlineStart')}}
          <div class='pretui-fieldrow'>
            <span class='pretui-fieldcue'>{{yield to='inlineStart'}}</span>
            <div class='pretui-fieldctl'>{{yield
                this.controlId
                this.messageId
                this.yieldedLabelId
              }}</div>
            {{#if (has-block 'inlineEnd')}}
              <span class='pretui-fieldcue'>{{yield to='inlineEnd'}}</span>
            {{/if}}
          </div>
        {{else if (has-block 'inlineEnd')}}
          <div class='pretui-fieldrow'>
            <div class='pretui-fieldctl'>{{yield
                this.controlId
                this.messageId
                this.yieldedLabelId
              }}</div>
            <span class='pretui-fieldcue'>{{yield to='inlineEnd'}}</span>
          </div>
        {{else}}
          {{yield this.controlId this.messageId this.yieldedLabelId}}
        {{/if}}
        {{#if this.showsMessageLine}}
        <div
          class='pretui-fieldmsg'
          id={{this.messageId}}
          data-test-pretui-field-message
        >
          {{! always rendered, so a status's first message is announced too;
              a live region added with its text can go unheard }}
          <span
            class='pretui-fieldlive'
            role='status'
            data-test-pretui-field-status
          >
            {{#if this.isStatus}}
              <Cue @tone={{this.messageTone}} @text={{this.messageText}} />
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
        .pretui-fieldw[data-orientation='horizontal'] {
          grid-template-columns:
            var(--pretui-field-label-size, minmax(8rem, 25%))
            minmax(0, 1fr);
          grid-template-rows: auto;
          column-gap: var(--pretui-field-column-gap, var(--boxel-sp-xs));
          justify-items: stretch;
          min-block-size: var(--boxel-form-control-height);
        }
        .pretui-fieldbody {
          display: contents;
        }
        /* the column beside the label is the control's, so what is in it
           takes its width */
        .pretui-fieldw[data-orientation='horizontal'] > .pretui-fieldbody {
          display: grid;
          gap: var(--boxel-sp-3xs);
          align-content: start;
          justify-items: stretch;
          align-self: center;
          min-inline-size: 0;
        }
        /* with no label, the control takes the whole row */
        .pretui-fieldw[data-orientation='horizontal'] > .pretui-fieldbody:first-child {
          grid-column: 1 / -1;
        }
        /* the label column: down to the first line of a control box beside
           it, which a caller beside text sets to 0 */
        .pretui-fieldw[data-orientation='horizontal'] > .pretui-fieldhead {
          padding-block-start: var(
            --pretui-field-label-offset,
            var(--boxel-sp-sm)
          );
        }
        .pretui-fieldhead {
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp-xs);
          min-inline-size: 0;
        }
        .pretui-fieldicon {
          flex: none;
          inline-size: var(--pretui-field-icon-size, 1rem);
          block-size: var(--pretui-field-icon-size, 1rem);
          /* on the label's first line */
          margin-block-start: calc(
            (
                var(--boxel-ui-label-line-height, 1.25) *
                  var(--boxel-ui-label-font-size, 0.75rem) -
                  var(--pretui-field-icon-size, 1rem)
              ) /
              2
          );
        }
        /* the asterisk sits against the label, inside the head's gap */
        .pretui-fieldrequired {
          margin-inline-start: calc(
            var(--boxel-sp-6xs) - var(--boxel-sp-xs)
          );
          color: var(--destructive);
          font-weight: 600;
        }
        .pretui-fieldlabel {
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
        .pretui-fieldbody > :deep(.pretui-input),
        .pretui-fieldbody > :deep(.pretui-inputwrap),
        .pretui-fieldbody > :deep(.pretui-boxelwrap),
        .pretui-fieldbody > :deep(.pretui-selectwrap) {
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

