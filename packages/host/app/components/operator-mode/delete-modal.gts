import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { BoxelButton, Modal } from '@cardstack/boxel-ui/components';
import { cssVar } from '@cardstack/boxel-ui/helpers';

interface ItemToDelete {
  id: string;
  [key: string]: any;
}

interface Signature {
  Args: {
    itemToDelete: ItemToDelete;
    onConfirm: (item: ItemToDelete) => void;
    onCancel: () => void;
    isDeleteRunning?: boolean;
    error?: string;
  };
  Blocks: {
    content: [];
  };
}

let component: TemplateOnlyComponent<Signature> = <template>
  <Modal
    data-test-delete-modal-container
    data-test-delete-modal={{@itemToDelete.id}}
    @layer='urgent'
    @size='x-small'
    @isOpen={{true}}
    @onClose={{@onCancel}}
    style={{cssVar boxel-modal-offset-top='40vh'}}
  >
    <section class='delete'>
      <p class='content' data-test-delete-msg>
        {{yield to='content'}}
      </p>
      <p class='content disclaimer'>This action is not reversible.</p>
      <footer class='buttons'>
        {{#if @isDeleteRunning}}
          <BoxelButton @size='tall' @kind='danger' @loading={{true}}>
            Deleting
          </BoxelButton>
        {{else}}
          <BoxelButton
            data-test-confirm-cancel-button
            @size='tall'
            @kind='secondary-light'
            {{on 'click' @onCancel}}
          >
            Cancel
          </BoxelButton>
          <BoxelButton
            data-test-confirm-delete-button
            @size='tall'
            @kind='danger'
            {{on 'click' (fn @onConfirm @itemToDelete)}}
          >
            Delete
          </BoxelButton>
        {{/if}}
        {{#if @error}}
          <p class='error'>{{@error}}</p>
        {{/if}}
      </footer>
    </section>
  </Modal>

  <style scoped>
    .content {
      width: 100%;
      margin: 0;
      font: 500 var(--boxel-font);
      letter-spacing: var(--boxel-lsp-xs);
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .content + .content {
      margin-top: var(--boxel-sp-xs);
    }
    .disclaimer {
      color: var(--boxel-danger);
      font: 500 var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-xs);
    }
    .delete {
      padding: var(--boxel-sp-lg) var(--boxel-sp-lg) var(--boxel-sp);
      background-color: var(--boxel-light);
      border-radius: var(--boxel-border-radius-xl);
      box-shadow: var(--boxel-deep-box-shadow);
    }
    .buttons {
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
