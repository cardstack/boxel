import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { enqueueTask } from 'ember-concurrency';
import { Deferred } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { Modal, BoxelButton } from '@cardstack/boxel-ui';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';
import type { Card } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    onCreate: (instance: DeleteModal) => void;
  };
}

export default class DeleteModal extends Component<Signature> {
  <template>
    <Modal
      @layer='urgent'
      @size='x-small'
      @isOpen={{this.showModal}}
      @onClose={{fn this.choose false}}
      style={{cssVar boxel-modal-offset-top='40vh'}}
    >
      <div class='delete'>
        <div class='content'>Delete the card</div>
        <div class='content'><strong
          >{{this.currentConfirmation.card.title}}</strong>?</div>
        <div class='content disclaimer'>This action is not reversable</div>
        <div class='buttons'>
          <BoxelButton
            @size='tall'
            @kind='secondary-light'
            {{on 'click' (fn this.choose false)}}
          >
            Cancel
          </BoxelButton>
          <BoxelButton
            @size='tall'
            @kind='danger'
            {{on 'click' (fn this.choose true)}}
          >
            Delete
          </BoxelButton>
        </div>
      </div>
    </Modal>

    <style>
      .content {
        width: 100%;
        font-size: var(--boxel-font-size);
        text-align: center;
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
        box-shadow: 0 15px 50px 0 rgba(0, 0, 0, 0.4);
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

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.args.onCreate(this);
  }

  @tracked private currentConfirmation:
    | { card: Card; deferred: Deferred<boolean> }
    | undefined;

  // public API for callers to use this component
  async confirmDelete(card: Card) {
    return await this.presentChoice.perform(card);
  }

  private get showModal() {
    return !!this.currentConfirmation;
  }

  private presentChoice = enqueueTask(async (card: Card) => {
    this.currentConfirmation = {
      card,
      deferred: new Deferred(),
    };
    let choice = await this.currentConfirmation.deferred.promise;
    return choice ?? false;
  });

  @action private choose(choice: boolean) {
    if (this.currentConfirmation) {
      this.currentConfirmation.deferred.fulfill(choice);
      this.currentConfirmation = undefined;
    }
  }
}
