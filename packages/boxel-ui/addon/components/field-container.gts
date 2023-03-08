import type { TemplateOnlyComponent } from '@ember/component/template-only';
import cn from '../helpers/cn';
import element from '../helpers/element';
import { eq, not, or } from '../helpers/truth-helpers';
import { svgJar } from '../helpers/svg-jar';
import Label from './label';

export interface Signature {
  Element: HTMLElement;
  Args: {
    tag?: keyof HTMLElementTagNameMap;
    centeredDisplay?: boolean;
    fieldId?: string;
    label: string;
    horizontalLabelSize?: string;
    icon?: string;
    vertical?: boolean;
  };
  Blocks: {
    default: [];
  };
}

const FieldContainer: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |Tag|}}
    <Tag
      class={{cn
        'boxel-field'
        boxel-field--vertical=(or @vertical @centeredDisplay)
        boxel-field--horizontal=(not (or @vertical @centeredDisplay))
        boxel-field--small-label=(eq @horizontalLabelSize 'small')
        boxel-field--centered-display=@centeredDisplay
      }}
      data-test-boxel-field
      data-test-boxel-field-id={{@fieldId}}
      ...attributes
    >
      <Label class='boxel-field__label' data-test-boxel-field-label>
        {{@label}}
      </Label>

      {{#if @icon}}
        <div class='boxel-field--with-icon'>
          {{svgJar @icon class='boxel-field__icon' role='presentation'}}
          <div class='boxel-field__yield--with-icon'>
            {{yield}}
          </div>
        </div>
      {{else}}
        {{yield}}
      {{/if}}
    </Tag>
  {{/let}}
</template>;

export default FieldContainer;
