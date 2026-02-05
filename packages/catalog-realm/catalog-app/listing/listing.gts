import {
  contains,
  field,
  CardDef,
  containsMany,
  linksToMany,
  StringField,
  linksTo,
  Component,
  instanceOf,
  realmURL,
  type GetMenuItemParams,
} from 'https://cardstack.com/base/card-api';
import { commandData } from 'https://cardstack.com/base/resources/command-data';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { Spec } from 'https://cardstack.com/base/spec';
import { Skill } from 'https://cardstack.com/base/skill';
import type {
  GetAllRealmMetasResult,
  RealmMetaField,
} from 'https://cardstack.com/base/command';

import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency';

import {
  Accordion,
  Pill,
  BoxelButton,
  CardContainer,
} from '@cardstack/boxel-ui/components';
import { eq, type MenuItemOptions } from '@cardstack/boxel-ui/helpers';
import Refresh from '@cardstack/boxel-icons/refresh';
import Wand from '@cardstack/boxel-icons/wand';
import Package from '@cardstack/boxel-icons/package';

import AppListingHeader from '../components/app-listing-header';
import ChooseRealmAction from '../components/choose-realm-action';
import { ListingFittedTemplate } from '../components/listing-fitted';
import ListOfPills from '../components/list-of-pills';
import { listingActions, isReady } from '../resources/listing-actions';

import GetAllRealmMetasCommand from '@cardstack/boxel-host/commands/get-all-realm-metas';
import ListingGenerateExampleCommand from '@cardstack/boxel-host/commands/listing-generate-example';
import ListingUpdateSpecsCommand from '@cardstack/boxel-host/commands/listing-update-specs';
import CreateListingPRCommand from '@cardstack/boxel-host/commands/create-listing-pr';

import { getMenuItems } from '@cardstack/runtime-common';

import { Publisher } from './publisher';
import { Category } from './category';
import { License } from './license';
import { Tag } from './tag';

class EmbeddedTemplate extends Component<typeof Listing> {
  @tracked selectedAccordionItem: string | undefined;

  actionsResource = listingActions(this, () => ({
    listing: this.args.model as Listing,
  }));

  allRealmsInfoResource = commandData<typeof GetAllRealmMetasResult>(
    this,
    GetAllRealmMetasCommand,
  );

  get writableRealms(): { name: string; url: string; iconURL?: string }[] {
    const commandResource = this.allRealmsInfoResource;
    if (commandResource?.isSuccess && commandResource.value) {
      const result = commandResource.value as GetAllRealmMetasResult;
      if (result.results) {
        return result.results
          .filter(
            (realmMeta: RealmMetaField) =>
              realmMeta.canWrite &&
              realmMeta.url !== this.args.model[realmURL]?.href,
          )
          .map((realmMeta: RealmMetaField) => ({
            name: realmMeta.info.name,
            url: realmMeta.url,
            iconURL: realmMeta.info.iconURL,
          }));
      }
    }
    return [];
  }

  get hasOneOrMoreSpec() {
    return this.args.model.specs && this.args.model?.specs?.length > 0;
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
      return {} as Record<string, Spec[]>;
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

  get hasTags() {
    return Boolean(this.args.model.tags?.length);
  }

  get hasImages() {
    return Boolean(this.args.model.images?.length);
  }

  get hasExamples() {
    return Boolean(this.args.model.examples?.length);
  }

  get hasSkills() {
    return this.args.model?.skills;
  }

  get listingActions() {
    if (isReady(this.actionsResource)) {
      return this.actionsResource.actions;
    }
    return;
  }

  get stubActions() {
    return this.listingActions?.type === 'stub'
      ? this.listingActions
      : undefined;
  }

  get regularActions() {
    return this.listingActions?.type === 'regular'
      ? this.listingActions
      : undefined;
  }

  get themeActions() {
    return this.listingActions?.type === 'theme'
      ? this.listingActions
      : undefined;
  }

  get skillActions() {
    return this.listingActions?.type === 'skill'
      ? this.listingActions
      : undefined;
  }

  addSkillsToCurrentRoom = task(async () => {
    this.skillActions?.addSkillsToRoom?.();
  });

  <template>
    <div class='app-listing-embedded'>
      <AppListingHeader
        @thumbnailUrl={{@model.cardThumbnailURL}}
        @name={{this.appName}}
        @description={{@model.cardDescription}}
        @publisher={{this.publisherName}}
      >
        <:action>
          {{#if this.listingActions}}
            <div class='action-buttons'>
              {{#if this.listingActions.preview}}
                <BoxelButton
                  class='action-button'
                  data-test-catalog-listing-embedded-preview-button
                  {{on 'click' this.listingActions.preview}}
                >
                  Preview
                </BoxelButton>
              {{/if}}
              {{#if this.skillActions}}
                {{#if this.skillActions.addSkillsToRoom}}
                  <BoxelButton
                    class='action-button'
                    data-test-catalog-listing-embedded-add-skills-to-room-button
                    {{on 'click' this.skillActions.addSkillsToRoom}}
                  >
                    Use Skills
                  </BoxelButton>
                {{/if}}
              {{/if}}
              {{#if this.stubActions}}
                <ChooseRealmAction
                  @name='Build'
                  @writableRealms={{this.writableRealms}}
                  @onAction={{this.stubActions.build}}
                />
              {{else if this.regularActions}}
                {{#if this.regularActions.remix}}
                  <ChooseRealmAction
                    @name='Remix'
                    @writableRealms={{this.writableRealms}}
                    @onAction={{this.regularActions.remix}}
                  />
                {{/if}}
              {{else if this.themeActions}}
                {{#if this.themeActions.remix}}
                  <ChooseRealmAction
                    @name='Remix'
                    @onAction={{this.themeActions.remix}}
                    @writableRealms={{this.writableRealms}}
                  />
                {{/if}}
              {{/if}}
            </div>
          {{/if}}
        </:action>
      </AppListingHeader>

      <section class='app-listing-info'>
        <div class='app-listing-price-plan'>
          <Pill class='free-plan-pill'>
            <:default>Free Plan</:default>
          </Pill>
        </div>

        <div
          class='app-listing-summary info-box'
          data-test-catalog-listing-embedded-summary-section
        >
          <h2>Summary</h2>
          {{#if @model.summary}}
            <@fields.summary />
          {{else}}
            <p class='no-data-text'>No Summary Provided</p>
          {{/if}}

        </div>

        <div
          class='license-section'
          data-test-catalog-listing-embedded-license-section
        >
          <div class='info-box'>
            <h2>License</h2>
            {{#if @model.license.name}}
              {{@model.license.name}}
            {{else}}
              <p class='no-data-text'>No License Provided</p>
            {{/if}}
          </div>
        </div>
      </section>

      <hr class='divider' />

      <section
        class='app-listing-images'
        data-test-catalog-listing-embedded-images-section
      >
        <h2>Images</h2>
        {{#if this.hasImages}}
          <ul class='images-list' data-test-catalog-listing-embedded-images>
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

      <section
        class='app-listing-examples'
        data-test-catalog-listing-embedded-examples-section
      >
        <h2>Examples</h2>
        {{#if this.hasExamples}}
          <ul class='examples-list' data-test-catalog-listing-embedded-examples>
            {{#each @fields.examples as |Example|}}
              <li class='example-item'>
                <Example class='example-card' />
              </li>
            {{/each}}
          </ul>
        {{else}}
          <p class='no-data-text'>No Examples Provided</p>
        {{/if}}
      </section>

      <hr class='divider' />

      <section class='two-col'>
        <section
          class='app-listing-categories'
          data-test-catalog-listing-embedded-categories-section
        >
          <h2>Categories</h2>
          {{#if this.hasCategories}}
            <ListOfPills @items={{@model.categories}} />
          {{else}}
            <p class='no-data-text'>No Categories Provided</p>
          {{/if}}
        </section>
        <section
          class='app-listing-tags'
          data-test-catalog-listing-embedded-tags-section
        >
          <h2>Tags</h2>
          {{#if this.hasTags}}
            <ListOfPills @items={{@model.tags}} />
          {{else}}
            <p class='no-data-text'>No Tags Provided</p>
          {{/if}}
        </section>
      </section>

      <hr class='divider' />
      <section
        class='app-listing-skills'
        data-test-catalog-listing-embedded-skills-section
      >
        <h2>Skills</h2>
        {{#if this.hasSkills}}
          <ul class='skills-list' data-test-catalog-listing-embedded-skills>
            {{#each @fields.skills as |Skill|}}
              <li>
                <Skill />
              </li>
            {{/each}}
          </ul>
        {{else}}
          <p class='no-data-text'>No Skills Provided</p>
        {{/if}}
      </section>

      <hr class='divider' />
      <section
        class='app-listing-spec-breakdown'
        data-test-catalog-listing-embedded-specs-section
      >

        <h2>Includes These Boxels</h2>
        {{#if this.hasNonEmptySpecBreakdown}}
          <Accordion
            @displayContainer={{true}}
            data-test-selected-accordion-item={{this.selectedAccordionItem}}
            as |A|
          >
            {{#each-in this.specBreakdown as |specType specs|}}
              <A.Item
                @id={{specType}}
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
                        class='listing-accordion-content'
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
    </div>

    <style scoped>
      h2 {
        font-weight: 600;
        margin: 0;
        margin-bottom: var(--boxel-sp);
      }

      .no-data-text {
        color: var(--boxel-400);
      }
      .info-box {
        width: 100%;
        height: auto;
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
        background-color: var(--boxel-100);
      }
      .info-box :deep(.markdown-content p) {
        margin-top: 0;
      }

      /* container */
      .app-listing-embedded {
        container-name: app-listing-embedded;
        container-type: inline-size;
        padding: var(--boxel-sp-lg);
      }
      .app-listing-info {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xl);
        margin-left: 72px;
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
        flex: 1 1 auto;
      }
      .app-listing-embedded
        :deep(.ember-basic-dropdown-content-wormhole-origin) {
        position: absolute;
      }

      .divider {
        width: 100%;
        margin: var(--boxel-sp-xxxl) 0;
        border: 0.5px solid var(--boxel-200);
      }

      /* horizontally scrollable images list */
      .images-list {
        display: flex;
        flex-wrap: nowrap;
        gap: var(--boxel-sp);
        list-style: none;
        margin: 0;
        padding: 0 0 var(--boxel-sp-xs) 0;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: thin;
      }
      .images-item {
        background-color: var(--boxel-200);
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        padding: var(--boxel-sp-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 30%;
        min-width: 200px;
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
        grid-template-columns: repeat(auto-fill, 150px);
        gap: var(--boxel-sp);
        list-style: none;
        margin-block: 0;
        padding-inline-start: 0;
      }
      .example-card {
        min-height: 180px;
      }

      .skills-list {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--boxel-sp);
        list-style: none;
        margin-block: 0;
        padding-inline-start: 0;
      }

      .two-col {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--boxel-sp-xxl);
        margin-top: var(--boxel-sp);
        align-items: start;
      }
      .two-col .app-listing-categories,
      .two-col .app-listing-tags {
        min-width: 0;
      }

      .listing-accordion-content {
        height: 40px;
      }

      @container app-listing-embedded (inline-size <= 600px) {
        .app-listing-info {
          margin-left: 0;
        }
        .license-statistic,
        .stats-container,
        .pricing-plans {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @container app-listing-embedded (inline-size <= 360px) {
        .examples-list {
          grid-template-columns: 1fr;
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
  @field examples = linksToMany(() => CardDef);
  @field skills = linksToMany(() => Skill);

  @field cardTitle = contains(StringField, {
    computeVia(this: Listing) {
      return this.name;
    },
  });

  protected getGenerateExampleMenuItem(
    params: GetMenuItemParams,
  ): MenuItemOptions | undefined {
    if (!params.commandContext) {
      return undefined;
    }
    const firstExample =
      Array.isArray(this.examples) && this.examples.length
        ? (this.examples[0] as CardDef | undefined)
        : undefined;
    if (!firstExample) {
      return undefined;
    }
    return {
      label: 'Generate Example with AI',
      action: async () => {
        const command = new ListingGenerateExampleCommand(
          params.commandContext,
        );
        try {
          await command.execute({
            listing: this,
            referenceExample: firstExample,
          });
        } catch (error) {
          console.warn('Failed to generate listing example', { error });
        }
      },
      icon: Wand,
      id: 'generate-listing-example',
    };
  }

  private getUpdateSpecsMenuItem(
    params: GetMenuItemParams,
  ): MenuItemOptions | undefined {
    if (params.menuContext !== 'interact') {
      return;
    }
    const commandContext = params.commandContext;
    const targetRealm = this[realmURL]?.href;
    if (!commandContext || !targetRealm) {
      return;
    }

    return {
      label: 'Update Specs',
      id: 'update-listing-specs',
      icon: Refresh,
      action: () =>
        new ListingUpdateSpecsCommand(commandContext).execute({
          listing: this,
        }),
    };
  }

  [getMenuItems](params: GetMenuItemParams): MenuItemOptions[] {
    let menuItems = super
      [getMenuItems](params)
      .filter((item) => item.label?.toLowerCase() !== 'create listing with ai');
    if (params.menuContext === 'interact') {
      const extra = this.getGenerateExampleMenuItem(params);
      if (extra) {
        menuItems = [...menuItems, extra];
      }
      const updateSpecs = this.getUpdateSpecsMenuItem(params);
      if (updateSpecs) {
        menuItems = [...menuItems, updateSpecs];
      }
      const createPRMenuItem = this.getCreatePRMenuItem(params);
      if (createPRMenuItem) {
        menuItems = [...menuItems, createPRMenuItem];
      }
    }
    return menuItems;
  }

  private getCreatePRMenuItem(
    params: GetMenuItemParams,
  ): MenuItemOptions | undefined {
    if (params.menuContext !== 'interact') {
      return;
    }
    if (!this[realmURL]?.href) {
      return;
    }
    const commandContext = params.commandContext;
    if (!commandContext) {
      return;
    }

    return {
      label: 'Make a PR',
      action: async () => {
        await new CreateListingPRCommand(commandContext).execute({
          listingId: this.id,
          realm: this[realmURL]!.href,
        });
      },
      icon: Package,
    };
  }

  static isolated = EmbeddedTemplate;
  static embedded = EmbeddedTemplate;
  static fitted = ListingFittedTemplate;
}

export class AppListing extends Listing {
  static displayName = 'AppListing';
}

export class CardListing extends Listing {
  static displayName = 'CardListing';
  @field skills = linksToMany(() => Skill);
}

export class FieldListing extends Listing {
  static displayName = 'FieldListing';
}

export class SkillListing extends Listing {
  static displayName = 'SkillListing';
}

export class ThemeListing extends Listing {
  static displayName = 'ThemeListing';
}

function specBreakdown(specs: Spec[]): Record<string, Spec[]> {
  return specs.reduce(
    (groupedSpecs, spec) => {
      if (!spec || !instanceOf(spec, Spec)) {
        // During prerender linksToMany may still contain not-loaded placeholders;
        // skip until the real Spec instance arrives.
        return groupedSpecs;
      }
      let key = spec.specType ?? 'unknown';
      if (!groupedSpecs[key]) {
        groupedSpecs[key] = [];
      }
      groupedSpecs[key].push(spec);
      return groupedSpecs;
    },
    {} as Record<string, Spec[]>,
  );
}
