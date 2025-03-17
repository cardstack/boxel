import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import focusTrap from 'ember-focus-trap/modifiers/focus-trap';

import { CardContainer } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import ModalContainer from '../modal-container';
import Preview from '../preview';

import type { FieldOption } from './code-submode/playground/playground-content';

interface Signature {
  Args: {
    instances: FieldOption[] | undefined;
    selectedIndex: number;
    onSelect: (index: number) => void;
    onClose: () => void;
    name?: string;
  };
}

const FieldChooser: TemplateOnlyComponent<Signature> = <template>
  <ModalContainer
    class='field-picker-modal'
    @cardContainerClass='field-picker'
    @title='Choose a {{if @name @name "Field"}} Instance'
    @size='medium'
    @centered={{true}}
    @onClose={{@onClose}}
    {{focusTrap}}
    data-test-field-chooser
  >
    <:content>
      {{#if @instances.length}}
        <ol class='instances'>
          {{#each @instances as |instance|}}
            <li class='field-option'>
              {{instance.displayIndex}}.
              <CardContainer
                class={{cn
                  'instance-container'
                  selected=(eq instance.index @selectedIndex)
                }}
                @tag='button'
                @displayBoundaries={{true}}
                {{on 'click' (fn @onSelect instance.index)}}
                aria-label='Select instance {{instance.displayIndex}}'
                data-test-field-instance={{instance.index}}
              >
                <Preview @card={{instance.field}} @format='embedded' />
              </CardContainer>
            </li>
          {{/each}}
        </ol>
      {{else}}
        <p>No field instances available</p>
      {{/if}}
    </:content>
  </ModalContainer>

  <style scoped>
    .field-picker-modal > :deep(.boxel-modal__inner) {
      display: flex;
    }
    :deep(.field-picker) {
      height: 60%;
    }
    .instances {
      display: grid;
      gap: var(--boxel-sp);
      margin-block: 0;
      padding-inline-start: 0;
    }
    .instance-container {
      appearance: none;
      border: none;
      padding: var(--boxel-sp);
    }
    .instance-container.selected:not(:hover):not(:focus) {
      box-shadow: 0 0 0 1px var(--boxel-dark);
    }
    .instance-container:hover,
    .instance-container:focus {
      box-shadow: 0 0 0 2px var(--boxel-highlight-hover);
    }
    .field-option {
      display: flex;
      gap: var(--boxel-sp-xs);
    }
  </style>
</template>;

export default FieldChooser;
