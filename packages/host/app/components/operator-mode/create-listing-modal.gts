import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { getOwner } from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { dropTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import onKeyMod from 'ember-keyboard/modifiers/on-key';

import {
  BoxelSelect,
  Button,
  FieldContainer,
  RealmIcon,
} from '@cardstack/boxel-ui/components';

import {
  isResolvedCodeRef,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import ListingCreateCommand from '@cardstack/host/commands/listing-create';
import ModalContainer from '@cardstack/host/components/modal-container';
import { getSearch } from '@cardstack/host/resources/search';

import type CommandService from '@cardstack/host/services/command-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';

import type { CardDef } from 'https://cardstack.com/base/card-api';

type SourceOption = {
  id: string | null; // null = card definition, string = instance id
  label: string;
  detail: string;
};

function fileNameFromUrl(url: string, ext: string): string {
  return `${url.split('/').pop() ?? url}${ext}`;
}

interface Signature {
  Args: {};
}

export default class CreateListingModal extends Component<Signature> {
  @service declare private commandService: CommandService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;

  @tracked private errorMessage?: string;
  @tracked private _userSelectedKey?: string;
  @tracked private _userSelectedValue: string | null = null;

  private instancesSearch = getSearch<CardDef>(this, getOwner(this)!, () =>
    this.codeRef ? { filter: { type: this.codeRef } } : undefined,
  );

  private createListing = dropTask(async () => {
    let request = this.request;
    if (!request) {
      throw new Error('Cannot create listing without a modal request');
    }

    this.errorMessage = undefined;

    try {
      let codeRef = this.codeRef;
      if (!codeRef) {
        throw new Error('Cannot create listing without a resolved code ref');
      }
      await new ListingCreateCommand(
        this.commandService.commandContext,
      ).execute({
        codeRef,
        targetRealm: request.targetRealm,
        openCardId: this.activeOpenCardId ?? undefined,
      });
      // Only close if the request hasn't been replaced by a newer one while
      // the task was running (e.g. user dismissed and reopened for a different card).
      if (this.request === request) {
        this.operatorModeStateService.closeCreateListingModal();
      }
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : 'Failed to create listing';
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

  private get definitionLabel() {
    let module = this.codeRef?.module;
    return module
      ? fileNameFromUrl(module, '.gts')
      : (this.codeRef?.name ?? 'Unknown');
  }

  private get requestKey(): string | undefined {
    let codeRef = this.codeRef;
    return codeRef
      ? `${codeRef.module}::${codeRef.name}::${this.request?.openCardId ?? ''}`
      : undefined;
  }

  private get activeOpenCardId(): string | null {
    if (
      this._userSelectedKey !== undefined &&
      this._userSelectedKey === this.requestKey
    ) {
      return this._userSelectedValue;
    }
    return this.request?.openCardId ?? null;
  }

  @cached
  private get definitionOption(): SourceOption {
    return {
      id: null,
      label: this.definitionLabel,
      detail: 'Card Definition',
    };
  }

  @cached
  private get allOptions(): SourceOption[] {
    const instanceOptions: SourceOption[] = this.instancesSearch.instances.map(
      (instance) => ({
        id: instance.id,
        label: fileNameFromUrl(instance.id, '.json'),
        detail: 'Instance',
      }),
    );
    // If opened from a specific instance (openCardId), ensure it appears in
    // the list immediately — before the async search finishes loading — so
    // the select shows it as pre-selected on first render.
    const openCardId = this.request?.openCardId;
    if (openCardId && !instanceOptions.some((o) => o.id === openCardId)) {
      instanceOptions.unshift({
        id: openCardId,
        label: fileNameFromUrl(openCardId, '.json'),
        detail: 'Instance',
      });
    }
    return [this.definitionOption, ...instanceOptions];
  }

  private get selectedOption(): SourceOption {
    return (
      this.allOptions.find((opt) => opt.id === this.activeOpenCardId) ??
      this.definitionOption
    );
  }

  private get isCreateRunning() {
    return this.createListing.isRunning;
  }

  @action private onClose() {
    this.errorMessage = undefined;
    this._userSelectedKey = undefined;
    this._userSelectedValue = null;
    this.operatorModeStateService.closeCreateListingModal();
  }

  @action private onSelectChange(option: SourceOption) {
    this.errorMessage = undefined;
    this._userSelectedKey = this.requestKey;
    this._userSelectedValue = option.id;
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

          <FieldContainer @label='Source' @tag='div' class='field'>
            <BoxelSelect
              class='source-select'
              @options={{this.allOptions}}
              @selected={{this.selectedOption}}
              @onChange={{this.onSelectChange}}
              @disabled={{this.isCreateRunning}}
              @renderInPlace={{true}}
              data-test-create-listing-source-select
              as |option|
            >
              <div
                class='source-option-item'
                data-test-create-listing-definition-option={{unless
                  option.id
                  'true'
                }}
                data-test-create-listing-instance-option={{option.id}}
              >
                <span
                  class='option-label'
                  data-test-create-listing-display-name={{unless
                    option.id
                    'true'
                  }}
                >{{option.label}}</span>
                <span class='option-detail'>{{option.detail}}</span>
              </div>
            </BoxelSelect>
          </FieldContainer>

          {{#if this.errorMessage}}
            <p class='error' data-test-create-listing-error>
              {{this.errorMessage}}
            </p>
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
              @loading={{this.isCreateRunning}}
              @disabled={{this.isCreateRunning}}
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
      .source-select {
        width: 100%;
      }
      .source-option-item {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        width: 100%;
      }
      .option-label {
        font: 600 var(--boxel-font-sm);
        flex: 1;
      }
      .option-detail {
        font: var(--boxel-font-xs);
        color: var(--boxel-500);
        white-space: nowrap;
      }
      .footer-buttons {
        display: flex;
        margin-left: auto;
        gap: var(--horizontal-gap);
      }
      .error {
        color: var(--boxel-danger);
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        margin: var(--boxel-sp) 0 0;
      }
    </style>
  </template>
}
