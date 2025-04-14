import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { type SafeString, htmlSafe } from '@ember/template';

import {
  type CardContext,
  type CardDef,
  realmURL,
} from 'https://cardstack.com/base/card-api';

import {
  type Query,
  type Format,
  FITTED_FORMATS,
} from '@cardstack/runtime-common';

import {
  CardContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';

interface PrerenderedCard {
  url: string;
  component: any;
}

interface Signature {
  Args: {
    model?: Partial<CardDef>;
    cardTypeDisplayName?: string;
    fittedDisplayOption?: 'grid' | 'list';
    format?: string;
    context?: CardContext;
    query?: Query;
    realms?: URL[];
    hideOverlay?: boolean;
    hideContainer?: boolean;
  };
  Blocks: {
    meta: [card: PrerenderedCard];
  };
  Element: HTMLElement;
}

const setContainerSize = (specs?: { width: number; height: number }) => {
  if (!specs) {
    return;
  }
  return htmlSafe(`width: ${specs.width}px; height: ${specs.height}px`);
};

const setGridStyle = (specs?: { width: number; height: number }) => {
  if (!specs) {
    return;
  }
  return htmlSafe(`grid-template-columns: repeat(auto-fill, ${specs.width}px)`);
};

export default class PrerenderedSearch extends GlimmerComponent<Signature> {
  <template>
    {{#if this.canShowResults}}
      <ul
        class='card-list'
        style={{if this.isGrid (setGridStyle this.fittedFormatSpecs)}}
        ...attributes
      >
        <@context.prerenderedCardSearchComponent
          @query={{this.query}}
          @format={{this.format}}
          @realms={{this.realms}}
        >
          <:loading>
            <LoadingIndicator />
          </:loading>
          <:response as |cards|>
            {{#each cards key='url' as |card|}}
              <li
                class='card-list-item'
                style={{setContainerSize this.fittedFormatSpecs}}
              >
                {{#unless @hideOverlay}}
                  <CardContainer
                    {{@context.cardComponentModifier
                      cardId=card.url
                      format='data'
                      fieldType=undefined
                      fieldName=undefined
                    }}
                    class='{{this.format}}-card'
                    @displayBoundaries={{this.displayContainer}}
                  >
                    <card.component />
                  </CardContainer>
                {{else}}
                  <CardContainer
                    class='{{this.format}}-card'
                    @displayBoundaries={{this.displayContainer}}
                  >
                    <card.component />
                  </CardContainer>
                {{/unless}}

                {{#if (has-block 'meta')}}
                  {{yield card to='meta'}}
                {{/if}}
              </li>
            {{else}}
              <p>No results were found</p>
            {{/each}}
          </:response>
        </@context.prerenderedCardSearchComponent>
      </ul>
    {{else if this.error}}
      <div class='error'>Error: {{this.error}}</div>
    {{/if}}
    <style scoped>
      .card-list {
        display: grid;
        gap: var(--boxel-sp);
        list-style-type: none;
        margin-block: 0;
        padding: var(--boxel-sp);
      }
      .card-list-item {
        max-width: 100%;
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp) var(--boxel-sp-lg);
      }
      .fitted-card {
        container-name: fitted-card;
        container-type: size;
      }
      .atom-card {
        width: fit-content;
        max-width: 100%;
      }
      .embedded-card {
        width: 100%;
        height: auto;
        max-width: var(--embedded-card-max-width);
        min-height: var(--embedded-card-min-height);
      }
      .error {
        padding: var(--boxel-sp);
        color: var(--boxel-danger);
      }
    </style>
  </template>

  private fittedFormatSizes = FITTED_FORMATS.map((f) => f.specs).flat();
  private validFormats = [
    'embedded',
    'atom',
    'fitted',
    ...this.fittedFormatSizes.map((f) => `fitted/${f.id}`),
  ];

  @tracked private error?: SafeString;

  private get canShowResults() {
    return this.formatInfo && this.query;
  }

  private get displayContainer() {
    return !Boolean(this.args.hideContainer);
  }

  private get query(): Query | undefined {
    if (this.args.query) {
      return this.args.query;
    } else if (this.args.cardTypeDisplayName) {
      return {
        filter: {
          eq: {
            _cardType: this.args.cardTypeDisplayName,
          },
        },
      };
    } else {
      return undefined;
    }
  }

  private get realm(): URL | undefined {
    if (!this.args.model) {
      return undefined;
    }
    return this.args.model[realmURL];
  }

  private get realms(): URL[] | undefined {
    if (this.args.realms) {
      return this.args.realms;
    }
    return this.realm ? [this.realm] : undefined;
  }

  private get formatInfo() {
    if (!this.args.format || this.args.format === 'fitted') {
      return { format: 'fitted', specId: 'double-strip' };
    }

    if (!this.validFormats.includes(this.args.format)) {
      this.error = this.formatError(this.args.format);
      return undefined;
    }

    if (this.args.format.includes('/')) {
      let [format, specId] = this.args.format.split('/');
      return { format, specId };
    }

    return { format: this.args.format, specId: undefined };
  }

  private get format(): Format | undefined {
    return this.formatInfo?.format as Format | undefined;
  }

  private get fittedFormatSpecs() {
    let specId = this.formatInfo?.specId;
    if (this.format !== 'fitted' || !specId) {
      return undefined;
    }
    let specs = this.fittedFormatSizes.find((f) => f.id === specId);
    return specs;
  }

  private get isGrid() {
    return this.format === 'fitted' && this.args.fittedDisplayOption === 'grid';
  }

  private formatError = (format: string) =>
    htmlSafe(`"${format}" an acceptable value for the <code>@format</code> argument. Please select from these options:
      <ul>
        ${this.validFormats.map((f) => htmlSafe(`<li>${f}</li>`)).join('')}
      </ul>`);
}
