import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { service } from '@ember/service';
import Component from '@glimmer/component';

import { Label } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';
import type RealmService from '@cardstack/host/services/realm';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import CardRenderer from '../card-renderer';

import { removeFileExtension } from './utils';

import type { ComponentLike } from '@glint/template';

interface SearchResultSignature {
  Element: Element;
  Args: {
    component?: ComponentLike<{ Element: Element }>;
    card?: CardDef;
    cardId: string | undefined;
    isCompact: boolean;
    displayRealmName?: boolean;
  };
}

// Render CardDef default fitted template for visual consistency of cards in search results
let resultsCardRef = {
  name: 'CardDef',
  module: 'https://cardstack.com/base/card-api',
};

export class SearchResult extends Component<SearchResultSignature> {
  @service declare realm: RealmService;

  private get urlForRealmLookup() {
    if (!this.args.displayRealmName) {
      return undefined;
    }
    return this.args.card
      ? urlForRealmLookup(this.args.card)
      : this.args.cardId;
  }

  <template>
    <div class='search-result-container'>
      <div class={{cn 'card-container' is-compact=@isCompact}}>
        {{#if @component}}
          <@component
            class='search-result'
            data-test-search-result={{removeFileExtension @cardId}}
            ...attributes
          />

        {{else if @card}}
          <CardRenderer
            @card={{@card}}
            @format='fitted'
            @codeRef={{resultsCardRef}}
            data-test-search-result={{removeFileExtension @cardId}}
            class='search-result'
            ...attributes
          />
        {{/if}}
      </div>
      {{#if this.urlForRealmLookup}}
        {{#let (this.realm.info this.urlForRealmLookup) as |realmInfo|}}
          <div class='realm-name' data-test-realm-name>{{realmInfo.name}}</div>
        {{/let}}
      {{/if}}
    </div>
    <style scoped>
      .search-result-container {
        display: flex;
        flex-direction: column;
        align-items: self-end;
      }
      .card-container {
        display: flex;
        flex-direction: column;
        align-items: self-end;
        width: 100%;
      }
      .search-result,
      .search-result.field-component-card.fitted-format {
        width: var(--item-width, 311px);
        height: var(--item-height, 76px);
        overflow: hidden;
        cursor: pointer;
        container-name: fitted-card;
        container-type: size;
      }
      .is-compact .search-result,
      .is-compact .search-result.field-component-card.fitted-format {
        width: 250px;
        height: 40px;
      }
      .realm-name {
        font: 400 var(--boxel-font);
        color: var(--boxel-400);
        padding-top: var(--boxel-sp-4xs);
        padding-right: var(--boxel-sp-xxs);
        height: 20px;
        font-size: var(--boxel-font-size-xs);
      }
      .is-compact .realm-name {
        display: none;
      }
    </style>
  </template>
}

interface Signature {
  Element: HTMLElement;
  Args: {
    label: string;
    isCompact: boolean;
  };
  Blocks: {
    default: [SearchResultComponent: typeof SearchResult];
  };
}

let ResultsSection: TemplateOnlyComponent<Signature> = <template>
  <div class={{cn 'section' is-compact=@isCompact}}>
    <Label data-test-search-label>{{@label}}</Label>
    <div class='section__body'>
      <div class='section__cards'>
        {{yield SearchResult}}
      </div>
    </div>
  </div>
  <style scoped>
    .section {
      display: flex;
      flex-direction: column;
      width: 100%;
    }
    .section .boxel-label {
      font: 600 var(--boxel-font);
      padding-right: var(--boxel-sp);
    }
    .section__body {
      overflow: auto;
    }
    .section__cards {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      padding: var(--boxel-sp) var(--boxel-sp-xxxs);
      gap: var(--boxel-sp);
    }
    .section.is-compact {
      flex-direction: row;
      align-items: center;
      height: 100%;
    }
    .is-compact .section__cards {
      display: flex;
      flex-wrap: nowrap;
      padding: var(--boxel-sp-xxs);
      gap: var(--boxel-sp-xs);
    }
  </style>
</template>;

export default ResultsSection;
