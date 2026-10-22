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

// Input wraps boxel-ui's BoxelInput, which carries the machinery —
// validation-state plumbing, aria-invalid/aria-errormessage/aria-describedby
// wiring, error + helper message rows, optional indicator — while the
// wrapper div re-dresses it through the semantic-token + --boxel-*
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
// --boxel-form-control-line-height-sm add up to
// --boxel-form-control-height-sm (1.75rem); the line-height token assumes
// this padding-block, so change them together. A color input keeps
// BoxelInput's `padding: 0`, or its swatch shrinks inside the fixed box.
const INPUT_FONT = htmlSafe(
  'font: inherit; letter-spacing: inherit; line-height: var(--boxel-form-control-line-height-sm); padding-block: 0.25rem;',
);
const COLOR_INPUT_FONT = htmlSafe('font: inherit; letter-spacing: inherit;');

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
  get inputStyle() {
    return this.args.type === 'color' ? COLOR_INPUT_FONT : INPUT_FONT;
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
        @errorMessage={{unless this.disabled @errorMessage}}
        @helperText={{this.helperText}}
        @required={{this.required}}
        @optional={{@optional}}
        @onInput={{this.handleInput}}
        style={{this.inputStyle}}
        ...attributes
      />
    </div>
    <style scoped>
      @layer PretComponent {
        /* the kit's field style, Select's trigger the reference, fed into
           BoxelInput via its token channel: the --field face, an --input
           edge, the theme's --ring and --muted-foreground, Button's corner,
           a --boxel-form-control-height-sm height and --boxel-font-size-xs
           type */
        .pretui-inputwrap {
          width: 100%;
          font-size: var(--boxel-font-size-xs);
          letter-spacing: var(--boxel-lsp-xs);
          --background: var(--field);
          --border: var(--input);
          --boxel-form-control-height: var(--boxel-form-control-height-sm);
          --boxel-input-height: var(--boxel-form-control-height-sm);
          --boxel-form-control-border-radius: calc(var(--radius) - 2px);
          /* the helper and error rows and the Optional label, a step below
             the field's text */
          --boxel-font-size-sm: var(--boxel-font-size-2xs);
          --boxel-input-optional-font-size: var(--boxel-font-size-2xs);
          --boxel-sp-xs: var(--boxel-sp-3xs);
          /* Select's 0.625rem text inset on both sides, less this edge's 1px
             border. While the invalid icon shows, BoxelInput reserves its
             column at the end instead; a search input keeps BoxelInput's
             start inset, which clears the search icon. */
          --boxel-sp-sm: calc(0.625rem - 1px);
          --boxel-input-padding-inline-end: calc(0.625rem - 1px);
          /* Select's and Autocomplete's states. Hover leaves the edge alone
             unless the pointer can hover (below). Focus is the kit's 2px --ring
             outline, laid over the 1px border, which BoxelInput turns --ring. */
          --boxel-input-hover-border-color: var(--border);
          --boxel-input-outline: 0 solid transparent;
          --boxel-input-outline-offset: -1px;
          --boxel-input-invalid-color: var(--destructive-ink);
          --boxel-input-invalid-box-shadow: none;
          --boxel-input-invalid-focus-outline: 2px solid var(--ring);
          --boxel-input-invalid-focus-box-shadow: none;
          --boxel-input-disabled-opacity: 0.45;
          /* read-only stays focusable and copyable, so it isn't dimmed */
          --boxel-input-readonly-opacity: 1;
          /* the invalid dress this control takes, from @invalid or an invalid
             Field: the -ink edge, as on Autocomplete (the fill hue misses a
             boundary's 3:1), and no tint */
          --pretui-invalid-border: var(--destructive-ink);
          --pretui-invalid-background: var(--field);
        }
        @media (hover: hover) {
          /* Select's hover edge: toward --foreground, in both schemes. It
             mixes from --border, so an invalid field (from @invalid or an
             invalid Field) keeps its error edge on hover, darkened. */
          .pretui-inputwrap {
            --boxel-input-hover-border-color: color-mix(
              in oklch,
              var(--foreground) 30%,
              var(--border)
            );
          }
          /* only hovering the field itself, not its message rows */
          .pretui-inputwrap:has(input:hover) {
            --boxel-input-invalid-color: var(--boxel-input-hover-border-color);
          }
        }
        /* forced colors paint a transparent outline, so it only gets a width
           on focus; at rest it would look the same as the focus ring. Focus
           swaps the error edge for the ring, which wins over hover. */
        .pretui-inputwrap:has(input:focus) {
          --boxel-input-outline: 2px solid transparent;
          --boxel-input-invalid-color: var(--ring);
        }
        /* iOS zooms into inputs under 16px on focus */
        @media (pointer: coarse) {
          .pretui-inputwrap {
            font-size: var(--boxel-form-control-touch-font-size);
          }
        }
        /* a disabled field can't be fixed, so it drops the error edge (and
           the template drops the error row) */
        .pretui-inputwrap:has(input:disabled) {
          --pretui-invalid-border: var(--input);
        }
        /* Input owns @invalid, so it applies the invalid edge itself;
           Field's rule only adds it for a Field-level error */
        .pretui-inputwrap[data-invalid='true'] {
          --border: var(--pretui-invalid-border);
        }
      }
    </style>
  </template>
}

