import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { BoxelButton, Modal } from '@cardstack/boxel-ui';

import cssVar from '@cardstack/boxel-ui/helpers/css-var';

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
      <div class='delete'>
        <div class='content'>Remove a field</div>

        <div class='content'>
          Are you sure you want to remove the
          <b>{{@field.name}}</b>
          field from the
          <b>{{@card.displayName}}</b>
          card?
        </div>

        <div class='content disclaimer'>This action is not reversible.</div>

        <div class='buttons'>
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
        </div>
      </div>
    </Modal>

    <style>
      .content {
        width: 100%;
        font-size: var(--boxel-font-size);
        text-align: center;
        margin-top: var(--boxel-sp);
      }
      .content:first-child {
        margin-top: 0;
      }
      .disclaimer {
        color: var(--boxel-danger);
        font-size: var(--boxel-font-size-xs);
      }
      .delete {
        padding: var(--boxel-sp-lg) var(--boxel-sp-xl) var(--boxel-sp);
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
