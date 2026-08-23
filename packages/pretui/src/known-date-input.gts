import { on } from '@ember/modifier';
import Component from '@glimmer/component';

interface InputSignature {
  Element: HTMLInputElement;
  Args: {
    controlId?: string;
    value?: string;
    placeholder?: string;
    invalid?: boolean;
    disabled?: boolean;
    onInput?: (value: string) => void;
  };
}

export class Input extends Component<InputSignature> {
  handleInput = (event: Event) => {
    this.args.onInput?.((event.target as HTMLInputElement).value);
  };

  <template>
    <input
      id={{@controlId}}
      class='known-date-input'
      value={{@value}}
      placeholder={{@placeholder}}
      aria-invalid={{if @invalid 'true'}}
      disabled={{@disabled}}
      {{on 'input' this.handleInput}}
      ...attributes
    />
    <style scoped>
      .known-date-input {
        min-height: 2.5rem;
        padding: 0.45rem 0.65rem;
        border: 1px solid var(--input, #c8ccd4);
        border-radius: var(--radius, 0.625rem);
        background: var(--field, #fff);
        color: var(--foreground, #292731);
        font: inherit;
      }
      .known-date-input:focus-visible {
        outline: 0.1875rem solid
          color-mix(in srgb, var(--primary, #00a884) 30%, transparent);
        border-color: var(--primary, #00a884);
      }
      .known-date-input[aria-invalid='true'] {
        border-color: var(--destructive, #d43f4c);
      }
    </style>
  </template>
}
