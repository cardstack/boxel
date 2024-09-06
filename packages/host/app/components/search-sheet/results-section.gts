import { TemplateOnlyComponent } from '@ember/component/template-only';

import { service } from '@ember/service';
import Component from '@glimmer/component';

import { ComponentLike } from '@glint/template';

import { CardContainer, Label } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

import RealmService from '@cardstack/host/services/realm';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import Preview from '../preview';

import { removeFileExtension } from './utils';

interface SearchResultSignature {
  Element: HTMLElement;
  Args: {
    component?: ComponentLike<{}>;
    card?: CardDef;
    cardId: string;
    isCompact: boolean;
  };
}

// Render CardDef default fitted template for visual consistency of cards insearch results
let resultsCardRef = {
  name: 'CardDef',
  module: 'https://cardstack.com/base/card-api',
};

class SearchResult extends Component<SearchResultSignature> {
  @service declare realm: RealmService;

  <template>
    <div class={{cn 'container' is-compact=@isCompact}}>
      {{#if @component}}
        <CardContainer
          @displayBoundaries={{true}}
          data-test-search-result={{removeFileExtension @cardId}}
          class='search-result'
          ...attributes
        >
          <@component />
        </CardContainer>

      {{else if @card}}
        <Preview
          @card={{@card}}
          @format='fitted'
          @codeRef={{resultsCardRef}}
          data-test-search-result={{removeFileExtension @cardId}}
          class='search-result'
          ...attributes
        />
      {{/if}}
      {{#let (this.realm.info @cardId) as |realmInfo|}}
        <div class='realm-name' data-test-realm-name>{{realmInfo.name}}</div>
      {{/let}}
    </div>
    <style scoped>
      .container {
        display: flex;
        flex-direction: column;
        align-items: self-end;
        width: 311px;
        height: 96px;
      }
      .search-result,
      .search-result.field-component-card.fitted-format {
        width: 311px;
        height: 76px;
        overflow: hidden;
        cursor: pointer;
        container-name: fitted-card;
        container-type: size;
      }
      .container.is-compact,
      .is-compact .search-result,
      .is-compact .search-result.field-component-card.fitted-format {
        width: 199px;
        height: 50px;
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
      font: 700 var(--boxel-font);
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
