import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import onKeyMod from 'ember-keyboard/modifiers/on-key';

import {
  BoxelInput,
  Button,
  FieldContainer,
  GridContainer,
  RealmIcon,
} from '@cardstack/boxel-ui/components';

import {
  isResolvedCodeRef,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import ItemButton from '@cardstack/host/components/card-search/item-button';
import { Submodes } from '@cardstack/host/components/submode-switcher';
import ListingCreateCommand from '@cardstack/host/commands/listing-create';
import ModalContainer from '@cardstack/host/components/modal-container';
import { SelectedTypePill } from '@cardstack/host/components/operator-mode/create-file-modal';
import { getSearch } from '@cardstack/host/resources/search';

import type CommandService from '@cardstack/host/services/command-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';

import type { CardDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {};
}

export default class CreateListingModal extends Component<Signature> {
  @service declare private commandService: CommandService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;

  @tracked private selectedExampleIds: Set<string> | null = null;

  private instancesSearch = getSearch<CardDef>(this, getOwner(this)!, () =>
    this.codeRef ? { filter: { type: this.codeRef } } : undefined,
  );

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
    // null means all selected → use all instance IDs
    let openCardIds =
      this.selectedExampleIds === null
        ? this.instances.map((i) => i.id)
        : this.selectedExampleIds.size > 0
          ? [...this.selectedExampleIds]
          : (payload.openCardIds ?? []);

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

    this.operatorModeStateService.dismissCreateListingModal();
  });

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
    return this.payload?.openCardIds?.[0] ?? this.codeRef?.module ?? '';
  }

  private get instances(): CardDef[] {
    return this.instancesSearch.instances;
  }

  private get hasInstances(): boolean {
    return this.instances.length > 0;
  }

  // null = user hasn't manually toggled anything → all selected by default
  private get hasManualSelection(): boolean {
    return this.selectedExampleIds !== null;
  }

  private get allSelected(): boolean {
    if (!this.hasInstances) {
      return false;
    }
    if (!this.hasManualSelection) {
      return true;
    }
    return this.instances.every((instance) =>
      this.selectedExampleIds!.has(instance.id),
    );
  }

  @action private onSelectExample(selection: string) {
    // First manual toggle: start from "all selected" state
    let current =
      this.selectedExampleIds ?? new Set(this.instances.map((i) => i.id));
    let next = new Set(current);
    if (next.has(selection)) {
      next.delete(selection);
    } else {
      next.add(selection);
    }
    this.selectedExampleIds = next;
  }

  private isSelected = (id: string): boolean => {
    // null means no manual selection → all selected
    if (this.selectedExampleIds === null) {
      return true;
    }
    return this.selectedExampleIds.has(id);
  };

  @action private selectAll() {
    this.selectedExampleIds = new Set(
      this.instances.map((instance) => instance.id),
    );
  }

  @action private clearAll() {
    this.selectedExampleIds = new Set();
  }

  @action private onClose() {
    this.selectedExampleIds = null;
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
            <div
              class='field-contents realm-value'
              data-test-create-listing-target-realm
            >
              {{#if this.realmInfo}}
                <RealmIcon class='realm-icon' @realmInfo={{this.realmInfo}} />
                <span>{{this.realmInfo.name}}</span>
              {{/if}}
            </div>
          </FieldContainer>

          <FieldContainer @label='CodeRef' @tag='label' class='field'>
            <div class='field-contents' data-test-create-listing-coderef>
              <SelectedTypePill
                @title={{this.codeRefTitle}}
                @id={{this.codeRefId}}
              />
            </div>
          </FieldContainer>

          {{#if this.hasInstances}}
            <FieldContainer @label='Example' @tag='div' class='examples-field'>
              <div class='examples-container' data-test-examples-container>
                <div class='examples-header'>
                  <label class='select-all-label'>
                    <BoxelInput
                      @type='checkbox'
                      @value={{this.allSelected}}
                      @onChange={{if
                        this.allSelected
                        this.clearAll
                        this.selectAll
                      }}
                      data-test-select-all
                    />
                    Select All
                  </label>
                  <Button
                    class='clear-all-button'
                    @kind='text-only'
                    @size='small'
                    {{on 'click' this.clearAll}}
                    data-test-clear-all
                  >
                    Clear All
                  </Button>
                </div>
                <p class='examples-description'>
                  Select the examples to be linked to the listing. These help
                  others understand how to use your code.
                </p>
                <GridContainer
                  class='examples-grid'
                  data-test-create-listing-examples
                >
                  {{#each this.instances as |instance|}}
                    <ItemButton
                      class='example-card'
                      @item={{instance}}
                      @itemId={{instance.id}}
                      @isSelected={{this.isSelected instance.id}}
                      @multiSelect={{true}}
                      @onSelect={{this.onSelectExample}}
                      data-test-create-listing-example={{instance.id}}
                    />
                  {{/each}}
                </GridContainer>
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
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxxs) var(--horizontal-gap);
      }
      .field :deep(.label-container) {
        width: 8rem;
      }
      .field :deep(.content) {
        flex-grow: 1;
        min-width: 13rem;
      }
      .field-contents {
        display: flex;
        align-items: center;
        min-height: 2.25rem;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxxs);
      }
      .realm-value {
        gap: var(--boxel-sp-xxxs);
      }
      .realm-icon {
        --boxel-realm-icon-size: 1rem;
      }
      .examples-field {
        margin-top: var(--boxel-sp-sm);
      }
      .examples-container {
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-sm);
        width: 100%;
      }
      .examples-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .select-all-label {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
        font: var(--boxel-font-sm);
        font-weight: 600;
        cursor: pointer;
      }
      .select-all-label :deep(.input-container) {
        --boxel-checkbox-size: 16px;
      }
      .clear-all-button {
        --boxel-button-font: var(--boxel-font-xs);
        --boxel-button-text-color: var(--boxel-500);
        text-decoration: underline;
      }
      .clear-all-button:hover {
        --boxel-button-text-color: var(--boxel-dark);
      }
      .examples-description {
        font: var(--boxel-font-xs);
        color: var(--boxel-500);
        margin: var(--boxel-sp-xxxs) 0 var(--boxel-sp-sm);
      }
      .examples-grid {
        width: 100%;
        gap: var(--boxel-sp-xs);
      }
      .example-card {
        height: 60px;
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
