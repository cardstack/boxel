import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import onKeyMod from 'ember-keyboard/modifiers/on-key';

import {
  Button,
  FieldContainer,
  type PickerOption,
  RealmIcon,
} from '@cardstack/boxel-ui/components';

import {
  isResolvedCodeRef,
  cardIdToURL,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { cardTypeIcon } from '@cardstack/runtime-common/helpers/card-type-display-name';

import ListingCreateCommand from '@cardstack/host/commands/listing-create';
import CardInstancePicker from '@cardstack/host/components/card-instance-picker';
import ModalContainer from '@cardstack/host/components/modal-container';
import { SelectedTypePill } from '@cardstack/host/components/operator-mode/create-file-modal';
import { Submodes } from '@cardstack/host/components/submode-switcher';
import { getSearch } from '@cardstack/host/resources/search';

import type CommandService from '@cardstack/host/services/command-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';

import type { CardDef } from '@cardstack/base/card-api';

interface Signature {
  Args: {};
}

export default class CreateListingModal extends Component<Signature> {
  @service declare private commandService: CommandService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;

  @tracked private selectedExamples: PickerOption[] = [];

  private instancesSearch = getSearch<CardDef>(this, getOwner(this)!, () =>
    this.codeRef ? { filter: { type: this.codeRef } } : undefined,
  );

  private get instances(): CardDef[] {
    return this.instancesSearch.instances as CardDef[];
  }

  @cached
  get instanceOptions(): PickerOption[] {
    return this.instances.map((instance) => ({
      id: instance.id,
      label: instance.cardTitle ?? instance.id,
      icon: cardTypeIcon(instance),
      type: 'option' as const,
    }));
  }

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

  private get selectedExampleURLs(): string[] {
    const selected = this.effectiveSelected;
    const hasSelectAll = selected.some((opt) => opt.type === 'select-all');
    if (hasSelectAll || selected.length === 0) {
      return this.instances.map((i) => i.id);
    }
    return selected.map((opt) => opt.id).filter(Boolean);
  }

  private get initialSelected(): PickerOption[] {
    const openCardIds = this.payload?.openCardIds;
    if (openCardIds?.length) {
      return this.instanceOptions.filter((opt) => openCardIds.includes(opt.id));
    }
    // Opened from module (no specific instance) → auto-select first instance
    let first = this.instanceOptions[0];
    return first ? [first] : [];
  }

  private get effectiveSelected(): PickerOption[] {
    return this.selectedExamples.length > 0
      ? this.selectedExamples
      : this.initialSelected;
  }

  @action private onExampleChange(selected: PickerOption[]) {
    this.selectedExamples = selected;
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
        cardIdToURL(cardUrl + '.json'),
        'preview',
      );
      this.operatorModeStateService.updateCardPreviewFormat('isolated');
    }

    // Keep modal open while background auto-patching runs
    let backgroundWork = (result as any)?.backgroundWork;
    if (backgroundWork) {
      await backgroundWork;
    }

    this.selectedExamples = [];
    this.operatorModeStateService.dismissCreateListingModal();
  });

  @action private onClose() {
    this.selectedExamples = [];
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

          {{#if this.instanceOptions.length}}
            <FieldContainer @label='Examples' class='field'>
              <div class='field-contents' data-test-examples-container>
                <CardInstancePicker
                  @placeholder='Select examples to include in the listing'
                  @options={{this.instanceOptions}}
                  @selected={{this.effectiveSelected}}
                  @onChange={{this.onExampleChange}}
                  @maxSelectedDisplay={{3}}
                  data-test-create-listing-examples
                />
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
