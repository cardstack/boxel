import Component from '@glimmer/component';
import { type ExportedCardRef, chooseCard, catalogEntryRef } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
//@ts-ignore glint does not think `hash` is consumed-but it is in the template
import { hash } from '@ember/helper';
import { taskFor } from 'ember-concurrency-ts';
import { restartableTask } from 'ember-concurrency';
import type { CatalogEntry } from 'https://cardstack.com/base/catalog-entry';
import Preview from './preview';

interface Signature {
  Args: {
    realmURL: string;
    onSave?: (url: string) => void;
  }
}

export default class CreateNewCard extends Component<Signature> {
  <template>
    <button {{on "click" this.openCatalog}} type="button" data-test-create-new-card-button>
      Create New Card
    </button>
    {{#if this.selectedRef}}
      <dialog class="dialog-box" open>
        <button {{on "click" this.closeEditor}} type="button">X Close</button>
        <div data-test-create-new-card={{this.selectedRef.name}}>
          <h1>Create New Card: {{this.selectedRef.name}}</h1>
          <Preview
            @card={{hash type="new" realmURL=@realmURL cardSource=this.selectedRef}}
            @onSave={{this.save}}
            @onCancel={{this.closeEditor}}
          />
        </div>
      </dialog>
    {{/if}}
  </template>

  @tracked selectedRef: ExportedCardRef | undefined;

  @action
  openCatalog() {
    taskFor(this.chooseNewCard).perform();
  }

  @restartableTask private async chooseNewCard() {
  let entry: CatalogEntry | undefined = await chooseCard({
      filter: { type: catalogEntryRef }
    });
    if (!entry) {
      return;
    }
    this.selectedRef = entry.ref;
  }

  @action
  save(path: string) {
    this.args.onSave?.(path);
    this.closeEditor();
  }

  @action
  closeEditor() {
    this.selectedRef = undefined;
  }
}
