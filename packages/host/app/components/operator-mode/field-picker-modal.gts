import type { TemplateOnlyComponent } from '@ember/component/template-only';
// import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { BoxelButton, CardContainer } from '@cardstack/boxel-ui/components';

import type { FieldDef } from 'https://cardstack.com/base/card-api';

import ModalContainer from '../modal-container';
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
  <ModalContainer
    class='field-picker-modal'
    @cardContainerClass='field-picker'
    @title='Choose a field instance'
    @size='medium'
    @onClose={{@onCancel}}
  >
    <:content>
      <div class='instances'>
        {{#each @instances as |instance|}}
          <CardContainer @displayBoundaries={{true}}>
            <Preview @card={{instance}} @format='embedded' />
          </CardContainer>
        {{/each}}
      </div>
    </:content>
    <:footer>
      <p class='error-message'>{{@error}}</p>
      <div class='footer-buttons'>
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
      </div>
    </:footer>
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
    .field-picker-modal :deep(.dialog-box__footer) {
      justify-content: space-between;
      gap: var(--boxel-sp);
    }
    .footer-buttons {
      display: flex;
      justify-content: flex-end;
      gap: var(--boxel-sp-xs);
    }
    .error-message {
      margin-block: 0;
      color: var(--boxel-danger);
      font: 500 var(--boxel-font-sm);
      letter-spacing: var(--boxel-lsp-xs);
    }
  </style>
</template>;

export default component;
