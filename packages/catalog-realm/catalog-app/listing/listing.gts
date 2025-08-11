import {
  contains,
  field,
  CardDef,
  containsMany,
  linksToMany,
  StringField,
  linksTo,
  Component,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { Spec, type SpecType } from 'https://cardstack.com/base/spec';
import { Skill } from 'https://cardstack.com/base/skill';

import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { tracked, cached } from '@glimmer/tracking';
import { task } from 'ember-concurrency';
import { resource, use } from 'ember-resources';
import { consume } from 'ember-provide-consume-context';

import {
  Accordion,
  Pill,
  BoxelDropdown,
  BoxelButton,
  Menu as BoxelMenu,
  CardContainer,
} from '@cardstack/boxel-ui/components';
import { MenuItem, eq } from '@cardstack/boxel-ui/helpers';

import AppListingHeader from '../components/app-listing-header';
import { ListingFittedTemplate } from '../components/listing-fitted';

import ListingRemixCommand from '@cardstack/boxel-host/commands/listing-remix';
import UseAiAssistantCommand from '@cardstack/boxel-host/commands/ai-assistant';
import ListingBuildCommand from '@cardstack/boxel-host/commands/listing-action-build';
import GetAllRealmMetasCommand from '@cardstack/boxel-host/commands/get-all-realm-metas';

import { Publisher } from './publisher';
import { Category } from './category';
import { License } from './license';
import { Tag } from './tag';

class EmbeddedTemplate extends Component<typeof Listing> {
  @tracked selectedAccordionItem: string | undefined;
  @tracked writableRealms: { name: string; url: string; iconURL?: string }[] =
    [];

  allRealmsInfoResource = this.args.context?.getCommandData?.(
    this,
    GetAllRealmMetasCommand,
    undefined,
  );

  get writableRealmsFromCommand() {
    const commandResource = this.allRealmsInfoResource?.current;
    if (commandResource?.isSuccess && commandResource.result?.results) {
      return commandResource.result.results
        .filter(({ canWrite }: any) => canWrite)
        .map(({ info }: any) => ({
          name: info.name,
          url: info.url,
          iconURL: info.iconURL,
        }));
    }
    return [];
  }

  constructor(owner: any, args: any) {
    super(owner, args);
  }

  private getRealmOptions(actionCallback: (realmUrl: string) => void) {
    const realms = this.writableRealmsFromCommand;
    return realms
      .filter((realm) => realm.url !== this.args.model[realmURL]?.href)
      .map((realm) => {
        return new MenuItem(realm.name, 'action', {
          action: () => {
            actionCallback(realm.url);
          },
          iconURL: realm.iconURL ?? '/default-realm-icon.png',
        });
      });
  }

  get remixRealmOptions() {
    return this.getRealmOptions((realmUrl) => this.remix(realmUrl));
  }

  get buildRealmOptions() {
    return this.getRealmOptions((realmUrl) => this.build(realmUrl));
  }

  _build = task(async (realm: string) => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      throw new Error('Missing commandContext');
    }
    try {
      await new ListingBuildCommand(commandContext).execute({
        realm,
        listing: this.args.model as Listing,
      });
    } catch (error) {
      console.error(error);
    }
  });

  _remix = task(async (realm: string) => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      throw new Error('Missing commandContext');
    }
    let listing = this.args.model as Listing;
    await new ListingRemixCommand(commandContext).execute({
      realm,
      listing,
    });
  });

  get hasOneOrMoreSpec() {
    return this.args.model.specs && this.args.model?.specs?.length > 0;
  }

  get isSkillListing() {
    return this.args.model instanceof SkillListing;
  }

  get hasSkills() {
    return this.args.model.skills && this.args.model?.skills?.length > 0;
  }

  get addSkillsDisabled() {
    return !this.isSkillListing || !this.hasSkills;
  }

  get isStub() {
    return this.args.model.tags?.find((tag) => tag.name === 'Stub');
  }

  get remixDisabled() {
    return (
      (!this.isSkillListing && !this.hasOneOrMoreSpec) ||
      (this.isSkillListing && !this.hasSkills)
    );
  }

  @action addSkillsToCurrentRoom() {
    this._addSkillsToCurrentRoom.perform();
  }

  _addSkillsToCurrentRoom = task(async () => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      throw new Error('Missing commandContext');
    }

    let useAiAssistantCommand = new UseAiAssistantCommand(commandContext);
    await useAiAssistantCommand.execute({
      skillCards: Array.isArray(this.args.model.skills)
        ? [...this.args.model.skills]
        : [],
      openRoom: true,
    });
  });

  @action preview() {
    if (!this.args.model.examples || this.args.model.examples.length === 0) {
      throw new Error('No examples to preview');
    }
    this.args.context?.actions?.viewCard?.(this.args.model.examples[0]);
  }

  @action build(realmUrl: string) {
    this._build.perform(realmUrl);
  }

  @action remix(realmUrl: string) {
    this._remix.perform(realmUrl);
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

  get displayButton() {
    return (
      this.writableRealms.length > 0 &&
      !this.allRealmsInfoResource?.current?.isLoading
    );
  }

  <template>
    <div class='app-listing-embedded'>
      <AppListingHeader
        @thumbnailUrl={{@model.thumbnailURL}}
        @name={{this.appName}}
        @description={{@model.description}}
        @publisher={{this.publisherName}}
      >
        <:action>
          <div class='action-buttons'>
            {{#if this.isSkillListing}}
              <BoxelButton
                class='action-button'
                data-test-catalog-listing-embedded-add-skills-to-room-button
                @loading={{this._addSkillsToCurrentRoom.isRunning}}
                @disabled={{this.addSkillsDisabled}}
                {{on 'click' this.addSkillsToCurrentRoom}}
              >
                Use Skills
              </BoxelButton>
            {{/if}}
            {{#if this.hasExamples}}
              <BoxelButton
                class='action-button'
                data-test-catalog-listing-embedded-preview-button
                {{on 'click' this.preview}}
              >
                Preview
              </BoxelButton>
            {{/if}}
            {{#if this.displayButton}}
              {{#if this.isStub}}
                <BoxelDropdown @autoClose={{true}}>
                  <:trigger as |bindings|>
                    <BoxelButton
                      class='action-button'
                      data-test-catalog-listing-embedded-build-button
                      @kind='primary'
                      @loading={{this._build.isRunning}}
                      {{bindings}}
                    >
                      Build
                    </BoxelButton>
                  </:trigger>
                  <:content as |dd|>
                    <BoxelMenu
                      class='realm-dropdown-menu'
                      @closeMenu={{dd.close}}
                      @items={{this.buildRealmOptions}}
                      data-test-catalog-listing-embedded-build-dropdown
                    />
                  </:content>
                </BoxelDropdown>
              {{else}}
                <BoxelDropdown @autoClose={{true}}>
                  <:trigger as |bindings|>
                    <BoxelButton
                      class='action-button'
                      data-test-catalog-listing-embedded-remix-button
                      @kind='primary'
                      @loading={{this._remix.isRunning}}
                      @disabled={{this.remixDisabled}}
                      {{bindings}}
                    >
                      Remix
                    </BoxelButton>
                  </:trigger>
                  <:content as |dd|>
                    <BoxelMenu
                      class='realm-dropdown-menu'
                      @closeMenu={{dd.close}}
                      @items={{this.remixRealmOptions}}
                      data-test-catalog-listing-embedded-remix-dropdown
                    />
                  </:content>
                </BoxelDropdown>
              {{/if}}
            {{/if}}
          </div>
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

      <section
        class='app-listing-categories'
        data-test-catalog-listing-embedded-categories-section
      >
        <h2>Categories</h2>
        {{#if this.hasCategories}}
          <ul
            class='categories-list'
            data-test-catalog-listing-embedded-categories
          >
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
      .realm-dropdown-menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs);
        --boxel-menu-item-gap: var(--boxel-sp-xs);
        min-width: 13rem;
        max-height: 13rem;
        overflow-y: scroll;
      }
      .realm-dropdown-menu :deep(.menu-item__icon-url) {
        border-radius: var(--boxel-border-radius-xs);
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
        grid-template-columns: repeat(auto-fill, 150px);
        gap: var(--boxel-sp);
        list-style: none;
        margin-block: 0;
        padding-inline-start: 0;
      }
      .example-card {
        min-height: 180px;
      }

      .categories-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-sm);
        list-style: none;
        margin-block: 0;
        padding-inline-start: 0;
      }

      .skills-list {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--boxel-sp);
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
        .images-list {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @container app-listing-embedded (inline-size <= 360px) {
        .images-list {
          grid-template-columns: repeat(1, 1fr);
        }
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
  @field skills = linksToMany(() => Skill);
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
