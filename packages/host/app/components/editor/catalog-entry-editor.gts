import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { LinkTo } from '@ember/routing';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import CardContainer from '@cardstack/boxel-ui/components/card-container';
import Button from '@cardstack/boxel-ui/components/button';

import {
  catalogEntryRef,
  type CodeRef,
  humanReadable,
  SupportedMimeType,
} from '@cardstack/runtime-common';
//@ts-ignore glint does not think this is consumed-but it is consumed in the template

import CardEditor from '@cardstack/host/components/card-editor';
import { getSearchResults } from '@cardstack/host/resources/search';
import type CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';

import { CardDef } from 'https://cardstack.com/base/card-api';
import { type CatalogEntry } from 'https://cardstack.com/base/catalog-entry';

interface Signature {
  Args: {
    ref: CodeRef;
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
      {{else if this.catalogEntry.isLoading}}
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
    <style>
      .catalog-entry-editor {
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
      }
    </style>
  </template>

  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;
  catalogEntryRef = catalogEntryRef;
  catalogEntry = getSearchResults(this, () => ({
    filter: {
      on: this.catalogEntryRef,
      eq: { ref: this.args.ref },
    },
  }));
  @tracked entry: CatalogEntry | undefined;
  @tracked newEntry: CatalogEntry | undefined;

  get card() {
    return this.entry ?? this.catalogEntry.instances[0];
  }

  @action
  async createEntry(): Promise<void> {
    let loader = this.loaderService.loader;
    let realmInfoResponse = await loader.fetch(
      `${this.cardService.defaultURL}_info`,
      { headers: { Accept: SupportedMimeType.RealmInfo } },
    );

    let resource = {
      attributes: {
        title: humanReadable(this.args.ref),
        description: `Catalog entry for ${humanReadable(this.args.ref)}`,
        ref: this.args.ref,
        demo: undefined,
      },
      meta: {
        adoptsFrom: this.catalogEntryRef,
        realmInfo: (await realmInfoResponse.json())?.data?.attributes,
        realmURL: this.cardService.defaultURL.href,
        fields: {
          demo: {
            adoptsFrom: this.args.ref,
          },
        },
      },
    };
    this.newEntry = (await this.cardService.createFromSerialized(
      resource,
      { data: resource },
      this.cardService.defaultURL,
    )) as CatalogEntry;
  }

  @action
  onCancel() {
    this.newEntry = undefined;
  }

  @action
  onSave(card: CardDef) {
    this.entry = card as CatalogEntry;
  }
}

function ensureJsonExtension(url: string) {
  if (!url.endsWith('.json')) {
    return `${url}.json`;
  }
  return url;
}
