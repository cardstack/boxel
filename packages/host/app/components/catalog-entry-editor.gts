import Component from '@glimmer/component';
import {
  catalogEntryRef,
  type CardRef,
  humanReadable,
} from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { LinkTo } from '@ember/routing';
import { service } from '@ember/service';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template
import { hash } from '@ember/helper';
import { getSearchResults } from '../resources/search';
import type CardService from '../services/card-service';
import CardEditor from './card-editor';
import { type Card } from 'https://cardstack.com/base/card-api';
import { Button, CardContainer } from '@cardstack/boxel-ui';

interface Signature {
  Args: {
    ref: CardRef;
  };
}

export default class CatalogEntryEditor extends Component<Signature> {
  <template>
    <div data-test-catalog-entry-editor>
      {{#if this.card}}
        <CardContainer @title='Edit Catalog Entry' @displayBoundaries={{true}}>
          <div class='catalog-entry-editor'>
            <LinkTo
              @route='code'
              @query={{hash path=(ensureJsonExtension this.card.id)}}
              data-test-catalog-entry-id
            >
              {{this.card.id}}
            </LinkTo>
            <CardEditor
              @format='embedded'
              @card={{this.card}}
              @onSave={{this.onSave}}
            />
          </div>
        </CardContainer>
      {{else if this.newEntry}}
        <CardContainer
          @title='Create Catalog Entry'
          @displayBoundaries={{true}}
        >
          <div class='catalog-entry-editor'>
            <CardEditor
              @card={{this.newEntry}}
              @onSave={{this.onSave}}
              @onCancel={{this.onCancel}}
            />
          </div>
        </CardContainer>
      {{else if this.catalogEntry.isSearching}}
        <div>Loading...</div>
      {{else}}
        <Button
          @kind='primary'
          @size='tall'
          {{on 'click' this.createEntry}}
          data-test-catalog-entry-publish
        >
          Publish Card Type
        </Button>
      {{/if}}
    </div>
  </template>

  @service declare cardService: CardService;
  catalogEntryRef = catalogEntryRef;
  catalogEntry = getSearchResults(this, () => ({
    filter: {
      on: this.catalogEntryRef,
      eq: { ref: this.args.ref },
    },
  }));
  @tracked entry: Card | undefined;
  @tracked newEntry: Card | undefined;

  get card() {
    return this.entry ?? this.catalogEntry.instances[0];
  }

  @action
  async createEntry(): Promise<void> {
    let resource = {
      attributes: {
        title: humanReadable(this.args.ref),
        description: `Catalog entry for ${humanReadable(this.args.ref)}`,
        ref: this.args.ref,
        demo: undefined,
      },
      meta: {
        adoptsFrom: this.catalogEntryRef,
        fields: {
          demo: {
            adoptsFrom: this.args.ref,
          },
        },
      },
    };
    this.newEntry = await this.cardService.createFromSerialized(
      resource,
      { data: resource },
      this.cardService.defaultURL
    );
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
