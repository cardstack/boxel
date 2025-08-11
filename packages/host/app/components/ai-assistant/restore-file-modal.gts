import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { on } from '@ember/modifier';

import { BoxelButton, Modal } from '@cardstack/boxel-ui/components';
import { cssVar } from '@cardstack/boxel-ui/helpers';

interface Signature {
  Args: {
    onConfirm: () => void;
    onCancel: () => void;
    isRestoreRunning: boolean;
  };
  Blocks: {
    content: [];
  };
}

let component: TemplateOnlyComponent<Signature> = <template>
  <Modal
    data-test-restore-file-modal-container
    @layer='urgent'
    @size='x-small'
    @isOpen={{true}}
    @onClose={{@onCancel}}
    style={{cssVar boxel-modal-offset-top='40vh'}}
  >
    <section class='restore'>
      <p class='content'>
        Are you sure you want to restore file contents?
      </p>
      <p class='content disclaimer'>This action is not reversible.</p>
      <footer class='buttons'>
        {{#if @isRestoreRunning}}
          <BoxelButton @size='tall' @kind='danger' @loading={{true}}>
            Restoring
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
            data-test-confirm-restore-button
            @size='tall'
            @kind='danger'
            {{on 'click' @onConfirm}}
          >
            Restore
          </BoxelButton>
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
    .restore {
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
