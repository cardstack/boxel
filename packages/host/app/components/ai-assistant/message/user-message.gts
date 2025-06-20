import Component from '@glimmer/component';

import { cn } from '@cardstack/boxel-ui/helpers';

import { type getCardCollection } from '@cardstack/runtime-common';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import { sanitizedHtml } from '@cardstack/host/helpers/sanitized-html';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';

import CardPill from '@cardstack/host/components/card-pill';
import FilePill from '@cardstack/host/components/file-pill';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    html?: string;
    hasItems?: boolean;
    items?: (ReturnType<getCardCollection> | FileDef)[];
    downloadDebugFile?: (file: FileDef) => Promise<void>;
    isPending?: boolean;
  };
}

export default class UserMessage extends Component<Signature> {
  <template>
    <div class={{cn 'user-message' is-pending=@isPending}}>
      {{sanitizedHtml @html}}

      {{#if @hasItems}}
        <div class='items' data-test-message-items>
          {{#each @items as |item|}}
            {{#if (isCardCollectionResource item)}}
              {{#each item.cards as |card|}}
                <CardPill
                  @cardId={{card.id}}
                  @urlForRealmLookup={{urlForRealmLookup card}}
                />
              {{/each}}
            {{else}}
              <FilePill
                @file={{item}}
                @downloadFile={{if @downloadDebugFile @downloadDebugFile}}
              />
            {{/if}}
          {{/each}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .user-message {
        position: relative;
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        border-radius: var(--boxel-border-radius-xxl);
        border-top-left-radius: var(--boxel-border-radius-xs);
        font-size: var(--boxel-font-size-sm);
        font-weight: 400;
        line-height: 1.5em;
        letter-spacing: var(--boxel-lsp-xs);
        text-wrap: pretty;

        /* the below font-smoothing options are only recommended for light-colored
          text on dark background (otherwise not good for accessibility) */
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      .user-message > :deep(*) {
        margin-block: 0;
      }
      .user-message > :deep(* + *) {
        margin-block-start: var(--boxel-sp-sm);
      }
      .is-pending {
        --pill-background-color: var(--boxel-200);
        --pill-font-color: var(--boxel-500);
        background-color: var(--boxel-200);
        color: var(--boxel-500);
      }
      .items {
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
