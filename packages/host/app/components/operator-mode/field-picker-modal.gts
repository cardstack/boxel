import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import focusTrap from 'ember-focus-trap/modifiers/focus-trap';

import { CardContainer } from '@cardstack/boxel-ui/components';
import { add, cn, eq } from '@cardstack/boxel-ui/helpers';

import type { FieldDef } from 'https://cardstack.com/base/card-api';

import ModalContainer from '../modal-container';
import Preview from '../preview';

interface Signature {
  Args: {
    instances: FieldDef[] | undefined;
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
  >
    <:content>
      <div class='instances'>
        {{#each @instances as |instance i|}}
          <CardContainer
            class={{cn 'instance-container' selected=(eq i @selectedIndex)}}
            @tag='button'
            @displayBoundaries={{true}}
            {{on 'click' (fn @onSelect i)}}
            aria-label='Select instance {{add i 1}}'
          >
            <Preview @card={{instance}} @format='embedded' />
          </CardContainer>
        {{/each}}
      </div>
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
  </style>
</template>;

export default FieldChooser;
