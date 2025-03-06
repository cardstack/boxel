import type { TemplateOnlyComponent } from '@ember/component/template-only';
// import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import {
  BoxelButton,
  CardContainer,
  Modal,
} from '@cardstack/boxel-ui/components';
import { cssVar } from '@cardstack/boxel-ui/helpers';

import type { FieldDef } from 'https://cardstack.com/base/card-api';

import Preview from '../preview';

interface Signature {
  Args: {
    instances: FieldDef[] | undefined;
    onConfirm: () => void;
    onCancel: () => void;
    error?: string;
  };
}

let component: TemplateOnlyComponent<Signature> = <template>
  <Modal
    @layer='urgent'
    @size='medium'
    @isOpen={{true}}
    @onClose={{@onCancel}}
    style={{cssVar boxel-modal-offset-top='20px'}}
  >
    <section class='field-picker'>
      <div class='instances'>
        {{#each @instances as |instance|}}
          <CardContainer class='instance-container' @displayBoundaries={{true}}>
            <Preview @card={{instance}} @format='embedded' />
          </CardContainer>
        {{/each}}
      </div>
      <footer>
        <BoxelButton
          @size='tall'
          @kind='secondary-light'
          {{on 'click' @onCancel}}
        >
          Cancel
        </BoxelButton>
        <BoxelButton @size='tall' @kind='primary' {{on 'click' @onConfirm}}>
          Select
        </BoxelButton>
        {{#if @error}}
          <p class='error'>{{@error}}</p>
        {{/if}}
      </footer>
    </section>
  </Modal>

  <style scoped>
    .field-picker {
      padding: var(--boxel-sp-lg) var(--boxel-sp-lg) var(--boxel-sp);
      background-color: var(--boxel-light);
      border-radius: var(--boxel-border-radius-xl);
      box-shadow: var(--boxel-deep-box-shadow);
    }
    .instances {
      display: grid;
      gap: var(--boxel-sp);
    }
    .instance-container {
      padding: var(--boxel-sp);
    }
    footer {
      margin-top: var(--boxel-sp-lg);
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      width: 100%;
    }
    button:first-child {
      margin-right: var(--boxel-sp-xs);
    }
    .error {
      flex-grow: 1;
      color: var(--boxel-danger);
      font: 500 var(--boxel-font-sm);
      letter-spacing: var(--boxel-lsp-xs);
      margin-top: var(--boxel-sp);
      margin-bottom: 0;
    }
  </style>
</template>;

export default component;
