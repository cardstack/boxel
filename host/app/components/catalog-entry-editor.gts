import Component from '@glimmer/component';
import { catalogEntryRef, type ExportedCardRef } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { LinkTo } from '@ember/routing';
import { service } from '@ember/service';
import type RouterService from '@ember/routing/router-service';
import LoaderService from '../services/loader-service';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import { getSearchResults } from '../resources/search';
import LocalRealm from '../services/local-realm';
import CardEditor from './card-editor';
import { cardInstance } from '../resources/card-instance';
import type { Card } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    ref: ExportedCardRef;
  }
}

export default class CatalogEntryEditor extends Component<Signature> {
  <template>
    <div class="catalog-entry-editor" data-test-catalog-entry-editor>
      {{#if this.entry}}
        <fieldset>
          <legend>Edit Catalog Entry</legend>
          <LinkTo @route="application" @query={{hash path=(ensureJsonExtension this.entry.id)}} data-test-catalog-entry-id>
            {{this.entry.id}}
          </LinkTo>
          {{#if this.card.instance}}
            <CardEditor
              @format="embedded"
              @card={{this.card.instance}}
              @onSave={{this.onSave}}
            />
          {{/if}}
        </fieldset>
      {{else}}
        {{#if this.showEditor}}
          {{#if this.card.instance}}
            <fieldset>
              <legend>Publish New Card Type</legend>
              <CardEditor
                @card={{this.card.instance}}
                @onSave={{this.onSave}}
                @onCancel={{this.onCancel}}
              />
            </fieldset>
          {{/if}}
        {{else}}
          <button {{on "click" this.displayEditor}} type="button" data-test-catalog-entry-publish>
            Publish Card Type
          </button>
        {{/if}}
      {{/if}}
    </div>
  </template>

  @service declare localRealm: LocalRealm;
  @service declare loaderService: LoaderService;
  @service declare router: RouterService;
  catalogEntryRef = catalogEntryRef;
  catalogEntry = getSearchResults(this,
    () => ({
      filter: {
        on: this.catalogEntryRef,
        eq: { ref: this.args.ref },
      },
    })
  );
  @tracked showEditor = false;

  get entry() {
    return this.catalogEntry.instances[0];
  }

  get resource() {
    if (this.entry) {
      return this.entry;
    } else {
      return {
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
      };
    }
  }

  card = cardInstance(this, () => this.resource);

  @action
  displayEditor() {
    this.showEditor = true;
  }

  @action
  onCancel() {
    this.showEditor = false;
  }

  @action
  onSave(card: Card) {
    this.router.transitionTo({ queryParams: { path: ensureJsonExtension(card.id)}});
  }
}

function ensureJsonExtension(url: string) {
  if (!url.endsWith('.json')) {
    return `${url}.json`;
  }
  return url;
}
