import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { BoxelButton, Modal } from '@cardstack/boxel-ui/components';

import { cssVar } from '@cardstack/boxel-ui/helpers';

import { identifyCard } from '@cardstack/runtime-common';

import type { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import { FieldOfType } from '@cardstack/host/resources/card-type';
import { Ready } from '@cardstack/host/resources/file';

import { BaseDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    card: typeof BaseDef;
    file: Ready;
    moduleSyntax: ModuleSyntax;
    field: FieldOfType;
    onClose: () => void;
  };
  Element: HTMLElement;
}

export default class RemoveFieldModal extends Component<Signature> {
  private removeFieldTask = restartableTask(async () => {
    let { field, card, file, moduleSyntax } = this.args;
    let identifiedCard = identifyCard(card) as {
      module: string;
      name: string;
    };

    this.args.moduleSyntax.removeField(
      { type: 'exportedName', name: identifiedCard.name },
      field.name,
    );

    await file.write(moduleSyntax.code(), true);
    this.args.onClose();
  });

  <template>
    <Modal
      @layer='urgent'
      @size='x-small'
      @isOpen={{true}}
      @onClose={{@onClose}}
      style={{cssVar boxel-modal-offset-top='40vh'}}
      data-test-remove-field-modal
    >
      <section class='delete'>
        <header class='header'>Remove a Field</header>

        <p class='content'>
          Are you sure you want to remove the
          <strong>{{@field.name}}</strong>
          field from the
          <strong>{{@card.displayName}}</strong>
          card?
        </p>

        <p class='content disclaimer'>This action is not reversible.</p>

        <footer class='buttons'>
          <BoxelButton
            @size='tall'
            @kind='secondary-light'
            @disabled={{this.removeFieldTask.isRunning}}
            {{on 'click' @onClose}}
            data-test-cancel-remove-field-button
          >
            Cancel
          </BoxelButton>

          <BoxelButton
            @size='tall'
            @kind='danger'
            @loading={{this.removeFieldTask.isRunning}}
            @disabled={{this.removeFieldTask.isRunning}}
            {{on 'click' (perform this.removeFieldTask)}}
            data-test-remove-field-button
          >
            {{#if this.removeFieldTask.isRunning}}
              Removing…
            {{else}}
              Remove
            {{/if}}
          </BoxelButton>
        </footer>
      </section>
    </Modal>

    <style>
      .header {
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
        text-align: center;
      }
      .content {
        margin: 0;
        width: 100%;
        font: 500 var(--boxel-font);
        letter-spacing: var(--boxel-lsp-xs);
        text-align: center;
      }
      .content + .content {
        margin-top: var(--boxel-sp-xs);
      }
      .header + .content {
        margin-top: var(--boxel-sp);
      }
      .disclaimer {
        color: var(--boxel-danger);
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
      }
      .delete {
        padding: var(--boxel-sp-lg) var(--boxel-sp-lg) var(--boxel-sp);
        background-color: white;
        border-radius: var(--boxel-border-radius-xl);
        box-shadow: var(--boxel-deep-box-shadow);
      }
      .buttons {
        margin-top: var(--boxel-sp-lg);
        display: flex;
        justify-content: center;
        width: 100%;
      }
      button:first-child {
        margin-right: var(--boxel-sp-xs);
      }
    </style>
  </template>
}
