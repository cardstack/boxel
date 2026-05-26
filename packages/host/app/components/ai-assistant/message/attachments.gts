import { service } from '@ember/service';
import Component from '@glimmer/component';

import type {
  CardErrorJSONAPI,
  getCardCollection,
} from '@cardstack/runtime-common';

import CardPill from '@cardstack/host/components/card-pill';
import FilePill from '@cardstack/host/components/file-pill';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';

import type NetworkService from '@cardstack/host/services/network';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { FileDef } from 'https://cardstack.com/base/file-api';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    items?: (ReturnType<getCardCollection> | FileDef)[];
    attachedCardsAsFiles?: FileDef[] | undefined;
    downloadFile?: (file: FileDef) => Promise<void>;
  };
}

function findAttachedCardAsFile(
  attachedCardsAsFiles: FileDef[] | undefined,
  card: CardDef,
) {
  return attachedCardsAsFiles?.find((file) => file.sourceUrl === card.id);
}

export default class Attachments extends Component<Signature> {
  @service declare private network: NetworkService;

  private cardErrorRealm = (cardError: CardErrorJSONAPI) => {
    if (cardError.realm) {
      return cardError.realm;
    }
    let id = cardError.id;
    if (!id) {
      return '';
    }
    try {
      let url = this.network.virtualNetwork.toURL(id);
      let lastSlashIndex = url.pathname.lastIndexOf('/');
      let pathname =
        lastSlashIndex >= 0 ? url.pathname.slice(0, lastSlashIndex + 1) : '/';
      return `${url.origin}${pathname}`;
    } catch {
      return id;
    }
  };

  private cardErrorDisplayTitle = (cardError: CardErrorJSONAPI) => {
    if (cardError.meta.cardTitle) {
      return cardError.meta.cardTitle;
    }
    let id = cardError.id;
    if (!id) {
      return 'Unavailable card';
    }
    let path = id;
    try {
      path = this.network.virtualNetwork.toURL(id).pathname;
    } catch {
      // ignore invalid urls
    }
    if (path.startsWith('/')) {
      path = path.slice(1);
    }
    let segments = path.split('/').filter(Boolean);
    let label = segments.slice(-2).join('/');
    return label.replace(/\.[^.]+$/, '') || 'Unavailable card';
  };

  <template>
    <ul class='items' data-test-message-items>
      {{#each @items as |item|}}
        {{#if (isCardCollectionResource item)}}
          {{#each item.cards as |card|}}
            <li>
              {{#let
                (findAttachedCardAsFile @attachedCardsAsFiles card)
                as |file|
              }}
                <CardPill
                  @cardId={{card.id}}
                  @file={{file}}
                  @borderType='solid'
                  @urlForRealmLookup={{urlForRealmLookup card}}
                  @fileActionsEnabled={{if file true false}}
                />
              {{/let}}
            </li>
          {{/each}}
          {{#each item.cardErrors as |cardError|}}
            {{#if cardError.id}}
              <li>
                <CardPill
                  @cardId={{cardError.id}}
                  @displayTitle={{this.cardErrorDisplayTitle cardError}}
                  @borderType='solid'
                  @showErrorIcon={{true}}
                  @urlForRealmLookup={{this.cardErrorRealm cardError}}
                  title={{cardError.id}}
                  data-test-attached-card-error={{cardError.id}}
                />
              </li>
            {{/if}}
          {{/each}}
        {{else}}
          <li>
            <FilePill
              @file={{item}}
              @borderType='solid'
              @onDownload={{onDownload item @downloadFile}}
              @fileActionsEnabled={{true}}
            />
          </li>
        {{/if}}
      {{/each}}
    </ul>
    <style scoped>
      .items {
        list-style-type: none;
        padding-inline-start: 0;
        margin-block: 0;
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
      }
    </style>
  </template>
}

function isCardCollectionResource(
  obj: any,
): obj is ReturnType<getCardCollection> {
  return 'value' in obj;
}

function onDownload(
  item: FileDef,
  downloadFile?: (file: FileDef) => Promise<void>,
) {
  return downloadFile ? () => downloadFile(item) : undefined;
}
