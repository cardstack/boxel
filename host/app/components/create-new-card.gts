import Component from '@glimmer/component';
import type { CardResource } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import get from 'lodash/get';
//@ts-ignore glint does not think `hash` is consumed-but it is in the template
import { hash } from '@ember/helper';

import CardCatalog from './card-catalog';
import CardEditor from './card-editor';

interface Signature {
  Args: {
    realmURL: string;
    onSave?: (url: string) => void;
    onClose?: () => void;
  }
}

export default class CreateNewCard extends Component<Signature> {
  <template>
    <dialog class="dialog-box" open>
      {{#if @onClose}}
        <button {{on "click" @onClose}} type="button">X Close</button>
      {{/if}}
      <div data-test-create-new data-test-create-new-card={{this.selectedCard.id}}>
        <h1>Create New Card: {{this.selectedCard.attributes.title}}</h1>
        {{#if this.selectedCard}}
          <CardEditor
            @moduleURL={{get (getRef this.selectedCard) "module"}}
            @cardArgs={{hash type="new" realmURL=@realmURL cardSource=(getRef this.selectedCard)}}
            @onSave={{this.onSave}}
            @onCancel={{this.onCancel}}
          />
        {{else}}
          <CardCatalog
            @realmURL={{@realmURL}}
            @onSelect={{this.onSelect}}
          />
        {{/if}}
      </div>
    </dialog>
  </template>

  @tracked selectedCard: CardResource | undefined = undefined;

  @action
  onSelect(entry: CardResource) {
    this.selectedCard = entry;
  }

  @action
  onSave(url: string) {
    this.selectedCard = undefined;
    if (this.args.onSave) {
      this.args.onSave(url);
    }
  }

  @action
  onCancel() {
    this.selectedCard = undefined;
  }
}

function getRef(card: CardResource) {
  return {
    module: card.attributes?.["ref.module"],
    name: card.attributes?.["ref.name"],
  };
}
