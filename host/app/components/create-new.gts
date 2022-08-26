import Component from '@glimmer/component';
import type { CardResource } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import CardCatalog from './card-catalog';
import ImportedModuleEditor from './imported-module-editor';
import ModalService from '../services/modal';
import { service } from '@ember/service';
//@ts-ignore glint does not think `hash` is consumed-but it is in the template
import { hash } from '@ember/helper';

interface Signature {
  Args: {
    realmURL: string;
    onSave?: (url: string) => void;
    onOpenCatalog?: () => void;
    onCloseCatalog?: () => void;
  }
}

export default class CreateNew extends Component<Signature> {
  <template>
    <button {{on "click" this.openCatalog}} type="button" data-test-create-new-card-button>
      Create New Card
    </button>
    {{#if this.modal.isShowing}}
      <dialog class="dialog-box" open>
        <button {{on "click" this.closeCatalog}} type="button">X Close</button>
        <div data-test-create-new data-test-create-new-card={{this.selectedCard.id}}>
          <h1>Create New Card: {{this.selectedCard.attributes.title}}</h1>
          {{#if this.selectedCard}}
            <ImportedModuleEditor
              @moduleURL={{this.selectedCard.attributes.ref.module}}
              @cardArgs={{hash type="new" realmURL=@realmURL cardSource=this.selectedCard.attributes.ref}}
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
    {{/if}}
  </template>

  @service declare modal: ModalService;
  @tracked selectedCard: CardResource | undefined = undefined;

  @action
  openCatalog() {
    this.modal.open();
    if (this.args.onOpenCatalog) {
      this.args.onOpenCatalog();
    }
  }

  @action
  closeCatalog() {
    this.selectedCard = undefined;
    this.modal.close();
    if (this.args.onCloseCatalog) {
      this.args.onCloseCatalog();
    }
  }

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
