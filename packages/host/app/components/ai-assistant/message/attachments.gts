import type { TemplateOnlyComponent } from '@ember/component/template-only';

import type { getCardCollection } from '@cardstack/runtime-common';

import CardPill from '@cardstack/host/components/card-pill';
import FilePill from '@cardstack/host/components/file-pill';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';

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

const Attachments: TemplateOnlyComponent<Signature> = <template>
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
</template>;

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

export default Attachments;
