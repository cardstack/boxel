import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { enqueueTask, dropTask, timeout, all } from 'ember-concurrency';

import BoxelButton from '@cardstack/boxel-ui/components/button';
import Modal from '@cardstack/boxel-ui/components/modal';

import cssVar from '@cardstack/boxel-ui/helpers/css-var';

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
      data-test-delete-modal={{this.currentConfirmation.card.id}}
      @layer='urgent'
      @size='x-small'
      @isOpen={{this.showModal}}
      @onClose={{fn this.choose false}}
      style={{cssVar boxel-modal-offset-top='40vh'}}
    >
      <div class='delete'>
        <div class='content'>Delete the card</div>
        <div class='content'>
          <strong>{{this.currentConfirmation.card.title}}</strong>?
        </div>
        <div class='content disclaimer'>This action is not reversable</div>
        <div class='buttons'>
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
        </div>
      </div>
    </Modal>

    <style>
      .content {
        width: 100%;
        font-size: var(--boxel-font-size);
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .disclaimer {
        margin-top: var(--boxel-sp-xs);
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

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.args.onCreate(this);
  }

  @tracked private currentConfirmation:
    | {
        card: CardDef;
        choiceDeferred: Deferred<boolean>;
        deleteDeferred: Deferred<void>;
      }
    | undefined;

  // public API for callers to use this component
  async confirmDelete(
    card: CardDef,
    setDeferred: (deleteDeferred: Deferred<void>) => void,
  ) {
    let deleteDeferred = new Deferred<void>();
    setDeferred(deleteDeferred);
    return await this.presentChoice.perform(card, deleteDeferred);
  }

  private get showModal() {
    return !!this.currentConfirmation;
  }

  private presentChoice = enqueueTask(
    async (card: CardDef, deleteDeferred: Deferred<void>) => {
      this.currentConfirmation = {
        card,
        choiceDeferred: new Deferred(),
        deleteDeferred,
      };
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
