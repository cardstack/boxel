import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import onKeyMod from 'ember-keyboard/modifiers/on-key';

import {
  Button,
  FieldContainer,
  GridContainer,
  RealmIcon,
} from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

import {
  isResolvedCodeRef,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { Submodes } from '@cardstack/host/components/submode-switcher';
import ListingCreateCommand from '@cardstack/host/commands/listing-create';
import CardRenderer from '@cardstack/host/components/card-renderer';
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

  @tracked private selectedExampleIds: Set<string> = new Set();

  private instancesSearch = getSearch<CardDef>(this, getOwner(this)!, () =>
    this.codeRef ? { filter: { type: this.codeRef } } : undefined,
  );

  private createListing = dropTask(async () => {
    let request = this.request;
    if (!request) {
      throw new Error('Cannot create listing without a modal request');
    }

    let codeRef = this.codeRef;
    if (!codeRef) {
      throw new Error('Cannot create listing without a resolved code ref');
    }

    let targetRealm = request.targetRealm;
    let selectedIds = this.effectiveSelectedExampleIds;
    let openCardId =
      selectedIds.size > 0
        ? [...selectedIds][0]
        : request.openCardId;
    let title = this.codeRefTitle;

    this.operatorModeStateService.dismissCreateListingModal();
    this.operatorModeStateService.showToast({
      status: 'loading',
      message: `Creating listing for ${title}...`,
    });

    try {
      let result = await new ListingCreateCommand(
        this.commandService.commandContext,
      ).execute({
        codeRef,
        targetRealm,
        openCardId,
      });
      let cardUrl = result?.listing?.id;
      this.operatorModeStateService.showToast({
        status: 'success',
        message: `${title} listing created successfully`,
        ctaLabel: cardUrl ? 'View Listing' : undefined,
        ctaAction: cardUrl
          ? async () => {
              this.operatorModeStateService.dismissToast();
              if (this.operatorModeStateService.workspaceChooserOpened) {
                this.operatorModeStateService.closeWorkspaceChooser();
              }
              await this.operatorModeStateService.updateCodePath(
                new URL(cardUrl + '.json'),
                'preview',
              );
              this.operatorModeStateService.updateSubmode(Submodes.Code);
            }
          : undefined,
      });
    } catch (error) {
      this.operatorModeStateService.showToast({
        status: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to create listing',
      });
    }
  });

  private get request() {
    return this.operatorModeStateService.createListingModalRequest;
  }

  private get isModalOpen() {
    return Boolean(this.request);
  }

  private get realmInfo() {
    let request = this.request;
    if (!request) {
      return undefined;
    }
    return this.realm.info(request.targetRealm);
  }

  private get codeRef(): ResolvedCodeRef | undefined {
    let codeRef = this.request?.codeRef;
    return codeRef && isResolvedCodeRef(codeRef) ? codeRef : undefined;
  }

  private get codeRefTitle(): string {
    return this.codeRef?.name ?? 'Unknown';
  }

  private get codeRefId(): string {
    return this.request?.openCardId ?? this.codeRef?.module ?? '';
  }

  private get instances(): CardDef[] {
    return this.instancesSearch.instances;
  }

  private get hasInstances(): boolean {
    return this.instances.length > 0;
  }

  private get effectiveSelectedExampleIds(): Set<string> {
    if (this.selectedExampleIds.size > 0) {
      return this.selectedExampleIds;
    }
    let openCardId = this.request?.openCardId;
    return openCardId ? new Set([openCardId]) : new Set();
  }

  @action private onSelectExample(instance: CardDef) {
    let id = instance.id;
    let next = new Set(this.selectedExampleIds.size > 0
      ? this.selectedExampleIds
      : this.effectiveSelectedExampleIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selectedExampleIds = next;
  }

  private isSelected = (instance: CardDef): boolean => {
    return this.effectiveSelectedExampleIds.has(instance.id);
  };

  @action private onClose() {
    this.selectedExampleIds = new Set();
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
            <FieldContainer @label='Example' @tag='div' class='field'>
              <GridContainer
                class='examples-grid'
                data-test-create-listing-examples
              >
                {{#each this.instances as |instance|}}
                  <button
                    type='button'
                    class={{cn
                      'example-card'
                      selected=(this.isSelected instance)
                    }}
                    {{on 'click' (fn this.onSelectExample instance)}}
                    data-test-create-listing-example={{instance.id}}
                  >
                    <CardRenderer
                      @card={{instance}}
                      @format='fitted'
                      @displayContainer={{false}}
                    />
                  </button>
                {{/each}}
              </GridContainer>
            </FieldContainer>
          {{/if}}

        </:content>
        <:footer>
          <div class='footer-buttons'>
            <Button
              @size='tall'
              {{on 'click' this.onClose}}
              {{onKeyMod 'Escape'}}
              data-test-create-listing-cancel-button
            >
              Cancel
            </Button>
            <Button
              @kind='primary'
              @size='tall'
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
      .examples-grid {
        width: 100%;
        gap: var(--boxel-sp-xs);
      }
      .example-card {
        all: unset;
        cursor: pointer;
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        height: 60px;
        box-sizing: border-box;
      }
      .example-card:hover {
        box-shadow: var(--boxel-box-shadow);
      }
      .example-card.selected {
        border: 2px solid var(--boxel-dark);
      }
      .footer-buttons {
        display: flex;
        margin-left: auto;
        gap: var(--horizontal-gap);
      }
    </style>
  </template>
}
