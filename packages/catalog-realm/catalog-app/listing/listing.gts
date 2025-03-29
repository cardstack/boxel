import {
  contains,
  field,
  CardDef,
  linksToMany,
  StringField,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { Spec, type SpecType } from 'https://cardstack.com/base/spec';

import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency';

import {
  Accordion,
  Pill,
  BasicFitted,
  BoxelDropdown,
  BoxelButton,
  Menu as BoxelMenu,
  CardContainer,
} from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { eq } from '@cardstack/boxel-ui/helpers';

import AppListingHeader from '../components/app-listing-header';

import { Publisher } from './publisher';
import { Category, Tag } from './category';
import { License } from './license';

class EmbeddedTemplate extends Component<typeof Listing> {
  @tracked selectedAccordionItem: string | undefined;
  @tracked createdInstances = false;
  @tracked writableRealms: string[] = [];

  constructor(owner: any, args: any) {
    super(owner, args);
    this._setup.perform();
  }

  get realmOptions() {
    return this.writableRealms.map((realmUrl) => {
      return new MenuItem(realmUrl, 'action', {
        action: () => {
          this.create(realmUrl);
        },
      });
    });
  }

  _setup = task(async () => {
    let allRealmsInfo =
      (await this.args.context?.actions?.allRealmsInfo?.()) ?? {};
    let writableRealms: string[] = [];
    if (allRealmsInfo) {
      Object.entries(allRealmsInfo).forEach(([realmUrl, realmInfo]) => {
        if (realmInfo.canWrite) {
          writableRealms.push(realmUrl);
        }
      });
    }
    this.writableRealms = writableRealms;
  });

  _create = task(async (realmUrl: string) => {
    await Promise.all(
      this.args.model?.specs
        ?.filter((spec: Spec) => spec.specType !== 'field') // Copying a field is not supported yet
        .map((spec: Spec) =>
          this.args.context?.actions?.create?.(spec, realmUrl),
        ) ?? [],
    );
    this.createdInstances = true;
  });

  get hasOneOrMoreSpec() {
    return this.args.model.specs && this.args.model?.specs?.length > 0;
  }

  get createButtonDisabled() {
    return (
      this.createdInstances ||
      !this.args.context?.actions?.create ||
      !this.hasOneOrMoreSpec
    );
  }

  @action create(realmUrl: string) {
    this._create.perform(realmUrl);
  }

  mockCards = [
    { name: 'Card 1' },
    { name: 'Card 2' },
    { name: 'Card 3' },
    { name: 'Card 4' },
    { name: 'Card 5' },
    { name: 'Card 6' },
  ];

  get appName(): string {
    return this.args.model.name || '';
  }

  get publisherName(): string {
    return this.args.model.publisher?.name || '';
  }

  get specBreakdown() {
    if (!this.args.model.specs) {
      return {} as Record<SpecType, Spec[]>;
    }
    return specBreakdown(this.args.model.specs);
  }

  get hasNonEmptySpecBreakdown() {
    if (!this.specBreakdown) {
      return false;
    }
    return Object.values(this.specBreakdown).some((specs) => specs.length > 0);
  }

  selectAccordionItem = (item: string) => {
    if (this.selectedAccordionItem === item) {
      this.selectedAccordionItem = undefined;
      return;
    }
    this.selectedAccordionItem = item;
  };

  getComponent = (card: CardDef) => card.constructor.getComponent(card);

  get hasCategories() {
    return Boolean(this.args.model.categories?.length);
  }

  <template>
    <div class='app-listing-embedded'>
      {{#if this._setup.isRunning}}
        Loading...
      {{else}}

        <AppListingHeader
          @name={{this.appName}}
          @publisher={{this.publisherName}}
          @buttonText='Add to Workspace'
        >
          <:action>
            <BoxelDropdown>
              <:trigger as |bindings|>
                <BoxelButton
                  class='action-button'
                  @disabled={{this.createButtonDisabled}}
                  {{bindings}}
                >
                  {{#if this._create.isRunning}}
                    Creating...
                  {{else if this.createdInstances}}
                    Created Instances
                  {{else}}
                    Add to Workspace
                  {{/if}}
                </BoxelButton>
              </:trigger>
              <:content as |dd|>
                <BoxelMenu
                  @closeMenu={{dd.close}}
                  @items={{this.realmOptions}}
                />
              </:content>
            </BoxelDropdown>
          </:action>
        </AppListingHeader>

        <section class='app-listing-info'>
          <div class='app-listing-summary info-box'>
            <h2>Summary</h2>
            <@fields.summary />
          </div>

          <div class='license-statistic'>
            {{! Todo: Add license section while getting the real data }}
            <div class='license-section'>
              <h2>License</h2>
              {{@model.license.name}}
            </div>

            {{! Todo: Add statistics section while getting the real data }}
            <div class='statistics-section'>
              <h2>Statistics</h2>
              <div class='stats-container'>
                <div class='stat-item info-box'>
                  <span class='stat-label'>Downloads</span>
                  <span class='stat-value'>16,842</span>
                </div>

                <div class='stat-item info-box'>
                  <span class='stat-label'>Subscriptions</span>
                  <span class='stat-value'>5,439</span>
                </div>
              </div>
            </div>
          </div>

          <div class='pricing-plans'>
            {{! Todo: Add price plan section while getting the real data }}
            <div class='price-plan-item info-box'>
              <span class='price-plan-label'>$250</span>
              <span class='price-plan-info'>= $250USD</span>
              <Pill @pillBackgroundColor='#ffffff50' class='price-plan-pill'>
                <:default>One-time purchase</:default>
              </Pill>
            </div>

            <div class='price-plan-item info-box'>
              <span class='price-plan-label'>$ 0.50</span>
              <span class='price-plan-info'>per month</span>
              <Pill @pillBackgroundColor='#ffffff50' class='price-plan-pill'>
                <:default>Cancel anytime</:default>
              </Pill>
            </div>

            <div class='price-plan-item premium-plan-item info-box'>
              <span class='price-plan-label'>$ 250</span>
              <span class='price-plan-info'>with Boxel Creator</span>
              <Pill @pillBackgroundColor='#ffffff50' class='price-plan-pill'>
                <:default>Premium plan</:default>
              </Pill>
            </div>
          </div>
        </section>

        <hr class='divider' />

        {{!-- <section class='app-listing-images-videos'>
          <h2>Images & Videos</h2>
          {{! Todo: Add images and videos section while getting the real data }}
          <ul class='images-videos-list'>
            {{#each this.mockCards as |card|}}
              <li class='images-videos-item'>
                {{card.name}}
              </li>
            {{/each}}
          </ul>
        </section>

        <section class='app-listing-examples'>
          <h2>Examples</h2>
          {{! Todo: Add examples section while getting the real data }}
          <ul class='examples-list'>
            {{#each this.mockCards as |card|}}
              <li class='examples-item'>
                {{card.name}}
              </li>
            {{/each}}
          </ul>
        </section>

        <hr class='divider' /> --}}

        <section class='app-listing-categories'>
          <h2>Categories</h2>
          {{#if this.hasCategories}}

            <ul class='categories-list'>
              {{#each @model.categories as |category|}}
                <li class='categories-item'>
                  <Pill>{{category.name}}</Pill>
                </li>
              {{/each}}
            </ul>
          {{else}}
            No categories
          {{/if}}
        </section>

        <hr class='divider' />
        <section class='app-listing-spec-breakdown'>
          <h2>Includes These Boxels</h2>
          {{#if this.hasNonEmptySpecBreakdown}}
            <Accordion
              data-test-selected-accordion-item={{this.selectedAccordionItem}}
              as |A|
            >
              {{#each-in this.specBreakdown as |specType specs|}}
                <A.Item
                  @onClick={{fn this.selectAccordionItem specType}}
                  @isOpen={{eq this.selectedAccordionItem specType}}
                  data-test-accordion-item={{specType}}
                >
                  <:title>
                    {{specType}}
                    ({{specs.length}})
                  </:title>
                  <:content>
                    {{#each specs as |card|}}
                      {{#let (this.getComponent card) as |CardComponent|}}
                        <CardContainer
                          {{@context.cardComponentModifier
                            cardId=card.id
                            format='data'
                            fieldType=undefined
                            fieldName=undefined
                          }}
                        >

                          <CardComponent @format='fitted' />
                        </CardContainer>
                      {{/let}}
                    {{/each}}
                  </:content>
                </A.Item>
              {{/each-in}}
            </Accordion>
          {{else}}
            No specs
          {{/if}}
        </section>
      {{/if}}
    </div>

    <style scoped>
      h2 {
        font-weight: 600;
        margin: 0;
        margin-bottom: var(--boxel-sp-sm);
      }
      .info-box {
        width: 100%;
        height: auto;
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light);
      }

      /* container */
      .app-listing-embedded {
        container-name: app-listing-embedded;
        container-type: inline-size;
        padding: var(--boxel-sp);
      }
      .app-listing-info {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xl);
        margin-left: 60px;
        margin-top: var(--boxel-sp-lg);
      }
      .app-listing-summary {
        padding: var(--boxel-sp);
        background-color: var(--boxel-100);
      }
      .license-statistic {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp);
      }
      .stats-container {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp);
      }
      .stat-item {
        padding: var(--boxel-sp-xs);
        border: 1px solid var(--boxel-border-color);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .stat-label {
        font: 500 var(--boxel-font-xs);
        color: var(--boxel-400);
      }
      .stat-value {
        font: 600 var(--boxel-font);
      }
      .pricing-plans {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: var(--boxel-sp);
        margin-top: var(--boxel-sp-lg);
      }
      .price-plan-item {
        padding: var(--boxel-sp-lg) var(--boxel-sp);
        background-color: var(--boxel-dark);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-xs);
      }
      .premium-plan-item {
        background-color: var(--boxel-purple);
      }
      .price-plan-label {
        font: 600 var(--boxel-font-lg);
        color: var(--boxel-light);
        text-align: center;
      }
      .price-plan-info {
        font: 400 var(--boxel-font);
        color: var(--boxel-light);
        text-align: center;
      }
      .price-plan-pill {
        --pill-font-color: var(--boxel-light);
        margin-top: var(--boxel-sp-sm);
        text-align: center;
      }

      .divider {
        width: 100%;
        margin: var(--boxel-sp-xxl) 0;
        border: 0.5px solid var(--boxel-border-color);
      }

      .images-videos-list {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--boxel-sp);
        list-style: none;
        margin-block: 0;
        padding-inline-start: 0;
      }
      .images-videos-item {
        height: auto;
        max-width: 100%;
        min-height: 100px;
        background-color: var(--boxel-300);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--boxel-border-radius);
      }

      .app-listing-examples {
        margin-top: var(--boxel-sp-xl);
      }
      .examples-list {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--boxel-sp);
        list-style: none;
        margin-block: 0;
        padding-inline-start: 0;
      }
      .examples-item {
        height: auto;
        max-width: 100%;
        min-height: 100px;
        background-color: var(--boxel-300);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--boxel-border-radius);
      }

      .categories-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-sm);
        list-style: none;
        margin-block: 0;
        padding-inline-start: 0;
      }

      @container app-listing-embedded (inline-size <= 500px) {
        .app-listing-info {
          margin-left: 0;
        }
        .license-statistic,
        .stats-container,
        .pricing-plans,
        .images-videos-list,
        .examples-list {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

class FittedTemplate extends Component<typeof Listing> {
  <template>
    <BasicFitted
      @thumbnailURL={{@model.thumbnailURL}}
      @iconComponent={{@model.constructor.icon}}
      @primary={{@model.name}}
      @secondary={{@model.publisher.name}}
      class='app-listing-fitted'
    />
    <style scoped>
      /* Vertical card (aspect-ratio <= 1.0) */
      @container fitted-card (aspect-ratio <= 1.0) {
        .app-listing-fitted {
          padding: 0;
        }
        .app-listing-fitted :deep(.thumbnail-section) {
          background-color: var(--boxel-300);
          max-height: 60cqh;
          height: 100%;
        }
        .app-listing-fitted :deep(.info-section) {
          text-align: left;
          padding: var(--boxel-sp-xs) var(--boxel-sp);
        }
        .app-listing-fitted :deep(.card-title) {
          font: 600 var(--boxel-font-lg);
        }
        .app-listing-fitted :deep(.card-display-name) {
          font: 400 var(--boxel-font-sm);
        }

        /* Height <= 275px */
        @container fitted-card (height <= 275px) {
          .app-listing-fitted :deep(.info-section) {
            text-align: left;
            padding: var(--boxel-sp-xs);
          }
          .app-listing-fitted :deep(.card-title) {
            font: 600 var(--boxel-font);
          }
        }
      }

      /* Horizontal card (aspect-ratio > 1.0) */
      @container fitted-card (1.0 < aspect-ratio) {
        .app-listing-fitted {
          padding: 0;
        }
        .app-listing-fitted :deep(.thumbnail-section) {
          background-color: var(--boxel-300);
          width: 40cqw;
          height: 100%;
        }
        .app-listing-fitted :deep(.info-section) {
          text-align: left;
          padding: var(--boxel-sp) var(--boxel-sp-xs);
        }
      }
    </style>
  </template>
}

export class Listing extends CardDef {
  static displayName = 'Listing';
  static headerColor = '#00ebac';
  @field name = contains(StringField);
  @field summary = contains(MarkdownField);
  @field specs = linksToMany(() => Spec);
  @field publisher = linksTo(() => Publisher);
  @field categories = linksToMany(() => Category);
  @field tags = linksToMany(() => Tag);
  @field license = linksTo(() => License);
  //   @field pricing = contains(PricingField)
  //   @field images = containsMany(StringField) // thumbnailURLs

  @field title = contains(StringField, {
    computeVia(this: Listing) {
      return this.name;
    },
  });

  static isolated = EmbeddedTemplate; //temporary
  static embedded = EmbeddedTemplate;
  static fitted = FittedTemplate;
}

export class AppListing extends Listing {
  static displayName = 'AppListing';
}

export class CardListing extends Listing {
  static displayName = 'CardListing';
}

export class FieldListing extends Listing {
  static displayName = 'FieldListing';
}

export class SkillListing extends Listing {
  static displayName = 'SkillListing';
}

function specBreakdown(specs: Spec[]): Record<SpecType, Spec[]> {
  return specs.reduce(
    (groupedSpecs, spec) => {
      if (!spec) {
        return groupedSpecs;
      }
      const specType = spec.specType as SpecType;
      if (!groupedSpecs[specType]) {
        groupedSpecs[specType] = [];
      }
      groupedSpecs[specType].push(spec);
      return groupedSpecs;
    },
    {} as Record<SpecType, Spec[]>,
  );
}
