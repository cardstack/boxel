import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { service } from '@ember/service';
import Component from '@glimmer/component';

import { Label, FittedCardContainer } from '@cardstack/boxel-ui/components';
import { cn, type FittedFormatId } from '@cardstack/boxel-ui/helpers';

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
  };
}

// Render CardDef default fitted template for visual consistency of cards in search results
let resultsCardRef = {
  name: 'CardDef',
  module: 'https://cardstack.com/base/card-api',
};

class SearchResult extends Component<SearchResultSignature> {
  @service declare realm: RealmService;

  private get urlForRealmLookup() {
    return this.args.card
      ? urlForRealmLookup(this.args.card)
      : this.args.cardId;
  }

  <template>
    <div class={{cn 'container' is-compact=@isCompact}}>
      <FittedCardContainer
        @size={{if @isCompact 'single-strip' 'cardsgrid-tile'}}
      >
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
      </FittedCardContainer>
      {{#if this.urlForRealmLookup}}
        {{#let (this.realm.info this.urlForRealmLookup) as |realmInfo|}}
          <div class='realm-name' data-test-realm-name>in
            {{realmInfo.name}}</div>
        {{/let}}
      {{/if}}
    </div>
    <style scoped>
      .container {
        display: flex;
        flex-direction: column;
        align-items: self-end;
      }
      .realm-name {
        font: 400 var(--boxel-font);
        color: var(--boxel-400);
        padding-top: var(--boxel-sp-4xs);
        padding-right: var(--boxel-sp-xxs);
        height: 20px;
        font-size: var(--boxel-font-size-xs);
      }
    </style>
  </template>
}

interface Signature {
  Element: HTMLElement;
  Args: {
    label?: string;
    isCompact?: boolean;
  };
  Blocks: {
    default: [SearchResultComponent: typeof SearchResult];
  };
}

let ResultsSection: TemplateOnlyComponent<Signature> = <template>
  <div class={{cn 'section' is-compact=@isCompact}}>
    {{#if @label}}
      <Label class='section__label' data-test-search-label>{{@label}}</Label>
    {{/if}}
    <div class='section__body'>
      <div class='section__cards'>
        {{yield SearchResult}}
      </div>
    </div>
  </div>
  <style scoped>
    .section {
      display: flex;
      width: 100%;
    }
    .section:not(.is-compact) {
      flex-direction: column;
      padding-top: var(--boxel-sp);
    }
    .section.is-compact {
      flex-direction: row;
      height: 100%;
    }
    .section__label {
      font: 700 var(--boxel-font);
      padding-inline: var(--boxel-sp);
    }
    .section__cards {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      padding: var(--boxel-sp);
      gap: var(--boxel-sp);
    }
    .is-compact .section__cards {
      flex-wrap: nowrap;
      padding: var(--boxel-sp-xs);
      gap: var(--boxel-sp-xs);
    }
  </style>
</template>;

export default ResultsSection;
