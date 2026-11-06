// Pretui — Textarea: BoxelInput @type='textarea' in Pretui control dress.
import Component from '@glimmer/component';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlAliasArgs } from '../pretui-primitives';
import { FieldDress } from '../internal/field-dress';
import { keepStyle, type KeptProperty } from '../internal/keep-style';

export interface TextareaSignature {
  Args: ControlAliasArgs & {
    value?: string;
    placeholder?: string;
    invalid?: boolean;
    controlId?: string;
    onInput?: (value: string) => void;
    /** additive — see Input */
    disabled?: boolean;
    helperText?: string;
    errorMessage?: string;
    describedBy?: string;
    required?: boolean;
    optional?: boolean;
    readonly?: boolean;
    /** aliases — see Input */
    isInvalid?: boolean;
    description?: string;
  };
  Element: HTMLTextAreaElement;
}

// Same retrofit as Input, on BoxelInput @type='textarea', in the shared
// FieldDress. `keepStyle` writes the textarea metrics through the CSSOM (a
// 4rem min-height, its block padding, vertical-only resize), so the textarea
// renders no `style` attribute — boxel defines its 10rem --boxel-input-height
// ON the textarea element itself, so the wrapper channel cannot override it;
// a declaration on the element can. The inline inset is left to FieldDress,
// so BoxelInput can reserve the validation icon's column.
const TEXTAREA_METRICS: KeptProperty[] = [
  { property: 'font', value: 'inherit', strength: 'arg' },
  { property: 'letter-spacing', value: 'inherit', strength: 'arg' },
  { property: '--boxel-input-height', value: '4rem', strength: 'arg' },
  { property: 'padding-block', value: 'calc(0.5rem - 1px)', strength: 'arg' },
  { property: 'resize', value: 'vertical', strength: 'arg' },
];

export class Textarea extends Component<TextareaSignature> {
  get invalid() {
    return firstDefined(this.args.invalid, this.args.isInvalid) ?? false;
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get required() {
    return firstDefined(this.args.required, this.args.isRequired);
  }
  get showOptional() {
    return Boolean(this.args.optional) && !this.required;
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
    <FieldDress @optional={{this.showOptional}} data-test-pretui-textarea>
      <BoxelInput
        @id={{@controlId}}
        @type='textarea'
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
        {{keepStyle TEXTAREA_METRICS}}
        ...attributes
      />
    </FieldDress>
  </template>
}

