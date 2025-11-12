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
</template>;

export interface ControlsBlockArg {
  Input: ComponentLike<InputSignature>;
  Textarea: ComponentLike<TextareaSignature>;
}
