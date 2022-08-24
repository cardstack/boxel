import Component from '@glimmer/component';
import { type CardResource } from '@cardstack/runtime-common';
//@ts-ignore cached not available yet in definitely typed
import { tracked, cached } from '@glimmer/tracking';
import { on } from '@ember/modifier';
//@ts-ignore glint does not think `hash` is consumed-but it is in the template
import { fn, hash } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';
import LocalRealm from '../services/local-realm';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import { Loader } from '@cardstack/runtime-common/loader';
import type RouterService from '@ember/routing/router-service';
import CardCatalog from './card-catalog';
import ImportedModuleEditor from './imported-module-editor';

interface Signature {
  Args: {
    onClose: () => void;
  }
}

export default class CreateNew extends Component<Signature> {
  <template>
    <button {{on "click" @onClose}} type="button">X Close</button>
    <section>
      <h1>Create New Card:</h1>
      {{#if this.selectedCard}}
        <fieldset>
          <legend>Create New {{this.selectedCard.attributes.title}}</legend>
          <ImportedModuleEditor
            @moduleURL={{this.selectedCard.attributes.ref.module}}
            @cardArgs={{hash type="new" realmURL=this.localRealm.url.href cardSource=this.selectedCard.attributes.ref}}
            @onSave={{this.onSave}}
            @onCancel={{this.onCancel}}
          />
        </fieldset>
      {{else}}
        <CardCatalog @onSelect={{this.onSelect}} />
      {{/if}}
    </section>
  </template>

  @service declare localRealm: LocalRealm;
  @service declare router: RouterService;
  @tracked selectedCard: CardResource | undefined;

  @cached
  get realmPath() {
    if (!this.localRealm.isAvailable) {
      throw new Error('Local realm is not available');
    }
    return new RealmPaths(Loader.reverseResolution(this.localRealm.url.href));
  }

  @action
  onSelect(entry: CardResource) {
    this.selectedCard = entry;
  }

  @action
  onSave(url: string) {
    let path = this.realmPath.local(new URL(url));
    this.router.transitionTo({ queryParams: { path } });
    this.selectedCard = undefined;
    this.args.onClose();
  }

  @action
  onCancel() {
    this.selectedCard = undefined;
  }
}
