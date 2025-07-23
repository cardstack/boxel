import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { type getCardCollection } from '@cardstack/runtime-common';

import CardPill from '@cardstack/host/components/card-pill';
import FilePill from '@cardstack/host/components/file-pill';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';

import type { FileDef } from 'https://cardstack.com/base/file-api';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    items?: (ReturnType<getCardCollection> | FileDef)[];
    downloadFile?: (file: FileDef) => Promise<void>;
  };
}

const Attachments: TemplateOnlyComponent<Signature> = <template>
  <ul class='items' data-test-message-items>
    {{#each @items as |item|}}
      {{#if (isCardCollectionResource item)}}
        {{#each item.cards as |card|}}
          <li>
            <CardPill
              @cardId={{card.id}}
              @borderType='solid'
              @urlForRealmLookup={{urlForRealmLookup card}}
            />
          </li>
        {{/each}}
      {{else}}
        <li>
          <FilePill
            @file={{item}}
            @borderType='solid'
            @onDownload={{onDownload item @downloadFile}}
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
