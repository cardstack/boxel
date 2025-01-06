import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

interface Signature {
  Args: {
    onChange: (color: string) => void;
    value: string;
  };
  Element: HTMLDivElement;
}

export default class ColorPicker extends Component<Signature> {
  @tracked private selectedColor: string;

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);
    this.selectedColor = args.value ?? '#000000';
  }

  private handleColorChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    this.selectedColor = input.value;
    this.args.onChange(input.value);
  };

  <template>
    <div class='color-picker' ...attributes>
      <input
        type='color'
        value={{this.selectedColor}}
        class='input'
        {{on 'input' this.handleColorChange}}
      />
    </div>

    <style scoped>
      .color-picker {
        --size: 2.5rem;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }

      .input {
        width: var(--size);
        height: var(--size);
        padding: 0;
        border: none;
        cursor: pointer;
      }

      .input::-webkit-color-swatch-wrapper {
        padding: 0;
      }

      .input::-webkit-color-swatch {
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
      }

      .preview {
        width: var(--size);
        height: var(--size);
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
      }

      .value {
        font: var(--boxel-font);
        color: var(--boxel-dark);
        text-transform: uppercase;
      }
    </style>
  </template>
}
