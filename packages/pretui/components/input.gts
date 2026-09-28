// Pretui — Input: BoxelInput retrofit in Pretui control dress.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlAliasArgs } from '../pretui-primitives';

export interface InputSignature {
  Args: ControlAliasArgs & {
    value?: string;
    placeholder?: string;
    type?: string;
    invalid?: boolean;
    disabled?: boolean;
    controlId?: string;
    onInput?: (value: string) => void;
    /** additive — helper line under the control (boxel-ui machinery) */
    helperText?: string;
    /** additive — error line under the control; renders while @invalid */
    errorMessage?: string;
    /** additive — native required; also suppresses the optional indicator */
    required?: boolean;
    /** additive — renders boxel-ui's 'Optional' indicator above the control */
    optional?: boolean;
    /** additive — native readonly (Appendix E boolean set) */
    readonly?: boolean;
    /** alias — React Aria / Base UI spelling of @invalid */
    isInvalid?: boolean;
    /** alias for @helperText — the shadcn/Chakra Field spelling */
    description?: string;
  };
  Element: HTMLInputElement;
}

// Retrofit ON boxel-ui (standing reuse directive): BoxelInput carries the
// machinery — validation-state plumbing, aria-invalid/aria-errormessage/
// aria-describedby wiring, error + helper message rows, optional indicator —
// while the wrapper div re-dresses it through the semantic-token + --boxel-*
// custom-property channel (same pattern as EmailInput/PhoneInput; no CSS
// reaches into boxel-ui markup). The inline style beats the two spots the
// channel cannot reach — the UA font on native controls and element-local
// var definitions in boxel's own sheet; splatted attributes land on the
// inner input, so aria-label / autocomplete / min / max keep working.
// `--boxel-input-height` is a MIN-height; the natural height is
// border + padding-block + line-height, and with the inherited `normal`
// line-height that came to 29.31px against a --control-h of 28px. So an
// Input sat 1.3px taller than every other control in the kit, and a
// RecordDetail row grew 1.3px the moment it opened. The wrapper token
// channel cannot reach the UA line-height; the inline constant can.
// 1 + 4 + 18 + 4 + 1 = 28.
const INPUT_FONT = htmlSafe(
  'font: inherit; letter-spacing: inherit; line-height: 18px; padding-block: 4px;',
);

export class Input extends Component<InputSignature> {
  get invalid() {
    return firstDefined(this.args.invalid, this.args.isInvalid) ?? false;
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get required() {
    return firstDefined(this.args.required, this.args.isRequired);
  }
  get readonly() {
    return firstDefined(
      this.args.readonly,
      this.args.isReadOnly,
      this.args.readOnly,
    );
  }
  get helperText() {
    return firstDefined(this.args.helperText, this.args.description);
  }
  get state() {
    return this.invalid ? 'invalid' : 'none';
  }
  handleInput = (value: string) => {
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      value,
    );
  };
  <template>
    <div
      class='pretui-inputwrap'
      data-invalid={{if this.invalid 'true'}}
      data-test-pretui-input
    >
      <BoxelInput
        @id={{@controlId}}
        @type={{if @type @type 'text'}}
        @value={{@value}}
        @placeholder={{@placeholder}}
        @disabled={{this.disabled}}
        @readonly={{this.readonly}}
        @state={{this.state}}
        @errorMessage={{@errorMessage}}
        @helperText={{this.helperText}}
        @required={{this.required}}
        @optional={{@optional}}
        @onInput={{this.handleInput}}
        style={{INPUT_FONT}}
        ...attributes
      />
    </div>
    <style scoped>
      /* Pretui control dress fed into BoxelInput via its token channel:
         semantic vars (--background/--border/--ring read the Pretui field
         tokens) plus the --boxel-* dimension knobs — h28, r(--radius),
         0-9px padding, 12.5px type. --muted-foreground narrows to the
         placeholder ink inside this wrapper only. */
      .pretui-inputwrap {
        width: 100%;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        --background: var(--field, var(--boxel-light));
        --border: var(--input);
        --ring: var(--primary);
        --muted-foreground: var(--ink-3, var(--boxel-400));
        --boxel-form-control-height: var(--control-h, 28px);
        --boxel-input-height: var(--control-h, 28px);
        --boxel-form-control-border-radius: var(--radius);
        --boxel-font-size-sm: var(--text-ui-sm, 11.5px);
        --boxel-font-size-xs: var(--text-ui-xs, 11px);
        --boxel-sp-xs: 5px;
        --boxel-sp-sm: 9px;
      }
      /* Input owns @invalid, so the invalid channel must also be applied
         here. Field's selector below is only an extra convenience for a
         Field-level error message; relying on it made the standalone Input
         demo (and any Input without Field) lose the Pretui invalid dress. */
      .pretui-inputwrap[data-invalid='true'] {
        --border: var(--destructive);
        --background: color-mix(in oklch, var(--destructive) 4%, var(--field, var(--boxel-light)));
      }
    </style>
  </template>
}

