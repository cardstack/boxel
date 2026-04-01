import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import onKeyMod from 'ember-keyboard/modifiers/on-key';

import { Button, FieldContainer } from '@cardstack/boxel-ui/components';

import { chooseCard } from '@cardstack/runtime-common';

import CreateListingPRRequestCommand from '@cardstack/host/commands/bot-requests/create-listing-pr-request';
import CardPill from '@cardstack/host/components/card-pill';
import ModalContainer from '@cardstack/host/components/modal-container';
import { catalogRealm } from '@cardstack/host/lib/utils';

import type CommandService from '@cardstack/host/services/command-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';

interface Signature {
  Args: {};
}

export default class CreatePRModal extends Component<Signature> {
  @service declare private commandService: CommandService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;

  @tracked private isSubmitted = false;
  @tracked private selectedListingId?: string;

  private get payload() {
    return this.operatorModeStateService.createPRModalPayload;
  }

  private get isModalOpen() {
    return Boolean(this.payload);
  }

  private get listingId() {
    return this.selectedListingId ?? this.payload?.listingId;
  }

  private get listingTitle(): string | undefined {
    if (this.selectedListingId) {
      return undefined;
    }
    return this.payload?.listingName;
  }

  private get canChangeListing() {
    return Boolean(catalogRealm);
  }

  private createPR = task(async () => {
    let payload = this.payload;
    if (!payload) {
      throw new Error('Cannot create PR without a modal payload');
    }

    let currentListingId = this.listingId;
    if (!currentListingId) {
      throw new Error('Cannot create PR without a listing');
    }

    let realm =
      this.realm.realmOfURL(new URL(currentListingId))?.href ?? payload.realm;

    await new CreateListingPRRequestCommand(
      this.commandService.commandContext,
    ).execute({
      listingId: currentListingId,
      realm,
    });

    this.isSubmitted = true;
  });

  private changeListing = restartableTask(async () => {
    if (!catalogRealm) {
      throw new Error('Cannot find catalog realm');
    }
    let listingId = await chooseCard({
      filter: {
        type: {
          module: `${catalogRealm.url}catalog-app/listing/listing`,
          name: 'Listing',
        },
      },
    });
    if (listingId) {
      this.selectedListingId = listingId;
    }
  });

  @action private onClose() {
    this.isSubmitted = false;
    this.selectedListingId = undefined;
    this.operatorModeStateService.dismissCreatePRModal();
  }

  <template>
    {{#if this.isModalOpen}}
      <ModalContainer
        class='create-pr-modal'
        @cardContainerClass='create-pr'
        @title={{if this.isSubmitted 'Listing Submitted 🎉!' 'Make a PR'}}
        @size='small'
        @isOpen={{this.isModalOpen}}
        @onClose={{this.onClose}}
        data-test-create-pr-modal
      >
        <:content>
          {{#if this.isSubmitted}}
            <div class='submitted-container' data-test-create-pr-success>
              <div class='submitted-message'>
                Your listing has been submitted. A Submission Workflow card is
                being created to track the PR process. You can monitor the
                progress in real-time.
              </div>
              <Button
                @as='anchor'
                @kind='secondary'
                @size='small'
                @href='https://github.com/cardstack/boxel-catalog/pulls'
                target='_blank'
                rel='noopener noreferrer'
              >
                Check for updates on GitHub
              </Button>
            </div>
          {{else}}
            <p class='description'>
              You're about to submit your listing for review. A PR will be
              created on GitHub.
            </p>
            <FieldContainer @label='Listing' class='field'>
              <div class='field-contents' data-test-create-pr-listing-name>
                {{#if this.listingId}}
                  <CardPill
                    @cardId={{this.listingId}}
                    @urlForRealmLookup={{this.listingId}}
                    @displayTitle={{this.listingTitle}}
                    class='listing-pill'
                  />
                {{/if}}
                {{#if this.canChangeListing}}
                  <Button
                    @kind='text-only'
                    @size='small'
                    @disabled={{this.createPR.isRunning}}
                    {{on 'click' (perform this.changeListing)}}
                    data-test-create-pr-change-listing-button
                  >
                    Change
                  </Button>
                {{/if}}
              </div>
            </FieldContainer>
          {{/if}}
        </:content>
        <:footer>
          <div class='footer-buttons'>
            {{#if this.isSubmitted}}
              <Button
                @kind='primary'
                @size='tall'
                {{on 'click' this.onClose}}
                {{onKeyMod 'Escape'}}
                data-test-create-pr-done-button
              >
                Done
              </Button>
            {{else if this.createPR.isRunning}}
              <p class='footer-loading-message' data-test-create-pr-loading>
                Submitting your listing. This may take a moment...
              </p>
              <Button
                @kind='primary'
                @size='tall'
                @loading={{true}}
                @disabled={{true}}
                data-test-create-pr-confirm-button
              >
                Submit
              </Button>
            {{else}}
              <Button
                @size='tall'
                {{on 'click' this.onClose}}
                {{onKeyMod 'Escape'}}
                data-test-create-pr-cancel-button
              >
                Cancel
              </Button>
              <Button
                @kind='primary'
                @size='tall'
                {{on 'click' (perform this.createPR)}}
                {{onKeyMod 'Enter'}}
                data-test-create-pr-confirm-button
              >
                Submit
              </Button>
            {{/if}}
          </div>
        </:footer>
      </ModalContainer>
    {{/if}}

    <style scoped>
      .create-pr-modal {
        --horizontal-gap: var(--boxel-sp-xs);
        --stack-card-footer-height: auto;
      }
      .create-pr-modal > :deep(.boxel-modal__inner) {
        display: flex;
      }
      .create-pr-modal :deep(.dialog-box__content) {
        display: flex;
        flex-direction: column;
      }
      :deep(.create-pr) {
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
      .submitted-container {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--boxel-sp);
      }
      .submitted-message {
        font: var(--boxel-font-sm);
        color: var(--boxel-500);
        margin: 0;
        animation: fade-in 0.3s ease-out;
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
        justify-content: space-between;
        gap: var(--horizontal-gap);
      }
      .listing-pill :deep(figure.icon:last-child) {
        display: none;
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
