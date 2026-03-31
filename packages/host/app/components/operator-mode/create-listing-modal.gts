import { fn, hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import onKeyMod from 'ember-keyboard/modifiers/on-key';

import {
  Button,
  FieldContainer,
  IconButton,
  LoadingIndicator,
  RealmIcon,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import {
  chooseCard,
  isResolvedCodeRef,
  removeFileExtension,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import ListingCreateCommand from '@cardstack/host/commands/listing-create';
import ModalContainer from '@cardstack/host/components/modal-container';
import { SelectedTypePill } from '@cardstack/host/components/operator-mode/create-file-modal';
import PrerenderedCardSearch from '@cardstack/host/components/prerendered-card-search';
import { Submodes } from '@cardstack/host/components/submode-switcher';

import type CommandService from '@cardstack/host/services/command-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';

interface Signature {
  Args: {};
}

export default class CreateListingModal extends Component<Signature> {
  @service declare private commandService: CommandService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;

  @tracked private _selectedExampleURLs: string[] | null = null;

  private get payload() {
    return this.operatorModeStateService.createListingModalPayload;
  }

  private get isModalOpen() {
    return Boolean(this.payload);
  }

  private get realmInfo() {
    let payload = this.payload;
    if (!payload) {
      return undefined;
    }
    return this.realm.info(payload.targetRealm);
  }

  private get codeRef(): ResolvedCodeRef | undefined {
    let codeRef = this.payload?.codeRef;
    return codeRef && isResolvedCodeRef(codeRef) ? codeRef : undefined;
  }

  private get codeRefTitle(): string {
    return this.codeRef?.name ?? 'Unknown';
  }

  private get codeRefId(): string {
    return this.codeRef?.module ?? '';
  }

  private get selectedExampleURLs(): string[] {
    return this._selectedExampleURLs ?? this.payload?.openCardIds ?? [];
  }

  private get shouldShowExampleRow(): boolean {
    return (this.payload?.declarationKind ?? 'card') === 'card';
  }

  private get selectedExampleCardUrls(): string[] {
    return this.selectedExampleURLs.map((url) =>
      url.endsWith('.json') ? url : `${url}.json`,
    );
  }

  private get selectedExampleRealms(): string[] {
    let realms = this.selectedExampleURLs.flatMap((cardUrl) => {
      try {
        let realmURL = this.realm.realmOfURL(new URL(cardUrl))?.href;
        return realmURL ? [realmURL] : [];
      } catch (_error) {
        return [];
      }
    });
    return [...new Set(realms)];
  }

  private chooseExamples = task(async () => {
    let codeRef = this.codeRef;
    if (!codeRef) {
      return;
    }
    let consumingRealm = this.payload?.targetRealm
      ? new URL(this.payload.targetRealm)
      : undefined;
    let selected = await chooseCard(
      { filter: { type: codeRef } },
      {
        multiSelect: true,
        consumingRealm,
        preselectedCardUrls: this.selectedExampleURLs,
      },
    );
    if (selected) {
      this._selectedExampleURLs = selected;
    }
  });

  @action private removeSelectedExample(urlToRemove: string) {
    let normalizedUrlToRemove = removeFileExtension(urlToRemove);
    let before = this.selectedExampleURLs;
    this._selectedExampleURLs = this.selectedExampleURLs.filter(
      (url) => removeFileExtension(url) !== normalizedUrlToRemove,
    );
  }

  private createListing = task(async () => {
    let payload = this.payload;
    if (!payload) {
      throw new Error('Cannot create listing without a modal payload');
    }

    let codeRef = this.codeRef;
    if (!codeRef) {
      throw new Error('Cannot create listing without a resolved code ref');
    }

    let targetRealm = payload.targetRealm;
    let openCardIds = this.selectedExampleURLs;

    let result = await new ListingCreateCommand(
      this.commandService.commandContext,
    ).execute({
      codeRef,
      targetRealm,
      openCardIds,
    });

    // Navigate to the listing in code mode with isolated preview
    let cardUrl = result?.listing?.id;
    if (cardUrl) {
      if (this.operatorModeStateService.workspaceChooserOpened) {
        this.operatorModeStateService.closeWorkspaceChooser();
      }
      await this.operatorModeStateService.updateSubmode(Submodes.Code);
      await this.operatorModeStateService.updateCodePath(
        new URL(cardUrl + '.json'),
        'preview',
      );
      this.operatorModeStateService.updateCardPreviewFormat('isolated');
    }

    // Keep modal open while background auto-patching runs
    let backgroundWork = (result as any)?.backgroundWork;
    if (backgroundWork) {
      await backgroundWork;
    }

    this._selectedExampleURLs = null;
    this.operatorModeStateService.dismissCreateListingModal();
  });

  @action private onClose() {
    this._selectedExampleURLs = null;
    this.operatorModeStateService.dismissCreateListingModal();
  }

  <template>
    {{#if this.isModalOpen}}
      <ModalContainer
        class='create-listing-modal'
        @cardContainerClass='create-listing'
        @title='Create Listing'
        @size='small'
        @isOpen={{this.isModalOpen}}
        @onClose={{this.onClose}}
        data-test-create-listing-modal
      >
        <:content>
          <p class='description'>
            You need a listing to share your code with others and publish to
            catalogs.
          </p>
          <FieldContainer @label='Create In' @tag='label' class='field'>
            <div class='field-contents' data-test-create-listing-target-realm>
              {{#if this.realmInfo}}
                <RealmIcon class='realm-icon' @realmInfo={{this.realmInfo}} />
                <span>{{this.realmInfo.name}}</span>
              {{/if}}
            </div>
          </FieldContainer>

          <FieldContainer @label='CodeRef' class='field'>
            <div class='field-contents' data-test-create-listing-coderef>
              <SelectedTypePill
                @title={{this.codeRefTitle}}
                @id={{this.codeRefId}}
              />
            </div>
          </FieldContainer>

          {{#if this.shouldShowExampleRow}}
            <FieldContainer @label='Examples' class='field'>
              <div
                class='field-contents examples-field'
                data-test-create-listing-examples
              >
                {{#if this.selectedExampleURLs.length}}
                  <div
                    class='selected-examples-list'
                    data-test-selected-examples
                  >
                    <PrerenderedCardSearch
                      @query={{hash}}
                      @cardUrls={{this.selectedExampleCardUrls}}
                      @format='atom'
                      @realms={{this.selectedExampleRealms}}
                      @isLive={{false}}
                    >
                      <:loading>
                        <div class='selected-example-loading'>
                          <LoadingIndicator />
                        </div>
                      </:loading>
                      <:response as |cards|>
                        {{#each cards key='url' as |card|}}
                          <div
                            class='selected-example-atom'
                            data-test-selected-example-chip={{card.url}}
                            data-test-selected-example={{card.url}}
                          >
                            <card.component />
                            <IconButton
                              class='selected-example-remove-button'
                              @icon={{IconX}}
                              @height='10'
                              @width='10'
                              aria-label='Remove example'
                              {{on
                                'click'
                                (fn this.removeSelectedExample card.url)
                              }}
                              data-test-selected-example-remove={{card.url}}
                            />
                          </div>
                        {{/each}}
                      </:response>
                    </PrerenderedCardSearch>
                  </div>
                {{/if}}
                <Button
                  @size='small'
                  @loading={{this.chooseExamples.isRunning}}
                  {{on 'click' (perform this.chooseExamples)}}
                  data-test-choose-examples-button
                >
                  {{#if this.selectedExampleURLs.length}}
                    {{this.selectedExampleURLs.length}}
                    {{if
                      (eq this.selectedExampleURLs.length 1)
                      'example'
                      'examples'
                    }}
                    selected
                  {{else}}
                    Add Examples
                  {{/if}}
                </Button>
              </div>
            </FieldContainer>
          {{/if}}
        </:content>
        <:footer>
          <div class='footer-buttons'>
            {{#if this.createListing.isRunning}}
              <p
                class='footer-loading-message'
                data-test-create-listing-loading
              >
                Setting up your
                <strong>{{this.codeRefTitle}}</strong>
                listing. This may take a moment...
              </p>
            {{else}}
              <Button
                @size='tall'
                {{on 'click' this.onClose}}
                {{onKeyMod 'Escape'}}
                data-test-create-listing-cancel-button
              >
                Cancel
              </Button>
            {{/if}}
            <Button
              @kind='primary'
              @size='tall'
              @loading={{this.createListing.isRunning}}
              @disabled={{this.createListing.isRunning}}
              {{on 'click' (perform this.createListing)}}
              {{onKeyMod 'Enter'}}
              data-test-create-listing-confirm-button
            >
              Create
            </Button>
          </div>
        </:footer>
      </ModalContainer>
    {{/if}}

    <style scoped>
      .create-listing-modal {
        --horizontal-gap: var(--boxel-sp-xs);
        --stack-card-footer-height: auto;
      }
      .create-listing-modal > :deep(.boxel-modal__inner) {
        display: flex;
      }
      .create-listing-modal :deep(.dialog-box__content) {
        display: flex;
        flex-direction: column;
      }
      .examples-field {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        align-items: center;
      }
      .selected-examples-list {
        display: inline-flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
        min-width: 0;
      }
      .selected-example-atom {
        position: relative;
        min-width: 0;
        display: inline-flex;
        align-items: center;
      }
      .selected-example-atom :deep([data-test-card-format='atom']) {
        min-width: 0;
      }
      .selected-example-atom
        :deep(.field-component-card.atom-format.display-container-true) {
        padding-right: calc(
          var(--boxel-sp-xs) + var(--boxel-icon-sm) + var(--boxel-sp-6xs)
        );
      }
      .selected-example-atom :deep(.card) {
        border: none;
        box-shadow: none;
        background: transparent;
      }
      .selected-example-remove-button {
        --icon-color: var(--boxel-700);
        --icon-bg: transparent;
        --icon-border: transparent;
        --boxel-icon-button-width: var(--boxel-icon-sm);
        --boxel-icon-button-height: var(--boxel-icon-sm);
        position: absolute;
        top: 50%;
        right: var(--boxel-sp-4xs);
        transform: translateY(-50%);
        border-radius: 999px;
        opacity: 0.72;
      }
      .selected-example-remove-button:hover,
      .selected-example-remove-button:focus-visible {
        --icon-bg: var(--boxel-200);
        --icon-border: var(--boxel-200);
        --icon-color: var(--boxel-900);
        opacity: 1;
      }
      .selected-example-loading {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 2rem;
        min-height: 1.5rem;
      }
      :deep(.create-listing) {
        height: 30rem;
      }
      .footer-loading-message {
        font: var(--boxel-font-sm);
        color: var(--boxel-500);
        margin: 0 auto 0 0;
        flex: 1;
        text-align: left;
        animation: fade-in 0.3s ease-out;
      }
      @keyframes fade-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      .description {
        font: var(--boxel-font-sm);
        color: var(--boxel-500);
        margin: 0 0 var(--boxel-sp-sm);
      }
      .field + .field {
        margin-top: var(--boxel-sp-sm);
      }
      .field {
        display: flex;
        flex-wrap: nowrap;
        align-items: start;
        gap: var(--boxel-sp-xxxs) var(--horizontal-gap);
      }
      .field :deep(.label-container) {
        width: 8rem;
        flex-shrink: 0;
      }
      .field :deep(.content) {
        flex-grow: 1;
        min-width: 0;
      }
      .field-contents {
        display: flex;
        align-items: center;
        gap: var(--horizontal-gap);
      }
      .realm-icon {
        --boxel-realm-icon-size: 1rem;
      }
      .footer-buttons {
        display: flex;
        align-items: center;
        gap: var(--horizontal-gap);
        width: 100%;
        justify-content: flex-end;
      }
    </style>
  </template>
}
