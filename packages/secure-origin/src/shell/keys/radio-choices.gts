// A choice between a few options, as a row of a card's edit format: a radio
// button for each, with its label and, under it, a line saying what it means.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Field } from '@cardstack/pretui/components/field';
import { RadioGroup } from '@cardstack/pretui/components/radio-group';

import type { IconComponent } from '../../components/icons/types.ts';

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

const options = (choices: RadioChoice[]) =>
  choices.map(({ value, label, hint }) => ({
    value,
    label,
    description: hint,
  }));

const RadioChoices: TemplateOnlyComponent<Signature> = <template>
  <Field
    @orientation='horizontal'
    @labelTag='span'
    @label={{@label}}
    @icon={{@icon}}
    class='radio-choices'
    data-test-radio-choices={{@name}}
    as |_controlId _messageId labelId|
  >
    <RadioGroup
      class='choices'
      @name={{@name}}
      @options={{options @choices}}
      @value={{@selected}}
      @onValueChange={{@onSelect}}
      aria-labelledby={{labelId}}
    />
  </Field>

  <style scoped>
    /* Beside the radios' first line rather than an input box. */
    .radio-choices {
      --pretui-field-label-offset: 0;
    }
    .choices {
      gap: var(--boxel-sp-xs);
      line-height: var(--boxel-line-height-sm);
    }
  </style>
</template>;

export default RadioChoices;
