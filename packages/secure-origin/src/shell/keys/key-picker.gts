// Picks one of the user's keys, or a new one entered here. Nothing names a
// key but the user: the page that opened the window never does.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { eq } from '../../helpers/truth-helpers.ts';
import type { UserKey } from './context.ts';
import KeyFields from './key-fields.gts';

export const NEW_KEY = 'new';

interface Signature {
  Args: {
    keys: UserKey[];
    // A key's id, or NEW_KEY.
    selected: string | undefined;
    onSelect: (selected: string) => void;
    name: string;
    value: string;
    onName: (value: string) => void;
    onValue: (value: string) => void;
  };
}

const KeyPicker: TemplateOnlyComponent<Signature> = <template>
  <fieldset class='picker' data-test-key-picker>
    <legend class='legend'>Which key?</legend>
    {{#each @keys as |key|}}
      <label class='choice' data-test-key-choice={{key.name}}>
        <input
          type='radio'
          name='key'
          value={{key.id}}
          checked={{eq @selected key.id}}
          {{on 'change' (fn @onSelect key.id)}}
        />
        <span class='choice-name'>{{key.name}}</span>
      </label>
    {{/each}}
    <label class='choice' data-test-key-choice='new'>
      <input
        type='radio'
        name='key'
        value={{NEW_KEY}}
        checked={{eq @selected NEW_KEY}}
        {{on 'change' (fn @onSelect NEW_KEY)}}
      />
      <span class='choice-name'>Add a new key</span>
    </label>
  </fieldset>
  {{#if (eq @selected NEW_KEY)}}
    <div class='new-key' data-test-key-picker-new>
      <KeyFields
        @name={{@name}}
        @value={{@value}}
        @onName={{@onName}}
        @onValue={{@onValue}}
      />
    </div>
  {{/if}}

  <style scoped>
    .picker {
      margin: var(--boxel-sp) 0 0;
      padding: 0;
      border: 0;
      display: flex;
      flex-direction: column;
      gap: var(--boxel-sp-xs);
    }
    .legend {
      padding: 0;
      margin-bottom: var(--boxel-sp-xs);
      font: 600 var(--boxel-font-sm);
    }
    .choice {
      display: flex;
      align-items: center;
      gap: var(--boxel-sp-xs);
      padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      border: 1px solid var(--panel-border);
      border-radius: var(--boxel-border-radius);
      background-color: var(--panel-background);
      cursor: pointer;
    }
    .choice:has(input:checked) {
      border-color: var(--boxel-highlight);
    }
    .choice input {
      accent-color: var(--boxel-highlight);
      margin: 0;
    }
    .choice-name {
      overflow-wrap: anywhere;
    }
  </style>
</template>;

export default KeyPicker;
