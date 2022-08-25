import Component from '@glimmer/component';
import type { CardResource } from '@cardstack/runtime-common';
import { tracked } from '@glimmer/tracking';
//@ts-ignore glint does not think `hash` is consumed-but it is in the template
import { fn, hash } from '@ember/helper';
import { action } from '@ember/object';
import CardCatalog from './card-catalog';
import ImportedModuleEditor from './imported-module-editor';

interface Signature {
  Args: {
    realmURL: string;
    onSave?: (url: string) => void;
  }
}

export default class CreateNew extends Component<Signature> {
  <template>
    <section>
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
    </section>
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
