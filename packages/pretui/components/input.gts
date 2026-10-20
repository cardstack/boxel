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
    /** additive — native readonly */
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
// border + padding-block + line-height, and the inherited `normal`
// line-height overshoots it, so an Input would sit taller than every other
// control in the kit. The wrapper token channel cannot reach the UA
// line-height; the inline constant can. Borders, padding-block and
// line-height add up to the 1.875rem height. BoxelInput has no end padding,
// so the end gets Select's inset too.
const INPUT_FONT = htmlSafe(
  'font: inherit; letter-spacing: inherit; line-height: calc(1.375rem - 2px); padding-block: 0.25rem; padding-inline-end: calc(0.625rem - 1px);',
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
      @layer PretComponent {
        /* the kit's field style, Select's trigger the reference, fed into
           BoxelInput via its token channel: the --field face, an --input
           edge, the theme's --ring and --muted-foreground, Button's corner,
           a 1.875rem height and --boxel-font-size-xs type */
        .pretui-inputwrap {
          width: 100%;
          font-size: var(--boxel-font-size-xs);
          letter-spacing: var(--boxel-lsp-xs);
          --background: var(--field);
          --border: var(--input);
          --boxel-form-control-height: 1.875rem;
          --boxel-input-height: 1.875rem;
          --boxel-form-control-border-radius: calc(var(--radius) - 2px);
          /* the helper and error rows, a step below the field's text */
          --boxel-font-size-sm: var(--boxel-font-size-2xs);
          --boxel-sp-xs: var(--boxel-sp-3xs);
          /* Select's 0.625rem text inset, less this edge's 1px border */
          --boxel-sp-sm: calc(0.625rem - 1px);
        }
        /* iOS zooms into inputs under 16px on focus */
        @media (pointer: coarse) {
          .pretui-inputwrap {
            font-size: var(--boxel-font-size);
          }
        }
        /* Input owns @invalid, so the invalid channel must also be applied
           here. Field's selector below is only an extra convenience for a
           Field-level error message; relying on it made the standalone Input
           demo (and any Input without Field) lose the Pretui invalid dress. */
        .pretui-inputwrap[data-invalid='true'] {
          --border: var(--destructive);
          --background: color-mix(in oklch, var(--destructive) 4%, var(--field));
        }
      }
    </style>
  </template>
}

