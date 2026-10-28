// A choice between a few options, as a row of a card's edit format: a radio
// button for each, with its label and, under it, a line saying what it means.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import FieldContainer from '../../components/field-container.gts';
import type { IconComponent } from '../../components/icons/types.ts';
import { eq } from '../../helpers/truth-helpers.ts';

export interface RadioChoice {
  value: string;
  label: string;
  hint?: string;
}

interface Signature {
  Args: {
    label: string;
    icon: IconComponent;
    // The radio group's name, which also names it to tests.
    name: string;
    choices: RadioChoice[];
    selected: string;
    onSelect: (value: string) => void;
  };
}

const RadioChoices: TemplateOnlyComponent<Signature> = <template>
  <FieldContainer
    @tag='div'
    @label={{@label}}
    @icon={{@icon}}
    data-test-radio-choices={{@name}}
  >
    <fieldset class='choices'>
      <legend class='visually-hidden'>{{@label}}</legend>
      {{#each @choices as |choice|}}
        <label class='choice' data-test-radio-choice={{choice.value}}>
          <input
            type='radio'
            name={{@name}}
            value={{choice.value}}
            checked={{eq @selected choice.value}}
            {{on 'change' (fn @onSelect choice.value)}}
          />
          <span class='text'>
            <span class='label'>{{choice.label}}</span>
            {{#if choice.hint}}
              <span class='hint'>{{choice.hint}}</span>
            {{/if}}
          </span>
        </label>
      {{/each}}
    </fieldset>
  </FieldContainer>

  <style scoped>
    .choices {
      margin: 0;
      padding: var(--boxel-sp-4xs) 0 0;
      border: 0;
      display: grid;
      gap: var(--boxel-sp-xs);
      min-width: 0;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .choice {
      display: flex;
      align-items: flex-start;
      gap: var(--boxel-sp-xs);
      cursor: pointer;
    }
    .choice input {
      margin: 0.1875rem 0 0;
      accent-color: var(--primary, var(--boxel-highlight));
    }
    .text {
      display: grid;
      min-width: 0;
    }
    .label {
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
    }
    .hint {
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      color: var(--muted-foreground);
      overflow-wrap: anywhere;
    }
  </style>
</template>;

export default RadioChoices;
