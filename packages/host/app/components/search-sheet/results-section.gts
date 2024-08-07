import { TemplateOnlyComponent } from '@ember/component/template-only';

import { WithBoundArgs } from '@glint/template';

import { CardContainer, Label } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

import { CardDef } from 'https://cardstack.com/base/card-api';

import PrerenderedCardComponent from '../prerendered';

import Preview from '../preview';

import { removeFileExtension } from './utils';

interface SearchResultSignature {
  Element: HTMLElement;
  Args: {
    component?: WithBoundArgs<typeof PrerenderedCardComponent, 'card'>;
    card?: CardDef;
    cardId: string;
    isCompact: boolean;
  };
}
let SearchResult: TemplateOnlyComponent<SearchResultSignature> = <template>
  {{#if @component}}
    <CardContainer
      @displayBoundaries={{true}}
      data-test-search-result={{removeFileExtension @cardId}}
      class={{cn 'search-result' is-compact=@isCompact}}
      ...attributes
    >
      <@component />
    </CardContainer>

  {{else if @card}}
    <Preview
      @card={{@card}}
      @format='embedded'
      data-test-search-sheet-recent-card={{removeFileExtension @cardId}}
      class={{cn 'search-result' is-compact=@isCompact}}
      ...attributes
    />
  {{/if}}
  <style>
    .search-result,
    .search-result.field-component-card.embedded-format {
      width: 311px;
      height: 76px;
      overflow: hidden;
      cursor: pointer;
      container-name: embedded-card;
      container-type: size;
    }
    .search-result.is-compact,
    .search-result.field-component-card.embedded-format.is-compact {
      width: 199px;
      height: 50px;
    }
  </style>
</template>;

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
  <style>
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
