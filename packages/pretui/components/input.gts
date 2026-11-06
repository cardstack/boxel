// Pretui — Input: BoxelInput retrofit in Pretui control dress.
import Component from '@glimmer/component';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlAliasArgs } from '../pretui-primitives';
import { TYPED_PROPERTIES, typedProperties } from '../internal/extras';
import { FieldDress } from '../internal/field-dress';
import { keepStyle, type KeptProperty } from '../internal/keep-style';
import { SEARCH_START_INSET, SearchGlyph } from '../internal/search-glyph';

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
    /** additive — the id (or ids) of elements that describe the control, such
     * as a note under it; read with the error and helper lines */
    describedBy?: string;
    /** additive — native required; also suppresses the optional indicator */
    required?: boolean;
    /** additive — renders an 'Optional' indicator above the control */
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
// wiring, error + helper message rows — while FieldDress (internal/
// field-dress) re-dresses it through the token channel, as on every
// BoxelInput-based control. `keepStyle` writes, through the CSSOM, the
// properties the channel cannot reach — the UA font on native controls and
// element-local var definitions in boxel's own sheet — so the input renders
// no `style` attribute, as the secure origin's policy requires. Splatted
// attributes and modifiers land on the inner input, so aria-label /
// autocomplete / min / max keep working, and a caller's `style` keeps its own
// declarations beside these. The properties are TYPED_PROPERTIES (see
// internal/extras). The inline inset is left to the wrapper's --boxel-sp-sm
// and --boxel-input-padding-inline-end, so BoxelInput can reserve the
// validation icon's column. A search input draws the kit's magnifier and
// clears it with its start padding; Input renders the Optional label itself,
// so the magnifier's positioned box is the field alone. A color input keeps
// BoxelInput's `padding: 0`, or its swatch shrinks inside the fixed box.
const SEARCH_INPUT_PROPERTIES = typedProperties({
  'padding-inline-start': SEARCH_START_INSET,
});
const COLOR_INPUT_PROPERTIES: KeptProperty[] = [
  { property: 'font', value: 'inherit', strength: 'arg' },
  { property: 'letter-spacing', value: 'inherit', strength: 'arg' },
];

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
  get isSearch() {
    return this.args.type === 'search';
  }
  // BoxelInput's search variant is its own dark dress; a search Input is a
  // text field with the kit's magnifier.
  get boxelType() {
    return this.isSearch || !this.args.type ? 'text' : this.args.type;
  }
  get showOptional() {
    return Boolean(this.args.optional) && !this.required;
  }
  get state() {
    return this.invalid ? 'invalid' : 'none';
  }
  get inputProperties(): KeptProperty[] {
    if (this.args.type === 'color') {
      return COLOR_INPUT_PROPERTIES;
    }
    return this.isSearch ? SEARCH_INPUT_PROPERTIES : TYPED_PROPERTIES;
  }
  handleInput = (value: string) => {
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      value,
    );
  };
  <template>
    <FieldDress @optional={{this.showOptional}} data-test-pretui-input>
      <div class='pretui-inputfield'>
        <BoxelInput
          @id={{@controlId}}
          @type={{this.boxelType}}
          @value={{@value}}
          @placeholder={{@placeholder}}
          @disabled={{this.disabled}}
          @readonly={{this.readonly}}
          @state={{this.state}}
          @errorMessage={{unless this.disabled @errorMessage}}
          @describedBy={{@describedBy}}
          @helperText={{this.helperText}}
          @required={{this.required}}
          @onInput={{this.handleInput}}
          {{keepStyle this.inputProperties}}
          ...attributes
        />
        {{#if this.isSearch}}
          <SearchGlyph @dimmed={{this.disabled}} />
        {{/if}}
      </div>
    </FieldDress>
    <style scoped>
      @layer PretComponent {
        /* the magnifier's positioned box: the field, without the Optional
           label above it */
        .pretui-inputfield {
          position: relative;
        }
      }
    </style>
  </template>
}

