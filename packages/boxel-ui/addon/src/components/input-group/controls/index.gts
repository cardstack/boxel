import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import type { ComponentLike } from '@glint/template';

import optional from '../../../helpers/optional.ts';
import pick from '../../../helpers/pick.ts';

interface InputSignature {
  Args: {
    disabled?: boolean;
    onBlur?: (ev: Event) => void;
    onFocus?: (ev: Event) => void;
    onInput?: (val: string) => void;
    placeholder?: string;
    readonly?: boolean;
    required?: boolean;
    value?: string;
  };
  Blocks: Record<string, never>;
  Element: HTMLSpanElement;
}

export const Input: TemplateOnlyComponent<InputSignature> = <template>
  <input
    class='form-control'
    placeholder={{@placeholder}}
    value={{@value}}
    disabled={{@disabled}}
    readonly={{@readonly}}
    required={{@required}}
    {{on 'input' (pick 'target.value' (optional @onInput))}}
    {{on 'focus' (optional @onFocus)}}
    {{on 'blur' (optional @onBlur)}}
    ...attributes
  />
  <style scoped>
    .form-control {
      -moz-appearance: none;
      -webkit-appearance: none;
      appearance: none;
      background-clip: padding-box;
      display: block;
      flex: 1 1 auto;
      margin: 0;
      min-width: 0;
      padding: var(--boxel-input-group-padding-y)
        var(--boxel-input-group-padding-x);
      position: relative;
      width: 1%;
      border: 1px solid var(--border, var(--boxel-form-control-border-color));
    }
    .form-control:focus {
      outline: none;
      border-color: var(--ring, var(--boxel-highlight));
    }
  </style>
</template>;

interface TextareaSignature {
  Args: {
    placeholder?: string;
    value?: string;
  };
  Blocks: Record<string, never>;
  Element: HTMLSpanElement;
}

export const Textarea: TemplateOnlyComponent<TextareaSignature> = <template>
  <textarea class='form-control' ...attributes></textarea>
  <style scoped>
    .form-control {
      -moz-appearance: none;
      -webkit-appearance: none;
      appearance: none;
      background-clip: padding-box;
      display: block;
      flex: 1 1 auto;
      margin: 0;
      min-width: 0;
      padding: var(--boxel-input-group-padding-y)
        var(--boxel-input-group-padding-x);
      position: relative;
      width: 1%;
    }

    .form-control {
      border: 1px solid var(--boxel-input-group-border-color);
      border-radius: var(--boxel-input-group-border-radius);
      transition: border-color var(--boxel-transition);
      margin: 0;
      min-height: var(--boxel-input-group-height);
      outline-offset: 0;
    }

    .form-control:hover,
    .form-control:focus {
      outline: none;
    }

    .form-control:disabled {
      opacity: 0.5;
    }
  </style>
</template>;

export interface ControlsBlockArg {
  Input: ComponentLike<InputSignature>;
  Textarea: ComponentLike<TextareaSignature>;
}
