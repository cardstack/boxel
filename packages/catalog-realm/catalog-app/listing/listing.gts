import {
  contains,
  field,
  CardDef,
  containsMany,
  linksToMany,
  StringField,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { Spec, type SpecType } from 'https://cardstack.com/base/spec';
import { SkillCard } from 'https://cardstack.com/base/skill-card';

import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency';
import { camelCase } from 'lodash';

import {
  Accordion,
  Pill,
  BoxelDropdown,
  BoxelButton,
  Menu as BoxelMenu,
  CardContainer,
} from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { eq } from '@cardstack/boxel-ui/helpers';

import AppListingHeader from '../components/app-listing-header';
import { ListingFittedTemplate } from '../components/listing-fitted';

import { Publisher } from './publisher';
import { Category } from './category';
import { License } from './license';
import { Tag } from './tag';

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
          this.use(realmUrl);
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

  _use = task(async (realmUrl: string) => {
    await Promise.all(
      this.args.model?.specs
        ?.filter((spec: Spec) => spec.specType !== 'field') // Copying a field is not supported yet
        .map((spec: Spec) =>
          this.args.context?.actions?.create?.(spec, realmUrl),
        ) ?? [],
    );
    if (this.args.model instanceof SkillListing) {
      await Promise.all(
        this.args.model.skills.map((skill) => {
          this.args.context?.actions?.copy?.(skill, realmUrl);
        }),
      );
    }
    if (this.args.model.examples) {
      await this.args.context?.actions?.copyCards?.(
        this.args.model.examples,
        realmUrl,
        this.args.model.name
          ? camelCase(`${this.args.model.name}Examples`)
          : 'ListingExamples',
      );
    }
    this.createdInstances = true;
  });

  get hasOneOrMoreSpec() {
    return this.args.model.specs && this.args.model?.specs?.length > 0;
  }

  get hasSkills() {
    return (
      this.args.model instanceof SkillListing &&
      this.args.model?.skills?.length > 0
    );
  }

  get createButtonDisabled() {
    return (
      this.createdInstances ||
      !this.args.context?.actions?.create ||
      (!this.hasOneOrMoreSpec && !this.hasSkills)
    );
  }

  @action preview() {
    if (!this.args.model.examples || this.args.model.examples.length === 0) {
      throw new Error('No examples to preview');
    }
    this.args.context?.actions?.viewCard?.(this.args.model.examples[0]);
  }

  @action use(realmUrl: string) {
    this._use.perform(realmUrl);
  }

  @action install() {
    console.log('Install...');
  }

  get appName(): string {
    return this.args.model.name || '';
  }

  get publisherName() {
    const hasPublisher = Boolean(this.args.model.publisher?.name);
    return hasPublisher ? this.args.model.publisher?.name : '';
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

  get hasImages() {
    return Boolean(this.args.model.images?.length);
  }

  get hasExamples() {
    return Boolean(this.args.model.examples?.length);
  }

  <template>
    <div class='app-listing-embedded'>
      {{#if this._setup.isRunning}}
        Loading...
      {{else}}

        <AppListingHeader
          @thumbnailUrl={{@model.thumbnailURL}}
          @name={{this.appName}}
          @description={{@model.description}}
          @publisher={{this.publisherName}}
        >
          <:action>
            <div class='action-buttons'>
              {{#if this.hasExamples}}
                <BoxelButton class='action-button' {{on 'click' this.preview}}>
                  Preview
                </BoxelButton>
              {{/if}}
              <BoxelDropdown>
                <:trigger as |bindings|>
                  <BoxelButton
                    class='action-button'
                    @disabled={{this.createButtonDisabled}}
                    {{bindings}}
                  >
                    {{#if this._use.isRunning}}
                      Creating...
                    {{else if this.createdInstances}}
                      Created Instances
                    {{else}}
                      Use
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
              <BoxelButton class='action-button' {{on 'click' this.install}}>
                Install
              </BoxelButton>
            </div>
          </:action>
        </AppListingHeader>

        <section class='app-listing-info'>
          <div class='app-listing-price-plan'>
            <Pill class='free-plan-pill'>
              <:default>Free Plan</:default>
            </Pill>
          </div>

          <div class='app-listing-summary info-box'>
            <h2>Summary</h2>
            <@fields.summary />
          </div>

          <div class='license-section'>
            <h2>License</h2>
            {{@model.license.name}}
          </div>
        </section>

        <hr class='divider' />

        <section class='app-listing-images-videos'>
          <h2>Images & Videos</h2>
          {{#if this.hasImages}}
            <ul class='images-videos-list'>
              {{#each @model.images as |image|}}
                <li class='images-videos-item'>
                  <img src={{image}} alt={{@model.name}} />
                </li>
              {{/each}}
            </ul>
          {{else}}
            No Images & Videos
          {{/if}}
        </section>

        <section class='app-listing-examples'>
          <h2>Examples</h2>
          <ul class='examples-list'>
            {{#each @fields.examples as |Example|}}
              <li class='examples-item'>
                <Example />
              </li>
            {{/each}}
          </ul>
        </section>

        <hr class='divider' />

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
      .app-listing-price-plan {
        --pill-font-color: var(--boxel-purple);
        --pill-border: 1px solid var(--boxel-purple);
      }
      .action-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
      }
      .action-button {
        flex: 1;
      }
      .app-listing-embedded
        :deep(.ember-basic-dropdown-content-wormhole-origin) {
        position: absolute;
      }
      .app-listing-summary {
        padding: var(--boxel-sp);
        background-color: var(--boxel-100);
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
        background-color: var(--boxel-light);
        display: flex;
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }

      .images-videos-item img {
        width: 100%;
        height: 100%;
        object-fit: contain;
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
        .examples-list {
          grid-template-columns: 1fr;
        }
        .images-videos-list {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @container app-listing-embedded (inline-size <= 360px) {
        .images-videos-list {
          grid-template-columns: repeat(1, 1fr);
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
  @field images = containsMany(StringField);
  @field examples = linksToMany(CardDef);

  @field title = contains(StringField, {
    computeVia(this: Listing) {
      return this.name;
    },
  });

  static isolated = EmbeddedTemplate; //temporary
  static embedded = EmbeddedTemplate;
  static fitted = ListingFittedTemplate;
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
  @field skills = linksToMany(() => SkillCard);
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
