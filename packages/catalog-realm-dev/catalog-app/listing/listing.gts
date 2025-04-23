import {
  contains,
  field,
  CardDef,
  containsMany,
  linksToMany,
  StringField,
  linksTo,
  Component,
  meta,
} from 'https://cardstack.com/base/card-api';
import {
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
  type CopyCardsWithCodeRef,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { Spec, type SpecType } from 'https://cardstack.com/base/spec';
import { SkillCard } from 'https://cardstack.com/base/skill-card';

import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency';
import { v4 as uuidv4 } from 'uuid';
import { deburr } from 'lodash';

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

interface CopyMeta {
  sourceCodeRef: ResolvedCodeRef;
  targetCodeRef: ResolvedCodeRef;
}

function getNewPackageName(listingName?: string) {
  if (!listingName) {
    return '';
  }
  // sanitize the listing name, eg: Blog App -> blog-app
  const sanitizedListingName = deburr(listingName.toLocaleLowerCase())
    .replace(/ /g, '-')
    .replace(/'/g, '');
  const newPackageName = `${sanitizedListingName}-${uuidv4()}`;
  return newPackageName;
}

class EmbeddedTemplate extends Component<typeof Listing> {
  @tracked selectedAccordionItem: string | undefined;
  @tracked createdInstances = false;
  @tracked installedListing = false;
  @tracked writableRealms: string[] = [];

  constructor(owner: any, args: any) {
    super(owner, args);
    this._setup.perform();
  }

  get useRealmOptions() {
    return this.writableRealms.map((realmUrl) => {
      return new MenuItem(realmUrl, 'action', {
        action: () => {
          this.use(realmUrl);
        },
      });
    });
  }

  get installRealmOptions() {
    return this.writableRealms.map((realmUrl) => {
      return new MenuItem(realmUrl, 'action', {
        action: () => {
          this.install(realmUrl);
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
    const specsToCopy: Spec[] = this.args.model?.specs ?? [];
    const specsWithoutFields = specsToCopy.filter(
      (spec: Spec) => spec.specType !== 'field',
    );

    const newModulePath = getNewPackageName(this.args.model?.name).concat('/');
    const targetUrl = new URL(newModulePath, realmUrl).href;

    for (const spec of specsWithoutFields) {
      await this.args.context?.actions?.create?.(spec, targetUrl);
    }

    if (this.args.model instanceof SkillListing) {
      await Promise.all(
        this.args.model.skills.map((skill) => {
          this.args.context?.actions?.copy?.(skill, realmUrl);
        }),
      );
    }
    if (this.args.model.examples) {
      const sourceCards = this.args.model.examples.map((example) => ({
        sourceCard: example,
      }));
      await this.args.context?.actions?.copyCards?.(sourceCards, targetUrl);
    }
    this.createdInstances = true;
  });

  _install = task(async (realmUrl: string) => {
    const copyMeta: CopyMeta[] = [];

    const newModulePath = getNewPackageName(this.args.model?.name).concat('/');
    const targetUrl = new URL(newModulePath, realmUrl).href;

    // Copy the gts file based on the attached spec's moduleHref
    for (const spec of this.args.model?.specs ?? []) {
      const absoluteModulePath = spec.moduleHref;
      const relativeModulePath = spec.ref.module;
      const normalizedPath = relativeModulePath.split('/').slice(2).join('/');
      const newPath = newModulePath.concat(normalizedPath);
      const fileTargetUrl = new URL(newPath, realmUrl).href;
      const targetFilePath = fileTargetUrl.concat('.gts');

      await this.args.context?.actions?.copySource?.(
        absoluteModulePath,
        targetFilePath,
      );

      copyMeta.push({
        sourceCodeRef: {
          module: absoluteModulePath,
          name: spec.ref.name,
        },
        targetCodeRef: {
          module: fileTargetUrl,
          name: spec.ref.name,
        },
      });
    }

    if (this.args.model.examples) {
      // Create serialized objects for each example with modified adoptsFrom
      const results = this.args.model.examples.map((instance: CardDef) => {
        let adoptsFrom = instance[meta]?.adoptsFrom;
        if (!adoptsFrom) {
          return null;
        }
        let exampleCodeRef = instance.id
          ? codeRefWithAbsoluteURL(adoptsFrom, new URL(instance.id))
          : adoptsFrom;
        if (!isResolvedCodeRef(exampleCodeRef)) {
          throw new Error('exampleCodeRef is NOT resolved');
        }
        let maybeCopyMeta = copyMeta.find(
          (meta) =>
            meta.sourceCodeRef.module ===
              (exampleCodeRef as ResolvedCodeRef).module &&
            meta.sourceCodeRef.name ===
              (exampleCodeRef as ResolvedCodeRef).name,
        );
        if (maybeCopyMeta) {
          return {
            sourceCard: instance,
            codeRef: maybeCopyMeta.targetCodeRef,
          };
        }
        return null;
      });
      const copyCardsWithCodeRef = results.filter(
        (result) => result !== null,
      ) as CopyCardsWithCodeRef[];
      await this.args.context?.actions?.copyCards?.(
        copyCardsWithCodeRef,
        targetUrl,
      );
    }

    if (this.args.model instanceof SkillListing) {
      await Promise.all(
        this.args.model.skills.map((skill) => {
          this.args.context?.actions?.copy?.(skill, realmUrl);
        }),
      );
    }

    this.installedListing = true;
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

  get useOrInstallDisabled() {
    return !this.hasOneOrMoreSpec && !this.hasSkills;
  }

  get useButtonDisabled() {
    return (
      this.createdInstances ||
      !this.args.context?.actions?.create ||
      this.useOrInstallDisabled
    );
  }

  get installButtonDisabled() {
    return (
      this.installedListing ||
      !this.args.context?.actions?.copySource ||
      this.useOrInstallDisabled
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

  @action install(realmUrl: string) {
    this._install.perform(realmUrl);
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
                <BoxelButton
                  class='action-button'
                  data-test-catalog-listing-preview-button
                  {{on 'click' this.preview}}
                >
                  Preview
                </BoxelButton>
              {{/if}}
              <BoxelDropdown>
                <:trigger as |bindings|>
                  <BoxelButton
                    class='action-button'
                    data-test-catalog-listing-use-button
                    @disabled={{this.useButtonDisabled}}
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
                    @items={{this.useRealmOptions}}
                  />
                </:content>
              </BoxelDropdown>
              <BoxelDropdown>
                <:trigger as |bindings|>
                  <BoxelButton
                    class='action-button'
                    data-test-catalog-listing-install-button
                    @disabled={{this.installButtonDisabled}}
                    {{bindings}}
                  >
                    {{#if this._install.isRunning}}
                      Installing...
                    {{else if this.installedListing}}
                      Installed
                    {{else}}
                      Install
                    {{/if}}
                  </BoxelButton>
                </:trigger>
                <:content as |dd|>
                  <BoxelMenu
                    @closeMenu={{dd.close}}
                    @items={{this.installRealmOptions}}
                  />
                </:content>
              </BoxelDropdown>
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
            {{#if @model.summary}}
              <@fields.summary />
            {{else}}
              <p class='no-data-text'>No Summary Provided</p>
            {{/if}}

          </div>

          <div class='license-section'>
            <h2>License</h2>
            {{#if @model.license.name}}
              {{@model.license.name}}
            {{else}}
              <p class='no-data-text'>No license Provided</p>
            {{/if}}
          </div>
        </section>

        <hr class='divider' />

        <section class='app-listing-images'>
          <h2>Images</h2>
          {{#if this.hasImages}}
            <ul class='images-list'>
              {{#each @model.images as |image|}}
                <li class='images-item'>
                  <img src={{image}} alt={{@model.name}} />
                </li>
              {{/each}}
            </ul>
          {{else}}
            <p class='no-data-text'>No Images Provided</p>
          {{/if}}
        </section>

        <section class='app-listing-examples'>
          <h2>Examples</h2>
          {{#if this.hasExamples}}
            <ul class='examples-list'>
              {{#each @fields.examples as |Example|}}
                <li>
                  <Example />
                </li>
              {{/each}}
            </ul>
          {{else}}
            <p class='no-data-text'>No Examples Provided</p>
          {{/if}}
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
            <p class='no-data-text'>No Categories Provided</p>
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
            <p class='no-data-text'>No Specs Provided</p>
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
      .no-data-text {
        color: var(--boxel-400);
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
        margin: var(--boxel-sp-xxxl) 0;
        border: 0.5px solid var(--boxel-200);
      }

      .images-list {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--boxel-sp);
        list-style: none;
        margin-block: 0;
        padding-inline-start: 0;
      }
      .images-item {
        background-color: var(--boxel-200);
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        padding: var(--boxel-sp-sm);
        display: flex;
        align-items: center;
        min-height: 160px;
      }
      .images-item img {
        width: 100%;
        height: auto;
        object-fit: contain;
        border-radius: var(--boxel-border-radius-sm);
        box-shadow:
          0 15px 20px rgba(0, 0, 0, 0.12),
          0 5px 10px rgba(0, 0, 0, 0.1);
        transition:
          transform 0.3s ease,
          box-shadow 0.3s ease;
      }

      .app-listing-examples {
        margin-top: var(--boxel-sp-xxl);
      }
      .examples-list {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--boxel-sp);
        list-style: none;
        margin-block: 0;
        padding-inline-start: 0;
      }

      .categories-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-sm);
        list-style: none;
        margin-block: 0;
        padding-inline-start: 0;
      }

      .app-listing-spec-breakdown :deep(.accordion) {
        --accordion-border-radius: var(--boxel-border-radius);
      }

      @container app-listing-embedded (inline-size <= 600px) {
        .app-listing-info {
          margin-left: 0;
        }
        .license-statistic,
        .stats-container,
        .pricing-plans,
        .examples-list {
          grid-template-columns: 1fr;
        }
        .images-list {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @container app-listing-embedded (inline-size <= 360px) {
        .images-list {
          grid-template-columns: repeat(1, 1fr);
        }
      }
    </style>
  </template>
}

export class Listing extends CardDef {
  static displayName = 'Listing';
  static headerColor = '#6638ff';
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
