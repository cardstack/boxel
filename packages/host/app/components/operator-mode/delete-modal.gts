import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { enqueueTask, dropTask, timeout, all } from 'ember-concurrency';

import { BoxelButton, Modal } from '@cardstack/boxel-ui/components';
import { cssVar } from '@cardstack/boxel-ui/helpers';

import { Deferred } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    onCreate: (instance: DeleteModal) => void;
  };
}

export default class DeleteModal extends Component<Signature> {
  <template>
    <Modal
      data-test-delete-modal-container
      data-test-delete-modal={{this.id}}
      @layer='urgent'
      @size='x-small'
      @isOpen={{true}}
      @onClose={{fn this.choose false}}
      style={{cssVar boxel-modal-offset-top='40vh'}}
    >
      <section class='delete'>
        <p class='content' data-test-delete-msg>
          {{#if this.name}}
            Delete the
            {{this.currentConfirmation.type}}<br />
            <strong>{{this.name}}</strong>?
          {{else}}
            Delete this
            {{this.currentConfirmation.type}}?
          {{/if}}
        </p>
        <p class='content disclaimer'>This action is not reversible.</p>
        <footer class='buttons'>
          {{#if this.waitForDelete.isRunning}}
            <BoxelButton @size='tall' @kind='danger' @loading={{true}}>
              Deleting
            </BoxelButton>
          {{else}}
            <BoxelButton
              data-test-confirm-cancel-button
              @size='tall'
              @kind='secondary-light'
              {{on 'click' (fn this.choose false)}}
            >
              Cancel
            </BoxelButton>
            <BoxelButton
              data-test-confirm-delete-button
              @size='tall'
              @kind='danger'
              {{on 'click' (fn this.choose true)}}
            >
              Delete
            </BoxelButton>
          {{/if}}
        </footer>
      </section>
    </Modal>

    <style>
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
        justify-content: center;
        width: 100%;
      }
      button:first-child {
        margin-right: var(--boxel-sp-xs);
      }
    </style>
  </template>

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.args.onCreate(this);
  }

  @tracked private currentConfirmation:
    | {
        type: 'card';
        card: CardDef;
        choiceDeferred: Deferred<boolean>;
        deleteDeferred: Deferred<void>;
      }
    | {
        type: 'file';
        url: URL;
        choiceDeferred: Deferred<boolean>;
        deleteDeferred: Deferred<void>;
      }
    | undefined;

  private get name() {
    if (this.currentConfirmation?.type === 'card') {
      return this.currentConfirmation.card.title;
    } else if (this.currentConfirmation?.type === 'file') {
      return this.currentConfirmation.url.href.split('/').pop()!;
    }
    return;
  }

  private get id() {
    if (this.currentConfirmation?.type === 'card') {
      return this.currentConfirmation.card.id;
    } else if (this.currentConfirmation?.type === 'file') {
      return this.currentConfirmation.url.href;
    }
    return;
  }

  // public API for callers to use this component
  async confirmDelete(
    item: CardDef | URL,
    setDeferred: (deleteDeferred: Deferred<void>) => void,
  ) {
    let deleteDeferred = new Deferred<void>();
    setDeferred(deleteDeferred);
    return await this.presentChoice.perform(item, deleteDeferred);
  }

  private presentChoice = enqueueTask(
    async (item: CardDef | URL, deleteDeferred: Deferred<void>) => {
      if (item instanceof URL) {
        this.currentConfirmation = {
          type: 'file',
          url: item,
          choiceDeferred: new Deferred(),
          deleteDeferred,
        };
      } else {
        this.currentConfirmation = {
          type: 'card',
          card: item,
          choiceDeferred: new Deferred(),
          deleteDeferred,
        };
      }
      let choice = await this.currentConfirmation.choiceDeferred.promise;
      return choice ?? false;
    },
  );

  private waitForDelete = dropTask(async () => {
    if (this.currentConfirmation) {
      await all([
        this.currentConfirmation.deleteDeferred.promise,
        timeout(500), // display the message long enough for the user to read it
      ]);
      this.currentConfirmation = undefined;
    }
  });

  @action private choose(choice: boolean) {
    if (this.currentConfirmation) {
      this.currentConfirmation.choiceDeferred.fulfill(choice);
      if (choice) {
        this.waitForDelete.perform();
      } else {
        this.currentConfirmation = undefined;
      }
    }
  }
}
