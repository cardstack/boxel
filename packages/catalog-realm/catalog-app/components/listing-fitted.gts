import {
  Component,
  CardDef,
  CardContext,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import { commandData } from 'https://cardstack.com/base/resources/command-data';
import type { Skill } from 'https://cardstack.com/base/skill';
import type {
  GetAllRealmMetasResult,
  RealmMetaField,
} from 'https://cardstack.com/base/command';
import GlimmerComponent from '@glimmer/component';

import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency';
import { on } from '@ember/modifier';
import { add, eq, MenuItem } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';

import { type Listing } from '../listing/listing';

import {
  BoxelDropdown,
  BoxelButton,
  Menu as BoxelMenu,
} from '@cardstack/boxel-ui/components';

import ListingBuildCommand from '@cardstack/boxel-host/commands/listing-action-build';
import ListingRemixCommand from '@cardstack/boxel-host/commands/listing-remix';
import UseAiAssistantCommand from '@cardstack/boxel-host/commands/ai-assistant';
import GetAllRealmMetasCommand from '@cardstack/boxel-host/commands/get-all-realm-metas';

interface Signature {
  Element: HTMLElement;
  Args: {
    context: CardContext | undefined;
    id: string | undefined;
    items: string[];
    examples?: CardDef[];
    skills?: Skill[];
    modelType?: string;
  };
}

class CarouselComponent extends GlimmerComponent<Signature> {
  @tracked currentIndex = 0;

  get totalSlides() {
    return this.args.items?.length ?? 0;
  }

  get prevIndex() {
    return this.currentIndex === 0
      ? this.totalSlides - 1
      : this.currentIndex - 1;
  }

  get nextIndex() {
    return this.currentIndex === this.totalSlides - 1
      ? 0
      : this.currentIndex + 1;
  }

  get hasSlide() {
    return this.totalSlides > 0;
  }

  get hasMultipleSlides() {
    return this.totalSlides > 1;
  }

  get hasExample() {
    return this.args.examples && this.args.examples.length > 0;
  }

  get isSkillListing() {
    return this.args.modelType === 'SkillListing';
  }

  get hasSkills() {
    return this.args.skills && this.args.skills?.length > 0;
  }

  get addSkillsDisabled() {
    // Only disable if it's a skill listing but has no skills
    // The button is only shown for skill listings, so we don't need to check isSkillListing here
    return !this.hasSkills;
  }

  @action
  _stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  @action previewExample(e: MouseEvent) {
    e.stopPropagation();

    if (!this.hasExample) {
      throw new Error('No valid example found to preview');
    }

    this.args.context?.actions?.viewCard?.(this.args.examples![0]);
  }

  @action viewListingDetails(e: MouseEvent) {
    e.stopPropagation();

    if (!this.args.id) {
      throw new Error('No card id');
    }

    this.args.context?.actions?.viewCard?.(new URL(this.args.id), 'isolated');
  }

  @action
  updateCurrentIndex(index: number, e: MouseEvent) {
    e.stopPropagation();

    if (index < 0 || index >= this.totalSlides) {
      return;
    }
    this.currentIndex = index;
  }

  @action addSkillsToCurrentRoom(e: MouseEvent) {
    e.stopPropagation();
    this._addSkillsToCurrentRoom.perform();
  }

  _addSkillsToCurrentRoom = task(async () => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      throw new Error('Missing commandContext');
    }

    // Double-check that we have skills before proceeding
    if (!this.hasSkills) {
      throw new Error('No skills found to add to current room');
    }

    let useAiAssistantCommand = new UseAiAssistantCommand(commandContext);
    await useAiAssistantCommand.execute({
      skillCards: Array.isArray(this.args.skills) ? [...this.args.skills] : [],
      openRoom: true,
    });
  });

  <template>
    <div
      class='carousel'
      tabindex='0'
      data-test-catalog-listing-fitted-preview
      aria-label='Preview Example'
      {{on 'click' this.previewExample}}
    >
      <div
        class='actions-buttons-container'
        {{on 'mouseenter' this._stopPropagation}}
      >
        {{#if this.hasExample}}
          <BoxelButton
            @kind='secondary-dark'
            class='preview-button'
            data-test-catalog-listing-fitted-preview-button
            aria-label='Preview Example'
            {{on 'click' this.previewExample}}
          >
            Preview
          </BoxelButton>
        {{/if}}

        {{#if this.isSkillListing}}
          <BoxelButton
            @kind='secondary-dark'
            class='add-skills-button'
            data-test-catalog-listing-fitted-add-skills-to-room-button
            @loading={{this._addSkillsToCurrentRoom.isRunning}}
            @disabled={{this.addSkillsDisabled}}
            aria-label='Add Skills to Current Room'
            {{on 'click' this.addSkillsToCurrentRoom}}
          >
            Use Skills
          </BoxelButton>
        {{/if}}

        <BoxelButton
          @kind='secondary-dark'
          class='details-button'
          data-test-catalog-listing-fitted-details-button
          aria-label='View Listing Details'
          {{on 'click' this.viewListingDetails}}
        >
          Details
        </BoxelButton>
      </div>

      <div class='carousel-items'>
        {{#each @items as |item index|}}
          <div
            class='carousel-item carousel-item-{{index}}
              {{if (eq this.currentIndex index) "is-active"}}'
            aria-hidden={{if (eq this.currentIndex index) 'false' 'true'}}
          >
            <img
              src={{item}}
              alt='Slide {{add index 1}} of {{this.totalSlides}}'
            />
          </div>
        {{/each}}
      </div>

      {{#if this.hasMultipleSlides}}
        <div
          class='carousel-nav'
          role='presentation'
          {{on 'mouseenter' this._stopPropagation}}
        >
          <button
            class='carousel-arrow carousel-arrow-prev'
            aria-label='Previous slide'
            {{on 'click' (fn this.updateCurrentIndex this.prevIndex)}}
          >
            &#10094;
          </button>
          <button
            class='carousel-arrow carousel-arrow-next'
            aria-label='Next slide'
            {{on 'click' (fn this.updateCurrentIndex this.nextIndex)}}
          >
            &#10095;
          </button>
        </div>
      {{/if}}

      {{#if this.hasMultipleSlides}}
        <div
          class='carousel-dots'
          role='presentation'
          {{on 'mouseenter' this._stopPropagation}}
        >
          {{#each @items as |_ index|}}
            <div
              class='carousel-dot
                {{if (eq this.currentIndex index) "is-active"}}'
              {{on 'click' (fn this.updateCurrentIndex index)}}
              role='button'
              aria-label='Go to slide {{add index 1}}'
            />
          {{/each}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      @layer {
        .carousel {
          --boxel-carousel-z-index: 1;
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
          container-type: inline-size;
          outline: none;
        }
        .carousel:focus-visible {
          outline: 2px solid var(--boxel-highlight);
          outline-offset: 2px;
        }
        .carousel-items {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .carousel-item {
          position: absolute;
          visibility: hidden;
          flex: 0 0 100%;
          justify-content: center;
          align-items: center;
          padding: var(--boxel-sp) var(--boxel-sp-xs);
          display: flex;
          opacity: 0;
          transition:
            opacity 1s ease,
            visibility 0s linear 1s;
        }
        .carousel-item.is-active {
          visibility: visible;
          opacity: 1;
          transition:
            opacity 1s ease,
            visibility 0s;
        }
        .carousel-item img {
          width: 100%;
          height: auto;
          object-fit: cover;
          display: block;
          border-radius: var(--boxel-border-radius-sm);
          box-shadow:
            0 15px 20px rgba(0, 0, 0, 0.12),
            0 5px 10px rgba(0, 0, 0, 0.1);
        }

        .carousel-arrow {
          all: unset;
          cursor: pointer;
          user-select: none;
          padding: 0px;
          width: 2rem;
          height: 2rem;
          display: inline-flex;
          justify-content: center;
          align-items: center;
        }
        .carousel-arrow-prev {
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          z-index: calc(var(--boxel-carousel-z-index));
        }
        .carousel-arrow-next {
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
          z-index: calc(var(--boxel-carousel-z-index));
        }

        .carousel-arrow-next {
          position: absolute;
          right: 0;
          top: 50%;
          transform: translateY(-50%);
        }
        .carousel-dots {
          position: absolute;
          bottom: 5px;
          left: 50%;
          z-index: var(--boxel-carousel-z-index);
          transform: translateX(-50%);
          display: flex;
          justify-content: center;
          gap: 0.5rem;
        }
        .carousel-dot {
          width: 10px;
          height: 10px;
          background-color: var(--boxel-100);
          border: 1px solid var(--boxel-500);
          border-radius: 50%;
          cursor: pointer;
          padding: 0px;
        }
        .carousel-dot.is-active {
          background-color: var(--boxel-400);
          border: 1px solid var(--boxel-700);
        }

        .actions-buttons-container {
          position: absolute;
          top: 0;
          left: 0;
          z-index: var(--boxel-carousel-z-index);
          width: 100%;
          height: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: var(--boxel-sp-sm);
          opacity: 0;
          background-color: rgba(0, 0, 0, 0.6);
          transition: opacity 0.3s ease;
        }

        .carousel:hover .carousel-item img {
          box-shadow:
            0 15px 20px rgba(0, 0, 0, 0.2),
            0 7px 10px rgba(0, 0, 0, 0.12);
        }
        .carousel:hover .actions-buttons-container {
          opacity: 1;
        }
        .carousel:hover .carousel-arrow {
          color: var(--boxel-200);
        }

        .preview-button,
        .details-button,
        .add-skills-button {
          --boxel-button-font: 600 var(--boxel-font-sm);
          --boxel-button-padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
          --boxel-button-border: 1px solid var(--boxel-light);
          --boxel-button-text-color: var(--boxel-100);
          box-shadow:
            0 15px 20px rgba(0, 0, 0, 0.12),
            0 5px 10px rgba(0, 0, 0, 0.1);
          pointer-events: auto;
          min-width: 100px;
        }
        .preview-button:hover,
        .details-button:hover,
        .add-skills-button:hover {
          --boxel-button-text-color: var(--boxel-light);
          --boxel-button-color: var(--boxel-purple);
          box-shadow:
            0 15px 25px rgba(0, 0, 0, 0.2),
            0 7px 15px rgba(0, 0, 0, 0.15);
          cursor: pointer;
        }

        @container (max-width: 250px) {
          .actions-buttons-container {
            flex-direction: column;
          }
          .preview-button,
          .details-button,
          .add-skills-button {
            --boxel-button-font: 600 var(--boxel-font-xs);
            --boxel-button-padding: var(--boxel-sp-xs) var(--boxel-sp);
          }
        }

        @container (max-height: 140px) {
          .actions-buttons-container,
          .carousel-nav,
          .carousel-dots {
            display: none;
          }
          .carousel-item {
            padding: var(--boxel-sp-4xs);
          }
          .carousel-item img,
          .carousel:hover .carousel-item img {
            box-shadow: none;
            border-radius: var(--boxel-border-radius-xs);
          }
        }
      }
    </style>
  </template>
}

export class ListingFittedTemplate extends Component<typeof Listing> {
  allRealmsInfoResource = commandData<typeof GetAllRealmMetasResult>(
    this,
    GetAllRealmMetasCommand,
  );

  get writableRealms(): { name: string; url: string; iconURL?: string }[] {
    const commandResource = this.allRealmsInfoResource;
    if (commandResource?.isSuccess && commandResource) {
      const result = commandResource.value;
      if (result?.results) {
        return result.results
          .filter((realmMeta: RealmMetaField) => realmMeta.canWrite)
          .map((realmMeta: RealmMetaField) => ({
            name: realmMeta.info.name,
            url: realmMeta.url,
            iconURL: realmMeta.info.iconURL,
          }));
      }
    }
    return [];
  }

  private getRealmOptions(actionCallback: (realmUrl: string) => void) {
    return this.writableRealms
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

  get firstImage() {
    return this.args.model.images?.[0];
  }

  get publisherInfo() {
    const hasPublisher = Boolean(this.args.model.publisher?.name);
    return hasPublisher ? 'By ' + this.args.model.publisher?.name : '';
  }

  get hasTags() {
    return this.args.model.tags && this.args.model.tags.length > 0;
  }

  get firstTagName() {
    return this.args.model.tags?.[0]?.name;
  }

  get isStub() {
    return this.args.model.tags?.find((tag) => tag.name === 'Stub');
  }

  get modelType() {
    return this.args.model.constructor?.name;
  }

  _remix = task(async (realmUrl: string) => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      throw new Error('Missing commandContext');
    }
    let listing = this.args.model as Listing;
    await new ListingRemixCommand(commandContext).execute({
      realm: realmUrl,
      listing,
    });
  });

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

  @action build(realmUrl: string) {
    this._build.perform(realmUrl);
  }

  @action remix(realmUrl: string) {
    this._remix.perform(realmUrl);
  }

  @action viewListingDetails(e: MouseEvent) {
    e.stopPropagation();

    if (!this.args.model.id) {
      throw new Error('No card id');
    }

    this.args.context?.actions?.viewCard?.(
      new URL(this.args.model.id),
      'isolated',
    );
  }

  @action
  _stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  <template>
    <div class='fitted-template'>
      <div class='display-section'>
        {{#if @model.images}}
          <CarouselComponent
            @context={{@context}}
            @id={{@model.id}}
            @items={{@model.images}}
            @examples={{@model.examples}}
            @skills={{@model.skills}}
            @modelType={{this.modelType}}
          />
        {{else}}
          <@model.constructor.icon
            data-test-card-type-icon
            class='card-type-icon'
          />
        {{/if}}
      </div>
      <div
        class='info-section'
        tabindex='0'
        data-test-catalog-listing-fitted-details
        aria-label='View Listing Details'
        {{on 'click' this.viewListingDetails}}
      >
        <div class='card-content'>
          <h3 class='card-title' data-test-card-title={{@model.name}}>
            {{@model.name}}
          </h3>
          <h4 class='card-display-name' data-test-card-display-name>
            {{this.publisherInfo}}
          </h4>
        </div>
        <div class='card-tags-action'>
          {{#if this.hasTags}}
            <span class='card-tags'># {{this.firstTagName}}</span>
          {{/if}}
          {{#if this.isStub}}
            <BoxelDropdown @autoClose={{true}}>
              <:trigger as |bindings|>
                <BoxelButton
                  class='card-build-button'
                  data-test-catalog-listing-fitted-build-button
                  @kind='primary'
                  @loading={{this._build.isRunning}}
                  {{on 'click' this._stopPropagation}}
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
                  data-test-catalog-listing-fitted-build-dropdown
                />
              </:content>
            </BoxelDropdown>
          {{else}}
            <BoxelDropdown @autoClose={{true}}>
              <:trigger as |bindings|>
                <BoxelButton
                  data-test-catalog-listing-fitted-remix-button
                  @kind='primary'
                  @size='extra-small'
                  class='card-remix-button'
                  @loading={{this._remix.isRunning}}
                  {{on 'click' this._stopPropagation}}
                  {{bindings}}
                  aria-label='Remix listing'
                >
                  Remix
                </BoxelButton>
              </:trigger>
              <:content as |dd|>
                <BoxelMenu
                  class='realm-dropdown-menu'
                  @closeMenu={{dd.close}}
                  @items={{this.remixRealmOptions}}
                  @loading={{this.allRealmsInfoResource.isLoading}}
                  data-test-catalog-listing-fitted-remix-dropdown
                />
              </:content>
            </BoxelDropdown>
          {{/if}}
        </div>
      </div>
    </div>

    {{! template-lint-disable no-whitespace-for-layout  }}
    {{! ignore the above error because ember-template-lint complains about the whitespace in the multi-line comment below }}
    <style scoped>
      @layer {
        .fitted-template {
          width: 100%;
          height: 100%;
          display: flex;
          overflow: hidden;
        }
        .fitted-template :deep(.ember-basic-dropdown-content-placeholder) {
          display: none;
        }
        .fitted-template :deep(.ember-basic-dropdown-content-wormhole-origin) {
          position: absolute;
        }
        .display-section {
          flex-shrink: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
          background-color: var(--boxel-200);
        }
        .card-type-icon {
          aspect-ratio: 1 / 1;
          width: 52px;
          height: 52px;
          max-width: 100%;
          max-height: 100%;
        }
        .info-section {
          display: flex;
          gap: var(--boxel-sp-sm);
          width: 100%;
          overflow: hidden;
          text-align: left;
          padding: var(--boxel-sp-xs) var(--boxel-sp);
        }
        .card-tags-action {
          display: flex;
          align-items: end;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
        }
        .card-title {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          margin-block: 0;
          font: 600 var(--boxel-font-sm);
          letter-spacing: var(--boxel-lsp-sm);
          line-height: 1.25;
          text-overflow: ellipsis;
        }
        .card-display-name {
          margin-top: var(--boxel-sp-4xs);
          margin-bottom: 0;
          color: var(--boxel-450);
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-xs);
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow: hidden;
        }
        .card-tags {
          color: var(--boxel-400);
          font: 500 var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-xs);
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1 1 auto;
          overflow: hidden;
        }
        .card-build-button {
          --boxel-button-font: 600 var(--boxel-font-sm);
          margin-left: auto;
          flex: 0 0 auto;
        }
        .card-remix-button {
          --boxel-button-font: 600 var(--boxel-font-sm);
          margin-left: auto;
          flex: 0 0 auto;
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
      }

      /* Aspect Ratio <= 1.0 (Vertical) */
      @container fitted-card (aspect-ratio <= 1.0) {
        .fitted-template {
          flex-direction: column;
        }
        .display-section {
          width: 100%;
          height: 68cqmax;
        }
        .info-section {
          flex-direction: column;
          justify-content: space-between;
          height: 100%;
          padding: var(--boxel-sp-xs);
        }
        .card-tags-action {
          flex-direction: row;
          justify-content: space-between;
        }
        .card-build-button {
          --boxel-button-padding: var(--boxel-sp-4xs) var(--boxel-sp);
        }
        .card-remix-button {
          --boxel-button-padding: var(--boxel-sp-4xs) var(--boxel-sp);
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (height <= 118px) {
        .display-section {
          display: none;
        }
      }
      /* Vertical Tiles*/
      /* Small Tile (150 x 170) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width ) and (170px <= height) {
        .card-title {
          font-size: var(--boxel-font-size-sm);
          -webkit-line-clamp: 3;
        }
      }
      /* CardsGrid Tile (170 x 250) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px < width < 250px ) and (170px < height < 275px) {
        .display-section {
          height: 55cqmax;
        }
        .card-title {
          font-size: var(--boxel-font-size);
          -webkit-line-clamp: 1;
        }
        .card-display-name,
        .card-tags {
          display: none;
        }
        .card-build-button {
          --boxel-button-padding: var(--boxel-sp-4xs) var(--boxel-sp);
        }
        .card-remix-button {
          --boxel-button-padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        }
      }
      /* Tall Tile (150 x 275) */
      @container fitted-card (aspect-ratio <= 1.0) and (150px <= width ) and (275px <= height) {
        .card-title {
          font-size: var(--boxel-font-size);
          -webkit-line-clamp: 1;
        }
      }
      /* Large Tile (250 x 275) */
      @container fitted-card (aspect-ratio <= 1.0) and (250px <= width ) and (275px <= height) {
        .card-title {
          -webkit-line-clamp: 1;
        }
      }
      /* Vertical Cards */
      @container fitted-card (aspect-ratio <= 1.0) and (400px <= width) {
        .card-title {
          font-size: var(--boxel-font-size-med);
          -webkit-line-clamp: 4;
        }
      }

      /* Expanded Card (400 x 445) */
      /* 1.0 < Aspect Ratio (Horizontal) */
      @container fitted-card (1.0 < aspect-ratio) {
        .display-section {
          aspect-ratio: 1;
          max-width: 44%;
        }
        .info-section {
          flex-direction: column;
          justify-content: space-between;
        }
        .card-tags-action {
          flex-direction: row;
          justify-content: space-between;
        }
        .card-tags {
          display: none;
        }
      }
      @container fitted-card (1.0 < aspect-ratio) and (height <= 65px) {
        .info-section {
          align-self: center;
        }
      }
      /* Badges */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) {
        .display-section {
          display: none;
        }
      }
      /* Small Badge (150 x 40) */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (height < 65px) {
        .card-title {
          -webkit-line-clamp: 1;
          font: 600 var(--boxel-font-xs);
        }
        .card-display-name {
          margin-top: 0;
        }
      }
      /* Medium Badge (150 x 65) */

      /* Large Badge (150 x 105) */
      @container fitted-card (1.0 < aspect-ratio) and (width < 250px) and (105px <= height) {
        .card-title {
          -webkit-line-clamp: 3;
        }
      }

      /* Strips */
      /* Single Strip (250 x 40) */
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width) and (height < 65px) {
        .fitted-template {
          padding: var(--boxel-sp-xxxs);
        }
        .card-display-name {
          display: none;
        }
      }

      /* Horizontal Tiles */
      /* Regular Tile (250 x 170) */
      @container fitted-card (1.0 < aspect-ratio) and (250px <= width < 400px) and (170px <= height) {
        .card-title {
          -webkit-line-clamp: 4;
          font-size: var(--boxel-font-size);
        }
      }

      /* Horizontal Cards */
      /* Compact Card  */
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (170px <= height) {
        .display-section {
          height: 100%;
        }
        .card-title {
          -webkit-line-clamp: 4;
          font-size: var(--boxel-font-size);
        }

        @container fitted-card (height <= 65px) {
          .card-title {
            -webkit-line-clamp: 1;
            font-size: var(--boxel-font-size);
          }
        }
      }

      /* Full Card (400 x 275) */
      @container fitted-card (1.0 < aspect-ratio) and (400px <= width) and (275px <= height) {
        .card-title {
          font-size: var(--boxel-font-size-med);
        }
        .info-section {
          padding: var(--boxel-sp);
        }
      }

      /* Control Card which is Smaller than */
      @container fitted-card (aspect-ratio <= 1.0) and (width <= 275px) {
        .card-tags {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (height <= 275px) {
        .card-title {
          -webkit-line-clamp: 1;
        }
        .card-display-name {
          display: none;
        }
      }

      /* Control linked to many component fitted size */
      @container fitted-card (height <= 65px) {
        .display-section {
          padding: var(--boxel-sp-xs);
        }
        .card-tags-action {
          display: none;
        }
      }
    </style>
  </template>
}
