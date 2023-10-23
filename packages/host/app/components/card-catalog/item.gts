import { service } from '@ember/service';
import Component from '@glimmer/component';

import cssUrl from 'ember-css-url';

import { cn } from '@cardstack/boxel-ui/helpers';

import { RealmPaths } from '@cardstack/runtime-common/paths';

import type { CardContext } from 'https://cardstack.com/base/card-api';

import type CardService from '../../services/card-service';
import type LoaderService from '../../services/loader-service';

interface Signature {
  Args: {
    isSelected: boolean;
    title: string | null;
    description: string | null;
    thumbnailURL: string | null;
    context?: CardContext;
  };
}

export default class CardCatalogItem extends Component<Signature> {
  <template>
    <div
      class={{cn
        'catalog-item'
        catalog-item--has-thumbnail=this.thumbnailURL
        catalog-item--selected=@isSelected
      }}
    >
      {{#if this.thumbnailURL}}
        <div
          class='catalog-item__thumbnail'
          style={{cssUrl 'background-image' this.thumbnailURL}}
        />
      {{/if}}
      <div>
        <header class='catalog-item__title'>
          {{@title}}
        </header>
        {{#if @description}}
          <p class='catalog-item__description' data-test-description>
            {{@description}}
          </p>
        {{/if}}
      </div>
    </div>

    <style>
      .catalog-item {
        --catalog-item-thumbnail-size: 2.5rem;
        --catalog-item-height: 3.75rem;
        min-height: var(--catalog-item-height);
        display: grid;
        align-items: center;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light);
      }
      .catalog-item--has-thumbnail {
        grid-template-columns: var(--catalog-item-thumbnail-size) 1fr;
        gap: var(--boxel-sp);
      }
      .catalog-item--selected {
        border-color: var(--boxel-highlight);
        box-shadow: 0 0 0 1px var(--boxel-highlight);
      }
      .catalog-item__thumbnail {
        width: var(--catalog-item-thumbnail-size);
        height: var(--catalog-item-thumbnail-size);
        border-radius: 100px;
        background-size: contain;
        background-position: center;
      }
      .catalog-item__title {
        font: 700 var(--boxel-font-sm);
        color: var(--boxel-dark);
      }
      .catalog-item__description {
        margin: 0;
        font: var(--boxel-font-xs);
        color: var(--boxel-500);
      }
    </style>
  </template>

  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;

  get thumbnailURL() {
    let path = this.args.thumbnailURL;
    if (!path) {
      return;
    }
    let realmPath = new RealmPaths(this.cardService.defaultURL.href);

    if (/^(\.\.\/)+/.test(path)) {
      let localPath = new URL(path, realmPath.url).pathname.replace(/^\//, '');
      return new URL(localPath, realmPath.url).href;
    }
    return new URL(path, realmPath.url).href;
  }
}
