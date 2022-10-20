import Component from '@glimmer/component';
import { catalogEntryRef, type ExportedCardRef, type Card } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { LinkTo } from '@ember/routing';
import { service } from '@ember/service';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import { getSearchResults } from '../resources/search';
import CardService from '../services/card-service';
import CardEditor from './card-editor';

interface Signature {
  Args: {
    ref: ExportedCardRef;
  }
}

export default class CatalogEntryEditor extends Component<Signature> {
  <template>
    <div class="catalog-entry-editor" data-test-catalog-entry-editor>
      {{#if this.card}}
        <fieldset>
          <legend>Edit Catalog Entry</legend>
          <LinkTo @route="application" @query={{hash path=(ensureJsonExtension this.card.id)}} data-test-catalog-entry-id>
            {{this.card.id}}
          </LinkTo>
          <CardEditor
            @format="embedded"
            @card={{this.card}}
            @onSave={{this.onSave}}
          />
        </fieldset>
      {{else if this.newEntry}}
        <fieldset>
          <legend>Publish New Card Type</legend>
          <CardEditor
            @card={{this.newEntry}}
            @onSave={{this.onSave}}
            @onCancel={{this.onCancel}}
          />
        </fieldset>
      {{else}}
        <button {{on "click" this.createEntry}} type="button" data-test-catalog-entry-publish>
          Publish Card Type
        </button>
      {{/if}}
    </div>
  </template>

  @service declare cardService: CardService;
  catalogEntryRef = catalogEntryRef;
  catalogEntry = getSearchResults(this,
    () => ({
      filter: {
        on: this.catalogEntryRef,
        eq: { ref: this.args.ref },
      },
    })
  );
  @tracked entry: Card | undefined;
  @tracked newEntry: Card | undefined;

  get card() {
    return this.entry ?? this.catalogEntry.instances[0];
  }

  @action
  async createEntry(): Promise<void> {
    this.newEntry = await this.cardService.makeCardFromResponse({
      data: {
        attributes: {
          title: this.args.ref.name,
          description: `Catalog entry for ${this.args.ref.name} card`,
          ref: this.args.ref,
          demo: undefined
        },
        meta: {
          adoptsFrom: this.catalogEntryRef,
          fields: {
            demo: {
              adoptsFrom: this.args.ref
            }
          }
        }
      }
    });
  }

  @action
  onCancel() {
    this.newEntry = undefined;
  }

  @action
  onSave(card: Card) {
    this.entry = card;
  }
}

function ensureJsonExtension(url: string) {
  if (!url.endsWith('.json')) {
    return `${url}.json`;
  }
  return url;
}
